import {clamp, wrap} from '../math.ts';
import {intIn, unit} from '../random.ts';
import type {EffectDefinition, RenderContext} from '../types.ts';
import {sliceShiftSpec, type SliceShiftParams} from './slice-shift-spec.ts';

const CHECKPOINT_PIXELS = 16_384;

// Purpose codes for the random draws (engine.md section 16.1).
const P_SIZE = 1;
const P_ACTIVE = 2;
const P_OFFSET = 3;

/**
 The render-pixel offset of each of the `lineCount` render lines. Slices are laid
 out over the `sourceCount` source lines, so every render size sees the same
 slices. `toSource` never decreases, so one pass over the slices is enough.
 */
function lineOffsets(
	lineCount: number,
	sourceCount: number,
	params: SliceShiftParams,
	ctx: RenderContext,
): Int32Array {
	const {sliceMin, probability, maxOffset, seed} = params;
	const sliceMax = Math.max(sliceMin, params.sliceMax);
	const offsets = new Int32Array(lineCount);
	let slice = -1;
	let sliceEnd = 0;
	let offset = 0;

	for (let line = 0; line < lineCount; line++) {
		const sourceLine = clamp(ctx.toSource(line), 0, sourceCount - 1);
		while (sourceLine >= sliceEnd) {
			slice++;
			sliceEnd += intIn(sliceMin, sliceMax, seed, P_SIZE, slice);
			offset =
				unit(seed, P_ACTIVE, slice) < probability
					? ctx.px(intIn(-maxOffset, maxOffset, seed, P_OFFSET, slice))
					: 0;
		}

		offsets[line] = offset;
	}

	return offsets;
}

/**
 Writes row `y` of the output on the horizontal axis: one block copy of the
 pixels that stay inside the row, then the part the shift uncovered.
 */
function shiftRow(
	src: Uint8ClampedArray,
	dst: Uint8ClampedArray,
	rowStart: number,
	width: number,
	offset: number,
	isWrap: boolean,
): void {
	const shift = isWrap ? wrap(offset, width) : clamp(offset, -width, width);
	const from = rowStart + Math.max(0, -shift) * 4;
	const to = rowStart + Math.max(0, shift) * 4;
	const length = (width - Math.abs(shift)) * 4;
	dst.set(src.subarray(from, from + length), to);

	if (isWrap) {
		// `shift` is in 0..width-1 here: the row's tail moves to its start.
		dst.set(src.subarray(rowStart + length, rowStart + width * 4), rowStart);
		return;
	}

	const edge = shift > 0 ? rowStart : rowStart + (width - 1) * 4;
	const gapStart = shift > 0 ? rowStart : rowStart + length;
	for (let i = 0; i < Math.abs(shift) * 4; i++) {
		dst[gapStart + i] = src[edge + (i % 4)];
	}
}

export const sliceShiftEffect: EffectDefinition<SliceShiftParams> = {
	...sliceShiftSpec,
	async render(input, output, params, ctx) {
		const {width, height, data: src} = input;
		const dst = output.data;
		const isRows = params.axis === 'horizontal';
		const isWrap = params.edge === 'wrap';
		const offsets = isRows
			? lineOffsets(height, ctx.sourceHeight, params, ctx)
			: lineOffsets(width, ctx.sourceWidth, params, ctx);
		// Column ranges that share one offset, so a row copies each of them in one go.
		const columnRuns: number[] = [0];
		if (!isRows) {
			for (let x = 1; x <= width; x++) {
				if (x === width || offsets[x] !== offsets[x - 1]) {
					columnRuns.push(x);
				}
			}
		}

		const rowStride = width * 4;
		const rowsPerChunk = Math.max(1, Math.floor(CHECKPOINT_PIXELS / width));

		for (let yStart = 0; yStart < height; yStart += rowsPerChunk) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const yEnd = Math.min(height, yStart + rowsPerChunk);
			for (let y = yStart; y < yEnd; y++) {
				const rowStart = y * rowStride;
				if (isRows) {
					shiftRow(src, dst, rowStart, width, offsets[y], isWrap);
					continue;
				}

				for (let run = 1; run < columnRuns.length; run++) {
					const start = columnRuns[run - 1];
					const sourceY = isWrap
						? wrap(y - offsets[start], height)
						: clamp(y - offsets[start], 0, height - 1);
					const from = sourceY * rowStride;
					dst.set(
						src.subarray(from + start * 4, from + columnRuns[run] * 4),
						rowStart + start * 4,
					);
				}
			}

			ctx.progress(yEnd / height);
		}
	},
};

export {
	type SliceShiftAxis,
	type SliceShiftEdge,
	type SliceShiftParams,
} from './slice-shift-spec.ts';
