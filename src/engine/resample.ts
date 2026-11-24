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
 Exact box (area-average) downscale. Destination pixel `d` covers the source
 interval `[d * S / D, (d + 1) * S / D)` on each axis, and a source pixel
 counts in proportion to the area of it that lies inside. In units of `1 / D`
 the overlap of source index `s` with destination index `d` is the integer
 `min((s + 1) * D, (d + 1) * S) - max(s * D, d * S)`, and the weights of one
 destination pixel sum to `S`. Each of R, G, B and A is averaged on its own:
 `floorDiv(2 * sum + total, 2 * total)` with `total = sourceWidth *
 sourceHeight`, which rounds halves up. All sums stay below 2^53.
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
					sums[o] += w * from[p];
					sums[o + 1] += w * from[p + 1];
					sums[o + 2] += w * from[p + 2];
					sums[o + 3] += w * from[p + 3];
				}
			}
		}

		const out = dy * width * 4;
		for (let k = 0; k < width * 4; k++) {
			to[out + k] = Math.floor((2 * sums[k] + total) / (2 * total));
		}
	}

	return target;
}
