/* eslint-disable no-bitwise -- the fixed-point shifts are the specified floor divisions by powers of two */
import {clamp, floorDiv} from '../math.ts';
import {intIn, unit} from '../random.ts';
import type {EffectDefinition} from '../types.ts';
import {jpegCrushSpec, type JpegCrushParams} from './jpeg-crush-spec.ts';

const CHECKPOINT_PIXELS = 16_384;
// A block never spans more render pixels per side than the largest block size.
const MAX_SIDE = 64;

// Purpose codes for the random draws (engine.md section 16.1).
const P_ACTIVE = 1;
const P_CB = 2;
const P_CR = 3;
const P_LUMA = 4;

/**
`C[u * 8 + i]`: `8192 * a(u) * cos((2i + 1) u pi / 16)`, rounded.
*/
// prettier-ignore
export const DCT_TABLE = Int32Array.of(
	2896, 2896, 2896, 2896, 2896, 2896, 2896, 2896,
	4017, 3406, 2276, 799, -799, -2276, -3406, -4017,
	3784, 1567, -1567, -3784, -3784, -1567, 1567, 3784,
	3406, -799, -4017, -2276, 2276, 4017, 799, -3406,
	2896, -2896, -2896, 2896, 2896, -2896, -2896, 2896,
	2276, -4017, 799, 3406, -3406, -799, 4017, -2276,
	1567, -3784, 3784, -1567, -1567, 3784, -3784, 1567,
	799, -2276, 3406, -4017, 4017, -3406, 2276, -799,
);

/**
ITU-T T.81 Annex K, table K.1.
*/
// prettier-ignore
export const LUMA_TABLE = Uint8Array.of(
	16, 11, 10, 16, 24, 40, 51, 61,
	12, 12, 14, 19, 26, 58, 60, 55,
	14, 13, 16, 24, 40, 57, 69, 56,
	14, 17, 22, 29, 51, 87, 80, 62,
	18, 22, 37, 56, 68, 109, 103, 77,
	24, 35, 55, 64, 81, 104, 113, 92,
	49, 64, 78, 87, 103, 121, 120, 101,
	72, 92, 95, 98, 112, 100, 103, 99,
);

/**
ITU-T T.81 Annex K, table K.2.
*/
// prettier-ignore
export const CHROMA_TABLE = Uint8Array.of(
	17, 18, 24, 47, 99, 99, 99, 99,
	18, 21, 26, 66, 99, 99, 99, 99,
	24, 26, 56, 99, 99, 99, 99, 99,
	47, 66, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99,
);

export function scaledTable(base: Uint8Array, quality: number): Int32Array {
	const k = quality < 50 ? floorDiv(5000, quality) : 200 - 2 * quality;
	return Int32Array.from(base, (value) =>
		clamp(floorDiv(value * k + 50, 100), 1, 255),
	);
}

// Entries of `DCT_TABLE`: `Kn` is `4096 * cos(n * pi / 16)`.
const K1 = 4017;
const K2 = 3784;
const K3 = 3406;
const K4 = 2896;
const K5 = 2276;
const K6 = 1567;
const K7 = 799;

const pass = new Int32Array(64);

// Both transforms use the symmetry of the table (row `u` mirrors, with the sign
// flipped for odd `u`), so the integer result equals the full matrix product.

/**
 `block` holds samples in 0..255 and receives the coefficients, times 2^15, of
 the samples shifted down by 128.
 */
function forwardDct(block: Int32Array): void {
	for (let row = 0; row < 64; row += 8) {
		const x0 = block[row];
		const x1 = block[row + 1];
		const x2 = block[row + 2];
		const x3 = block[row + 3];
		const x4 = block[row + 4];
		const x5 = block[row + 5];
		const x6 = block[row + 6];
		const x7 = block[row + 7];
		const s0 = x0 + x7;
		const s1 = x1 + x6;
		const s2 = x2 + x5;
		const s3 = x3 + x4;
		const d0 = x0 - x7;
		const d1 = x1 - x6;
		const d2 = x2 - x5;
		const d3 = x3 - x4;
		const e0 = s0 + s3;
		const e1 = s1 + s2;
		const o0 = s0 - s3;
		const o1 = s1 - s2;
		// The level shift only reaches the sum of all eight samples.
		pass[row] = (K4 * (e0 + e1 - 1024) + 1024) >> 11;
		pass[row + 4] = (K4 * (e0 - e1) + 1024) >> 11;
		pass[row + 2] = (K2 * o0 + K6 * o1 + 1024) >> 11;
		pass[row + 6] = (K6 * o0 - K2 * o1 + 1024) >> 11;
		pass[row + 1] = (K1 * d0 + K3 * d1 + K5 * d2 + K7 * d3 + 1024) >> 11;
		pass[row + 3] = (K3 * d0 - K7 * d1 - K1 * d2 - K5 * d3 + 1024) >> 11;
		pass[row + 5] = (K5 * d0 - K1 * d1 + K7 * d2 + K3 * d3 + 1024) >> 11;
		pass[row + 7] = (K7 * d0 - K5 * d1 + K3 * d2 - K1 * d3 + 1024) >> 11;
	}

	for (let v = 0; v < 8; v++) {
		const x0 = pass[v];
		const x1 = pass[v + 8];
		const x2 = pass[v + 16];
		const x3 = pass[v + 24];
		const x4 = pass[v + 32];
		const x5 = pass[v + 40];
		const x6 = pass[v + 48];
		const x7 = pass[v + 56];
		const s0 = x0 + x7;
		const s1 = x1 + x6;
		const s2 = x2 + x5;
		const s3 = x3 + x4;
		const d0 = x0 - x7;
		const d1 = x1 - x6;
		const d2 = x2 - x5;
		const d3 = x3 - x4;
		const e0 = s0 + s3;
		const e1 = s1 + s2;
		const o0 = s0 - s3;
		const o1 = s1 - s2;
		block[v] = K4 * (e0 + e1);
		block[v + 32] = K4 * (e0 - e1);
		block[v + 16] = K2 * o0 + K6 * o1;
		block[v + 48] = K6 * o0 - K2 * o1;
		block[v + 8] = K1 * d0 + K3 * d1 + K5 * d2 + K7 * d3;
		block[v + 24] = K3 * d0 - K7 * d1 - K1 * d2 - K5 * d3;
		block[v + 40] = K5 * d0 - K1 * d1 + K7 * d2 + K3 * d3;
		block[v + 56] = K7 * d0 - K5 * d1 + K3 * d2 - K1 * d3;
	}
}

/**
`block` holds dequantised coefficients and receives samples in 0..255.
*/
function inverseDct(block: Int32Array): void {
	let anyAc = 0;
	for (let v = 0; v < 8; v++) {
		const f0 = block[v];
		const f1 = block[v + 8];
		const f2 = block[v + 16];
		const f3 = block[v + 24];
		const f4 = block[v + 32];
		const f5 = block[v + 40];
		const f6 = block[v + 48];
		const f7 = block[v + 56];
		const ac = f1 | f2 | f3 | f4 | f5 | f6 | f7;
		anyAc |= v === 0 ? ac : ac | f0;
		if (ac === 0) {
			const flat = (K4 * f0 + 1024) >> 11;
			pass[v] = flat;
			pass[v + 8] = flat;
			pass[v + 16] = flat;
			pass[v + 24] = flat;
			pass[v + 32] = flat;
			pass[v + 40] = flat;
			pass[v + 48] = flat;
			pass[v + 56] = flat;
			continue;
		}

		const a = K4 * (f0 + f4);
		const b = K4 * (f0 - f4);
		const c = K2 * f2 + K6 * f6;
		const d = K6 * f2 - K2 * f6;
		const e0 = a + c;
		const e1 = b + d;
		const e2 = b - d;
		const e3 = a - c;
		const o0 = K1 * f1 + K3 * f3 + K5 * f5 + K7 * f7;
		const o1 = K3 * f1 - K7 * f3 - K1 * f5 - K5 * f7;
		const o2 = K5 * f1 - K1 * f3 + K7 * f5 + K3 * f7;
		const o3 = K7 * f1 - K5 * f3 + K3 * f5 - K1 * f7;
		pass[v] = (e0 + o0 + 1024) >> 11;
		pass[v + 8] = (e1 + o1 + 1024) >> 11;
		pass[v + 16] = (e2 + o2 + 1024) >> 11;
		pass[v + 24] = (e3 + o3 + 1024) >> 11;
		pass[v + 32] = (e3 - o3 + 1024) >> 11;
		pass[v + 40] = (e2 - o2 + 1024) >> 11;
		pass[v + 48] = (e1 - o1 + 1024) >> 11;
		pass[v + 56] = (e0 - o0 + 1024) >> 11;
	}

	// Most chroma blocks of a crushed image keep only the DC coefficient.
	if (anyAc === 0) {
		block.fill(sample(K4 * pass[0]));
		return;
	}

	for (let row = 0; row < 64; row += 8) {
		const f0 = pass[row];
		const f1 = pass[row + 1];
		const f2 = pass[row + 2];
		const f3 = pass[row + 3];
		const f4 = pass[row + 4];
		const f5 = pass[row + 5];
		const f6 = pass[row + 6];
		const f7 = pass[row + 7];
		const a = K4 * (f0 + f4);
		const b = K4 * (f0 - f4);
		const c = K2 * f2 + K6 * f6;
		const d = K6 * f2 - K2 * f6;
		const e0 = a + c;
		const e1 = b + d;
		const e2 = b - d;
		const e3 = a - c;
		const o0 = K1 * f1 + K3 * f3 + K5 * f5 + K7 * f7;
		const o1 = K3 * f1 - K7 * f3 - K1 * f5 - K5 * f7;
		const o2 = K5 * f1 - K1 * f3 + K7 * f5 + K3 * f7;
		const o3 = K7 * f1 - K5 * f3 + K3 * f5 - K1 * f7;
		block[row] = sample(e0 + o0);
		block[row + 1] = sample(e1 + o1);
		block[row + 2] = sample(e2 + o2);
		block[row + 3] = sample(e3 + o3);
		block[row + 4] = sample(e3 - o3);
		block[row + 5] = sample(e2 - o2);
		block[row + 6] = sample(e1 - o1);
		block[row + 7] = sample(e0 - o0);
	}
}

/**
Rounds a second-pass sum, undoes the level shift and clamps to a byte.
*/
function sample(sum: number): number {
	const value = ((sum + 16_384) >> 15) + 128;
	return value < 0 ? 0 : Math.min(value, 255);
}

function quantise(block: Int32Array, table: Int32Array): void {
	for (let i = 0; i < 64; i++) {
		const value = block[i];
		const q = table[i];
		const half = q << 14;
		// True exactly when `-half < value < half`, which rounds to level 0.
		if ((value + half - 1) >>> 0 < (q << 15) - 1) {
			block[i] = 0;
			continue;
		}

		const magnitude = Math.abs(value);
		const level = Math.trunc((magnitude + half) / (q << 15)) * q;
		block[i] = value < 0 ? -level : level;
	}
}

type Corruption = {cb: number; cr: number; bx: number; by: number};

function corruptLuma(
	block: Int32Array,
	{bx, by}: Corruption,
	seed: number,
): void {
	const edits = intIn(1, 3, seed, P_LUMA, bx, by);
	for (let e = 0; e < edits; e++) {
		const p = intIn(1, 63, seed, P_LUMA, bx, by, e, 0);
		if (unit(seed, P_LUMA, bx, by, e, 1) < 0.5) {
			block[p] = 0;
			continue;
		}

		const other = intIn(1, 63, seed, P_LUMA, bx, by, e, 2);
		const held = block[p];
		block[p] = block[other];
		block[other] = held;
	}
}

function corruptionFor(
	{corruptRate, corruptShift, seed}: JpegCrushParams,
	bx: number,
	by: number,
): Corruption | undefined {
	const s = Math.round(corruptShift * 127);
	if (s === 0 || !(unit(seed, P_ACTIVE, bx, by) < corruptRate)) {
		return undefined;
	}

	return {
		cb: intIn(-s, s, seed, P_CB, bx, by),
		cr: intIn(-s, s, seed, P_CR, bx, by),
		bx,
		by,
	};
}

type Axis = {
	/**
	Source block index of each run of render pixels.
	*/
	blocks: number[];
	/**
	First render pixel of each run, then the axis length.
	*/
	starts: number[];
	/**
	Chroma sub-block of each render pixel, counted from its block's origin.
	*/
	subBlocks: Int32Array;
};

function sourceAxis(length: number, scale: number, blockSize: number): Axis {
	const sub = Math.max(2, floorDiv(blockSize, 2));
	const blocks: number[] = [];
	const starts: number[] = [];
	const subBlocks = new Int32Array(length);
	for (let i = 0; i < length; i++) {
		const source = Math.floor((i + 0.5) / scale);
		const block = floorDiv(source, blockSize);
		if (block !== blocks.at(-1)) {
			blocks.push(block);
			starts.push(i);
		}

		subBlocks[i] = floorDiv(source - block * blockSize, sub);
	}

	starts.push(length);
	return {blocks, starts, subBlocks};
}

/**
Pixel coverage `[from[i], to[i])` of the 8 grid cells along `n` pixels.
*/
type Coverage = {from: Int32Array; to: Int32Array};

const coverages: Coverage[] = Array.from({length: MAX_SIDE + 1}, (_, n) => {
	const from = Int32Array.from({length: 8}, (_cell, i) => floorDiv(i * n, 8));
	const to = from.map((a, i) => Math.max(floorDiv((i + 1) * n, 8), a + 1));
	return {from, to};
});

function toGrid(
	plane: Int32Array,
	w: number,
	h: number,
	grid: Int32Array,
): void {
	const columns = coverages[w];
	const rows = coverages[h];
	for (let i = 0; i < 8; i++) {
		for (let j = 0; j < 8; j++) {
			let sum = 0;
			for (let y = rows.from[i]; y < rows.to[i]; y++) {
				for (let x = columns.from[j]; x < columns.to[j]; x++) {
					sum += plane[y * w + x];
				}
			}

			const count =
				(rows.to[i] - rows.from[i]) * (columns.to[j] - columns.from[j]);
			grid[i * 8 + j] = Math.trunc((sum + (count >> 1)) / count);
		}
	}
}

const sharedGrid = new Int32Array(64);
const cellSums = new Int32Array(MAX_SIDE * MAX_SIDE);
const cellCounts = new Int32Array(MAX_SIDE * MAX_SIDE);

function fromGrid(
	grid: Int32Array,
	w: number,
	h: number,
	plane: Int32Array,
): void {
	const columns = coverages[w];
	const rows = coverages[h];
	cellSums.fill(0, 0, w * h);
	cellCounts.fill(0, 0, w * h);
	for (let i = 0; i < 8; i++) {
		for (let j = 0; j < 8; j++) {
			const value = grid[i * 8 + j];
			for (let y = rows.from[i]; y < rows.to[i]; y++) {
				for (let x = columns.from[j]; x < columns.to[j]; x++) {
					cellSums[y * w + x] += value;
					cellCounts[y * w + x]++;
				}
			}
		}
	}

	for (let p = 0; p < w * h; p++) {
		const count = cellCounts[p];
		plane[p] = Math.trunc((cellSums[p] + (count >> 1)) / count);
	}
}

/**
Runs steps 3 to 8 on one plane of a `w` by `h` block, in place.
*/
function crushPlane(
	plane: Int32Array,
	w: number,
	h: number,
	table: Int32Array,
	edit: ((block: Int32Array) => void) | undefined,
): void {
	// An 8 by 8 block is its own grid.
	const isGrid = w === 8 && h === 8;
	const block = isGrid ? plane : sharedGrid;
	if (!isGrid) {
		toGrid(plane, w, h, block);
	}

	forwardDct(block);
	quantise(block, table);
	edit?.(block);
	inverseDct(block);
	if (!isGrid) {
		fromGrid(block, w, h, plane);
	}
}

/**
 `floorDiv(n, 1000)` for `0 <= n < 470000`, as `floorDiv(n >> 3, 125)` by a
 multiply and a shift.
 */
export function thousandth(n: number): number {
	return ((n >> 3) * 33_555) >> 22;
}

// The step 9 offsets that depend on one chroma channel, indexed by its value.
const redOffsets = Int16Array.from({length: 256}, (_, cr) =>
	floorDiv(1402 * (cr - 128) + 500, 1000),
);
const blueOffsets = Int16Array.from({length: 256}, (_, cb) =>
	floorDiv(1772 * (cb - 128) + 500, 1000),
);

/**
Replaces every sample with the rounded mean of its chroma sub-block.
*/
function subsample(
	plane: Int32Array,
	w: number,
	h: number,
	columnSubs: Int32Array,
	rowSubs: Int32Array,
): void {
	let top = 0;
	while (top < h) {
		let bottom = top + 1;
		while (bottom < h && rowSubs[bottom] === rowSubs[top]) {
			bottom++;
		}

		let left = 0;
		while (left < w) {
			let right = left + 1;
			while (right < w && columnSubs[right] === columnSubs[left]) {
				right++;
			}

			let sum = 0;
			for (let y = top; y < bottom; y++) {
				for (let x = left; x < right; x++) {
					sum += plane[y * w + x];
				}
			}

			const count = (bottom - top) * (right - left);
			const mean = Math.trunc((sum + (count >> 1)) / count);
			for (let y = top; y < bottom; y++) {
				for (let p = y * w + left; p < y * w + right; p++) {
					plane[p] = mean;
				}
			}

			left = right;
		}

		top = bottom;
	}
}

export const jpegCrushEffect: EffectDefinition<JpegCrushParams> = {
	...jpegCrushSpec,
	async render(input, output, params, ctx) {
		const {width, height, data: src} = input;
		const dst = output.data;
		const {scale} = ctx;
		const {blockSize, quality, chromaSubsample, seed} = params;
		const lumaQ = scaledTable(LUMA_TABLE, quality);
		const chromaQ = scaledTable(CHROMA_TABLE, quality);
		const columns = sourceAxis(width, scale, blockSize);
		const rows = sourceAxis(height, scale, blockSize);

		const luma = new Int32Array(MAX_SIDE * MAX_SIDE);
		const blue = new Int32Array(MAX_SIDE * MAX_SIDE);
		const red = new Int32Array(MAX_SIDE * MAX_SIDE);
		let sinceCheckpoint = CHECKPOINT_PIXELS;

		for (let r = 0; r < rows.blocks.length; r++) {
			const y0 = rows.starts[r];
			const h = rows.starts[r + 1] - y0;
			const rowSubs = rows.subBlocks.subarray(y0, y0 + h);

			for (let c = 0; c < columns.blocks.length; c++) {
				const x0 = columns.starts[c];
				const w = columns.starts[c + 1] - x0;
				if (sinceCheckpoint + w * h > CHECKPOINT_PIXELS) {
					const pending = ctx.checkpoint();
					if (pending) {
						await pending;
					}

					sinceCheckpoint = 0;
				}

				sinceCheckpoint += w * h;

				for (let y = 0; y < h; y++) {
					let read = ((y0 + y) * width + x0) * 4;
					for (let p = y * w; p < (y + 1) * w; p++, read += 4) {
						const r8 = src[read];
						const g8 = src[read + 1];
						const b8 = src[read + 2];
						luma[p] = thousandth(299 * r8 + 587 * g8 + 114 * b8 + 500);
						// Adding 128 * 1000 first keeps the dividend positive.
						const cb = thousandth(-169 * r8 - 331 * g8 + 500 * b8 + 128_500);
						const cr = thousandth(500 * r8 - 419 * g8 - 81 * b8 + 128_500);
						blue[p] = Math.min(cb, 255);
						red[p] = Math.min(cr, 255);
					}
				}

				if (chromaSubsample) {
					const columnSubs = columns.subBlocks.subarray(x0, x0 + w);
					subsample(blue, w, h, columnSubs, rowSubs);
					subsample(red, w, h, columnSubs, rowSubs);
				}

				const bent = corruptionFor(params, columns.blocks[c], rows.blocks[r]);

				crushPlane(
					luma,
					w,
					h,
					lumaQ,
					bent &&
						((block) => {
							corruptLuma(block, bent, seed);
						}),
				);
				crushPlane(
					blue,
					w,
					h,
					chromaQ,
					bent &&
						((block) => {
							block[0] += 8 * bent.cb;
						}),
				);
				crushPlane(
					red,
					w,
					h,
					chromaQ,
					bent &&
						((block) => {
							block[0] += 8 * bent.cr;
						}),
				);

				for (let y = 0; y < h; y++) {
					let write = ((y0 + y) * width + x0) * 4;
					for (let p = y * w; p < (y + 1) * w; p++, write += 4) {
						const y8 = luma[p];
						const cb = blue[p];
						const cr = red[p];
						// The green dividend is shifted by 200 * 1000 to stay positive.
						const green =
							thousandth(200_500 - 344 * (cb - 128) - 714 * (cr - 128)) - 200;
						// `dst` is clamped, so out-of-range sums saturate to 0..255.
						dst[write] = y8 + redOffsets[cr];
						dst[write + 1] = y8 + green;
						dst[write + 2] = y8 + blueOffsets[cb];
						dst[write + 3] = src[write + 3];
					}
				}
			}

			ctx.progress((y0 + h) / height);
		}
	},
};

export {type JpegCrushParams} from './jpeg-crush-spec.ts';
