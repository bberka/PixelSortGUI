import {DIRECTION_TABLE} from '../direction-table.ts';
import {clamp, floorDiv, roundHalfAway, wrap} from '../math.ts';
import {intIn} from '../random.ts';
import type {EffectDefinition, RenderContext} from '../types.ts';
import {
	scanlineWaveSpec,
	type ScanlineWaveform,
	type ScanlineWaveParams,
} from './scanline-wave-spec.ts';

const CHECKPOINT_PIXELS = 16_384;

// Purpose code for the jitter draw (engine.md section 16.1).
const P_JITTER = 1;

// The wave in [-1, 1] at `index` tenths of a degree into the cycle.
function waveAt(waveform: ScanlineWaveform, index: number): number {
	const position = index / 3600;
	switch (waveform) {
		case 'sine': {
			return -DIRECTION_TABLE[index][1] / 4096;
		}

		case 'triangle': {
			if (position < 0.25) {
				return 4 * position;
			}

			return position < 0.75 ? 2 - 4 * position : 4 * position - 4;
		}

		case 'square': {
			return index < 1800 ? 1 : -1;
		}

		case 'sawtooth': {
			return 2 * position - 1;
		}
	}
}

/**
 The render-pixel offset of each of the `lineCount` render lines. The wave and
 the jitter are evaluated at source lines, so every render size follows the same
 curve.
 */
function lineOffsets(
	lineCount: number,
	sourceCount: number,
	params: ScanlineWaveParams,
	ctx: RenderContext,
): Int32Array {
	const {waveform, amplitude, wavelength, jitter, seed} = params;
	const phaseIndex = Math.round(params.phase * 10);
	const offsets = new Int32Array(lineCount);
	for (let line = 0; line < lineCount; line++) {
		const source = clamp(ctx.toSource(line), 0, sourceCount - 1);
		const index = wrap(floorDiv(source * 3600, wavelength) + phaseIndex, 3600);
		let offset = roundHalfAway(amplitude * waveAt(waveform, index));
		if (jitter > 0) {
			offset += intIn(-jitter, jitter, seed, P_JITTER, source);
		}

		offsets[line] = ctx.px(offset);
	}

	return offsets;
}

export const scanlineWaveEffect: EffectDefinition<ScanlineWaveParams> = {
	...scanlineWaveSpec,
	async render(input, output, params, ctx) {
		const {width, height, data: src} = input;
		const dst = output.data;
		const isRows = params.axis === 'horizontal';
		const isWrap = params.edge === 'wrap';
		const offsets = isRows
			? lineOffsets(height, ctx.sourceHeight, params, ctx)
			: lineOffsets(width, ctx.sourceWidth, params, ctx);
		const rowsPerSlice = Math.max(1, Math.floor(CHECKPOINT_PIXELS / width));

		for (let yStart = 0; yStart < height; yStart += rowsPerSlice) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const yEnd = Math.min(height, yStart + rowsPerSlice);
			for (let y = yStart; y < yEnd; y++) {
				for (let x = 0, i = y * width * 4; x < width; x++, i += 4) {
					const sx = isRows ? x - offsets[y] : x;
					const sy = isRows ? y : y - offsets[x];
					const column = isWrap ? wrap(sx, width) : clamp(sx, 0, width - 1);
					const row = isWrap ? wrap(sy, height) : clamp(sy, 0, height - 1);
					const from = (row * width + column) * 4;
					dst[i] = src[from];
					dst[i + 1] = src[from + 1];
					dst[i + 2] = src[from + 2];
					dst[i + 3] = src[from + 3];
				}
			}

			ctx.progress(yEnd / height);
		}
	},
};

export {
	type ScanlineWaveAxis,
	type ScanlineWaveEdge,
	type ScanlineWaveform,
	type ScanlineWaveParams,
} from './scanline-wave-spec.ts';
