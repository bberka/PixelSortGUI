/**
 A direct, unoptimised reading of engine.md section 16.1 steps 1 to 9, used as
 the reference for the kernel in `jpeg-crush.ts`.
 */
import {
	CHROMA_TABLE,
	DCT_TABLE,
	LUMA_TABLE,
	type JpegCrushParams,
} from '../../src/engine/effects/jpeg-crush.ts';
import {intIn, unit} from '../../src/engine/random.ts';
import {createImage, type RgbaImage} from '../../src/engine/types.ts';

const fd = (a: number, b: number) => Math.floor(a / b);
const roundDiv = (sum: number, n: number) => fd(sum + fd(n, 2), n);
const byte = (v: number) => Math.min(255, Math.max(0, v));
const EIGHT = [0, 1, 2, 3, 4, 5, 6, 7];
const sum8 = (term: (i: number) => number) => {
	let total = 0;
	for (const i of EIGHT) {
		total += term(i);
	}

	return total;
};

const matrix = (cell: (a: number, b: number) => number) =>
	EIGHT.map((a) => EIGHT.map((b) => cell(a, b)));

const c = (u: number, i: number) => DCT_TABLE[u * 8 + i];

function groups(length: number, key: (i: number) => number): number[][] {
	const found = new Map<number, number[]>();
	for (let i = 0; i < length; i++) {
		found.set(key(i), [...(found.get(key(i)) ?? []), i]);
	}

	return [...found.values()];
}

const covers = (n: number, cell: number, p: number) => {
	const a = fd(cell * n, 8);
	return p >= a && p < Math.max(fd((cell + 1) * n, 8), a + 1);
};

// The rounded mean of the values whose position passes `keep` on both axes.
function meanOf(
	plane: number[][],
	keepRow: (y: number) => boolean,
	keepColumn: (x: number) => boolean,
): number {
	let total = 0;
	let count = 0;
	for (const [y, row] of plane.entries()) {
		for (const [x, value] of row.entries()) {
			if (!(keepRow(y) && keepColumn(x))) {
				continue;
			}

			total += value;
			count++;
		}
	}

	return roundDiv(total, count);
}

export function modelJpegCrush(
	input: RgbaImage,
	params: JpegCrushParams,
	sourceWidth: number,
): RgbaImage {
	const {blockSize, quality, chromaSubsample, seed} = params;
	const scale = input.width / sourceWidth;
	const source = (i: number) => Math.floor((i + 0.5) / scale);
	const subSize = Math.max(2, fd(blockSize, 2));
	const strength = Math.round(params.corruptShift * 127);
	const k = quality < 50 ? fd(5000, quality) : 200 - 2 * quality;
	const output = createImage(input.width, input.height);
	const blockOf = (i: number) => fd(source(i), blockSize);

	for (const ys of groups(input.height, blockOf)) {
		for (const xs of groups(input.width, blockOf)) {
			const bx = blockOf(xs[0]);
			const by = blockOf(ys[0]);
			const w = xs.length;
			const h = ys.length;
			const offset = (x: number, y: number) =>
				(ys[y] * input.width + xs[x]) * 4;
			const planes = [0, 1, 2].map((plane) =>
				ys.map((_, y) =>
					xs.map((_column, x) => {
						const [r, g, b] = input.data.subarray(offset(x, y));
						return [
							fd(299 * r + 587 * g + 114 * b + 500, 1000),
							byte(128 + fd(-169 * r - 331 * g + 500 * b + 500, 1000)),
							byte(128 + fd(500 * r - 419 * g - 81 * b + 500, 1000)),
						][plane];
					}),
				),
			);
			const bent =
				params.corruptRate > 0 &&
				strength > 0 &&
				unit(seed, 1, bx, by) < params.corruptRate;

			const crushed = planes.map((original, plane) => {
				let samples = original;
				if (chromaSubsample && plane > 0) {
					const sub = (i: number) =>
						fd(source(i) - blockOf(i) * blockSize, subSize);
					samples = original.map((row, y) =>
						row.map((_, x) =>
							meanOf(
								original,
								(my) => sub(ys[my]) === sub(ys[y]),
								(mx) => sub(xs[mx]) === sub(xs[x]),
							),
						),
					);
				}

				const f = matrix(
					(i, j) =>
						meanOf(
							samples,
							(y) => covers(h, i, y),
							(x) => covers(w, j, x),
						) - 128,
				);
				const t = matrix((i, v) =>
					fd(sum8((j) => c(v, j) * f[i][j]) + 1024, 2048),
				);
				const table = plane === 0 ? LUMA_TABLE : CHROMA_TABLE;
				const coefficients = matrix((u, v) => {
					const s = sum8((i) => c(u, i) * t[i][v]);
					const q = Math.min(
						255,
						Math.max(1, fd(table[u * 8 + v] * k + 50, 100)),
					);
					return Math.sign(s) * fd(Math.abs(s) + q * 16_384, q * 32_768) * q;
				}).flat();

				if (bent && plane > 0) {
					coefficients[0] +=
						8 * intIn(-strength, strength, seed, plane + 1, bx, by);
				}

				if (bent && plane === 0) {
					const edits = intIn(1, 3, seed, 4, bx, by);
					for (let e = 0; e < edits; e++) {
						const p = intIn(1, 63, seed, 4, bx, by, e, 0);
						if (unit(seed, 4, bx, by, e, 1) < 0.5) {
							coefficients[p] = 0;
						} else {
							const other = intIn(1, 63, seed, 4, bx, by, e, 2);
							[coefficients[p], coefficients[other]] = [
								coefficients[other],
								coefficients[p],
							];
						}
					}
				}

				const back = matrix((i, v) =>
					fd(sum8((u) => c(u, i) * coefficients[u * 8 + v]) + 1024, 2048),
				);
				const cells = matrix((i, j) =>
					byte(fd(sum8((v) => c(v, j) * back[i][v]) + 16_384, 32_768) + 128),
				);

				return ys.map((_, y) =>
					xs.map((_column, x) =>
						meanOf(
							cells,
							(i) => covers(h, i, y),
							(j) => covers(w, j, x),
						),
					),
				);
			});

			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					const luma = crushed[0][y][x];
					const cb = crushed[1][y][x] - 128;
					const cr = crushed[2][y][x] - 128;
					output.data.set(
						[
							byte(luma + fd(1402 * cr + 500, 1000)),
							byte(luma + fd(-344 * cb - 714 * cr + 500, 1000)),
							byte(luma + fd(1772 * cb + 500, 1000)),
							input.data[offset(x, y) + 3],
						],
						offset(x, y),
					);
				}
			}
		}
	}

	return output;
}
