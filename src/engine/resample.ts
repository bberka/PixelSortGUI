import {createImage, type RgbaImage} from './types.ts';

type Spans = {
	// First source index each destination index overlaps.
	first: Int32Array;
	// One past the last source index each destination index overlaps.
	end: Int32Array;
};

function spans(sourceSize: number, targetSize: number): Spans {
	const first = new Int32Array(targetSize);
	const end = new Int32Array(targetSize);
	for (let d = 0; d < targetSize; d++) {
		first[d] = Math.floor((d * sourceSize) / targetSize);
		end[d] = Math.ceil(((d + 1) * sourceSize) / targetSize);
	}

	return {first, end};
}

/**
 Exact alpha-weighted (premultiplied) box downscale (engine.md section 8.2).
 Destination pixel `d` covers `[d * S / D, (d + 1) * S / D)` on each axis, with
 integer overlap weight `w = wx * wy` summing to `total = sw * sh`. Alpha is
 `floorDiv(2 * sumA + total, 2 * total)`. Colour channels are weighted by
 `w * A` and divided by `sumA` (rounding halves up), or `0` when `sumA === 0`.
 All intermediate sums stay below 2^53.
 */
export function boxDownscale(
	source: RgbaImage,
	width: number,
	height: number,
): RgbaImage {
	const sw = source.width;
	const sh = source.height;
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width > sw ||
		height > sh
	) {
		throw new RangeError(
			`Cannot box downscale ${sw}x${sh} to ${width}x${height}`,
		);
	}

	const target = createImage(width, height);
	if (width === sw && height === sh) {
		target.data.set(source.data);
		return target;
	}

	const from = source.data;
	const to = target.data;
	const xs = spans(sw, width);
	const ys = spans(sh, height);
	const total = sw * sh;
	const sums = new Float64Array(width * 4);

	for (let dy = 0; dy < height; dy++) {
		sums.fill(0);
		for (let sy = ys.first[dy]; sy < ys.end[dy]; sy++) {
			const wy =
				Math.min((sy + 1) * height, (dy + 1) * sh) -
				Math.max(sy * height, dy * sh);
			const row = sy * sw * 4;
			for (let dx = 0; dx < width; dx++) {
				const o = dx * 4;
				for (let sx = xs.first[dx]; sx < xs.end[dx]; sx++) {
					const w =
						wy *
						(Math.min((sx + 1) * width, (dx + 1) * sw) -
							Math.max(sx * width, dx * sw));
					const p = row + sx * 4;
					const wa = w * from[p + 3];
					sums[o] += wa * from[p];
					sums[o + 1] += wa * from[p + 1];
					sums[o + 2] += wa * from[p + 2];
					sums[o + 3] += wa;
				}
			}
		}

		const out = dy * width * 4;
		for (let dx = 0; dx < width; dx++) {
			const o = dx * 4;
			const sumA = sums[o + 3];
			if (sumA === 0) {
				to[out + o] = 0;
				to[out + o + 1] = 0;
				to[out + o + 2] = 0;
				to[out + o + 3] = 0;
			} else {
				const denom = 2 * sumA;
				to[out + o] = Math.floor((2 * sums[o] + sumA) / denom);
				to[out + o + 1] = Math.floor((2 * sums[o + 1] + sumA) / denom);
				to[out + o + 2] = Math.floor((2 * sums[o + 2] + sumA) / denom);
				to[out + o + 3] = Math.floor((2 * sumA + total) / (2 * total));
			}
		}
	}

	return target;
}
