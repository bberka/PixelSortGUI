import {clamp, floorDiv, wrap} from '../math.ts';
import type {EffectDefinition, RenderContext} from '../types.ts';
import {
	bayerDitherSpec,
	type BayerDitherMatrix,
	type BayerDitherParams,
} from './bayer-dither-spec.ts';

const CHECKPOINT_PIXELS = 16_384;

// Row-major recursive Bayer threshold matrices.
export const BAYER_MATRICES: Readonly<
	Record<BayerDitherMatrix, readonly number[]>
> = {
	2: [0, 2, 3, 1],
	4: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
	8: [
		0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36,
		14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
		51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55,
		23, 61, 29, 53, 21,
	],
};

// One 256-entry output table per matrix cell, so the pixel loop only looks up.
function buildTables({matrix, levels, spread}: BayerDitherParams): Uint8Array {
	const thresholds = BAYER_MATRICES[matrix];
	const cells = thresholds.length;
	const steps = levels - 1;
	const q = 255 / steps;
	const s = Math.round(spread * 100) / 100;
	const tables = new Uint8Array(cells * 256);
	for (let cell = 0; cell < cells; cell++) {
		const d = (thresholds[cell] + 0.5) / cells - 0.5;
		for (let c = 0; c < 256; c++) {
			const v = clamp(c + d * q * s, 0, 255);
			const index = Math.floor((v * steps) / 255 + 0.5);
			tables[cell * 256 + c] = floorDiv(
				index * 255 + floorDiv(steps, 2),
				steps,
			);
		}
	}

	return tables;
}

// Matrix coordinate of every render coordinate along one axis, in source space.
function matrixCoordinates(
	length: number,
	{matrix, pixelScale}: BayerDitherParams,
	ctx: RenderContext,
): Uint8Array {
	const size = Number(matrix);
	return Uint8Array.from({length}, (_, i) =>
		wrap(floorDiv(ctx.toSource(i), pixelScale), size),
	);
}

export const bayerDitherEffect: EffectDefinition<BayerDitherParams> = {
	...bayerDitherSpec,
	async render(input, output, params, ctx) {
		const {width, height} = input;
		const src = input.data;
		const dst = output.data;
		const size = Number(params.matrix);
		const tables = buildTables(params);
		const columns = matrixCoordinates(width, params, ctx);
		const rows = matrixCoordinates(height, params, ctx);
		const total = width * height;

		for (let start = 0; start < total; start += CHECKPOINT_PIXELS) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const end = Math.min(total, start + CHECKPOINT_PIXELS);
			for (let p = start; p < end; p++) {
				const table =
					(rows[floorDiv(p, width)] * size + columns[p % width]) * 256;
				const i = p * 4;
				if (params.monochrome) {
					const luma = floorDiv(
						2126 * src[i] + 7152 * src[i + 1] + 722 * src[i + 2] + 5000,
						10_000,
					);
					const value = tables[table + luma];
					dst[i] = value;
					dst[i + 1] = value;
					dst[i + 2] = value;
				} else {
					dst[i] = tables[table + src[i]];
					dst[i + 1] = tables[table + src[i + 1]];
					dst[i + 2] = tables[table + src[i + 2]];
				}

				dst[i + 3] = src[i + 3];
			}

			ctx.progress(end / total);
		}
	},
};

export {
	type BayerDitherMatrix,
	type BayerDitherParams,
} from './bayer-dither-spec.ts';
