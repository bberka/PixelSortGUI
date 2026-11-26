/* eslint-disable no-bitwise -- bit crush is defined as a byte mask */
import {floorDiv} from '../math.ts';
import type {EffectDefinition} from '../types.ts';
import {posterizeSpec, type PosterizeParams} from './posterize-spec.ts';

const CHECKPOINT_PIXELS = 16_384;

function buildTable({mode, levels, bitsDropped}: PosterizeParams): Uint8Array {
	const table = new Uint8Array(256);
	const mask = (0xff << bitsDropped) & 0xff;
	const steps = levels - 1;
	for (let c = 0; c < 256; c++) {
		table[c] =
			mode === 'bitCrush'
				? c & mask
				: floorDiv(
						floorDiv(c * steps + 127, 255) * 255 + floorDiv(steps, 2),
						steps,
					);
	}

	return table;
}

export const posterizeEffect: EffectDefinition<PosterizeParams> = {
	...posterizeSpec,
	async render(input, output, params, ctx) {
		const src = input.data;
		const dst = output.data;
		const table = buildTable(params);
		const sliceBytes = CHECKPOINT_PIXELS * 4;

		for (let start = 0; start < src.length; start += sliceBytes) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const end = Math.min(src.length, start + sliceBytes);
			if (params.preserveLuma) {
				for (let i = start; i < end; i += 4) {
					const luma = floorDiv(
						2126 * src[i] + 7152 * src[i + 1] + 722 * src[i + 2] + 5000,
						10_000,
					);
					const value = table[luma];
					dst[i] = value;
					dst[i + 1] = value;
					dst[i + 2] = value;
					dst[i + 3] = src[i + 3];
				}
			} else {
				for (let i = start; i < end; i += 4) {
					dst[i] = table[src[i]];
					dst[i + 1] = table[src[i + 1]];
					dst[i + 2] = table[src[i + 2]];
					dst[i + 3] = src[i + 3];
				}
			}

			ctx.progress(end / src.length);
		}
	},
};

export {type PosterizeMode, type PosterizeParams} from './posterize-spec.ts';
