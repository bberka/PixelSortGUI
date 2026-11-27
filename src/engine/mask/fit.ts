import type {Pace} from '../blur.ts';
import {clamp, floorDiv} from '../math.ts';
import {
	effectiveDimensions,
	orientedDimensions,
	orientedMapping,
} from '../transform.ts';
import type {MaskRect} from './brush-types.ts';
import type {MaskBitmap, MaskGeometry} from './types.ts';

// Which grid pixels each destination index reads along one axis, and their weights.
type AxisTaps = {
	// Taps of destination `d` are `start[d]` up to `start[d + 1]`.
	start: Int32Array;
	index: Int32Array;
	weight: Int32Array;
	// Sum of each destination's weights.
	total: Int32Array;
};

/**
 Taps along one axis (engine.md section 16.6): `side` grid pixels cover
 `orientedSide` source pixels, of which `cropSide` from `cropStart` are rendered
 onto `renderSide` pixels. A destination at least one grid pixel wide averages by
 area, a narrower one interpolates linearly.
 */
function axisTaps(
	side: number,
	orientedSide: number,
	cropStart: number,
	cropSide: number,
	renderSide: number,
): AxisTaps {
	// Destination edge `d`, in 1/256 grid pixels.
	const edge = (d: number) =>
		floorDiv(
			256 * side * (cropStart * renderSide + d * cropSide),
			orientedSide * renderSide,
		);
	// Area bins add at most the grid side plus 2 per destination, linear ones 2.
	const capacity = side + 2 * renderSide;
	const start = new Int32Array(renderSide + 1);
	const index = new Int32Array(capacity);
	const weight = new Int32Array(capacity);
	const total = new Int32Array(renderSide);
	let t = 0;
	for (let d = 0; d < renderSide; d++) {
		const low = edge(d);
		const high = edge(d + 1);
		if (high - low >= 256) {
			const end = floorDiv(high - 1, 256);
			for (let s = floorDiv(low, 256); s <= end; s++, t++) {
				index[t] = s;
				weight[t] = Math.min(256 * s + 256, high) - Math.max(256 * s, low);
			}

			total[d] = high - low;
		} else {
			const q = clamp(floorDiv(low + high, 2) - 128, 0, 256 * (side - 1));
			const first = floorDiv(q, 256);
			const fraction = q - 256 * first;
			index[t] = first;
			weight[t] = 256 - fraction;
			index[t + 1] = Math.min(first + 1, side - 1);
			weight[t + 1] = fraction;
			t += 2;
			total[d] = 256;
		}

		start[d + 1] = t;
	}

	return {start, index, weight, total};
}

/**
 The painted base mask: `grid` rotated, flipped and cropped like the source, then
 fitted onto `target`, a `width x height` render of the effective image. The
 resize filter is not used. `grid` is only read. `rect`, in target pixels, limits
 which pixels are computed and written.
 */
export async function fitPaintedMask(
	grid: MaskBitmap,
	{sourceWidth, sourceHeight, transform}: MaskGeometry,
	width: number,
	height: number,
	target: Uint8Array,
	pace: Pace,
	rect: MaskRect = {x: 0, y: 0, width, height},
): Promise<void> {
	// Throws for a transform that does not fit the source.
	effectiveDimensions(sourceWidth, sourceHeight, transform);
	const {rotation} = transform;
	const source = orientedDimensions(sourceWidth, sourceHeight, rotation);
	const mask = orientedDimensions(grid.width, grid.height, rotation);
	const crop = transform.crop ?? {x: 0, y: 0, ...source};
	const {origin, stepU, stepV} = orientedMapping(
		grid.width,
		grid.height,
		transform,
	);
	const xs = axisTaps(mask.width, source.width, crop.x, crop.width, width);
	const ys = axisTaps(mask.height, source.height, crop.y, crop.height, height);
	const {data} = grid;

	const right = rect.x + rect.width;
	// The two most recent horizontally filtered grid rows, kept by row parity.
	const rows = [new Int32Array(width), new Int32Array(width)];
	const held = [-1, -1];
	const sums = new Float64Array(width);
	for (let dy = rect.y; dy < rect.y + rect.height; dy++) {
		sums.fill(0);
		for (let ty = ys.start[dy]; ty < ys.start[dy + 1]; ty++) {
			const v = ys.index[ty];
			const slot = v % 2;
			const row = rows[slot];
			if (held[slot] !== v) {
				const pending = pace(Math.max(rect.width, mask.width));
				if (pending) {
					await pending;
				}

				const base = origin + v * stepV;
				for (let dx = rect.x; dx < right; dx++) {
					let sum = 0;
					for (let tx = xs.start[dx]; tx < xs.start[dx + 1]; tx++) {
						sum += xs.weight[tx] * data[base + xs.index[tx] * stepU];
					}

					row[dx] = sum;
				}

				held[slot] = v;
			}

			const wy = ys.weight[ty];
			for (let dx = rect.x; dx < right; dx++) {
				sums[dx] += wy * row[dx];
			}
		}

		const out = dy * width;
		for (let dx = rect.x; dx < right; dx++) {
			const total = xs.total[dx] * ys.total[dy];
			target[out + dx] = floorDiv(2 * sums[dx] + total, 2 * total);
		}
	}
}
