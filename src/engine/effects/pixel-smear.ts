import {createLinePartition, normalizeAngleIndex} from '../lines.ts';
import type {EffectDefinition, RenderContext, RgbaImage} from '../types.ts';
import {pixelSmearSpec, type PixelSmearParams} from './pixel-smear-spec.ts';
import {inputWords} from './pixel-sort/index.ts';
import {
	fillKeys,
	selectThreshold,
	thresholdBound,
	writeSelectionView,
} from './pixel-sort/select.ts';

const CHECKPOINT_PIXELS = 16_384;

/**
 Smears one line of RGBA bytes in place. A selected pixel reloads the carried
 colour; each visible unselected pixel after it blends with the carry until the
 trail has covered `trail` pixels. `d` is the decay in thousandths.
 */
function smearLine(
	line: Uint8Array,
	selected: Uint8Array,
	length: number,
	trail: number,
	d: number,
): void {
	const keep = 1000 - d;
	let red = 0;
	let green = 0;
	let blue = 0;
	let remaining = 0;
	for (let i = 0, p = 0; i < length; i++, p += 4) {
		if (selected[i] !== 0) {
			red = line[p];
			green = line[p + 1];
			blue = line[p + 2];
			remaining = trail;
		} else if (remaining > 0 && line[p + 3] > 0) {
			// `floorDiv(2 * n + 1000, 2000)` on a non-negative `n`.
			red = Math.trunc((2 * (red * d + line[p] * keep) + 1000) / 2000);
			green = Math.trunc((2 * (green * d + line[p + 1] * keep) + 1000) / 2000);
			blue = Math.trunc((2 * (blue * d + line[p + 2] * keep) + 1000) / 2000);
			line[p] = red;
			line[p + 1] = green;
			line[p + 2] = blue;
			remaining--;
		}
	}
}

/**
 The 90 and 270 degree walk, visiting the image row by row so memory is read in
 order. Every column is one line, so each keeps its own carry and trail.
 */
async function smearColumns(
	input: RgbaImage,
	output: RgbaImage,
	params: PixelSmearParams,
	ctx: RenderContext,
	downward: boolean,
): Promise<void> {
	const {width, height} = input;
	const src = new Uint8Array(
		input.data.buffer,
		input.data.byteOffset,
		input.data.byteLength,
	);
	const dst = output.data;
	const keys = new Uint16Array(width);
	const carry = new Uint8Array(width * 3);
	const remaining = new Int32Array(width);

	const lo16 = thresholdBound(params.threshold[0]);
	const hi16 = thresholdBound(params.threshold[1]);
	const trail = ctx.pxLength(params.maxLength);
	const d = Math.round(params.decay * 1000);
	const keep = 1000 - d;
	const {invert} = params;

	let sinceCheckpoint = CHECKPOINT_PIXELS;
	for (let row = 0; row < height; row++) {
		if (sinceCheckpoint + width > CHECKPOINT_PIXELS) {
			ctx.progress(row / height);
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			sinceCheckpoint = 0;
		}

		sinceCheckpoint += width;

		const start = (downward ? row : height - 1 - row) * width * 4;
		const line = src.subarray(start, start + width * 4);
		fillKeys(params.selectKey, line, 0, width, keys);
		dst.set(line, start);
		for (let x = 0, p = 0, c = 0; x < width; x++, p += 4, c += 3) {
			const key = keys[x];
			const alpha = line[p + 3];
			// `selectThreshold`, fused so the row is walked once.
			if (alpha !== 0 && (key >= lo16 && key <= hi16) !== invert) {
				carry[c] = line[p];
				carry[c + 1] = line[p + 1];
				carry[c + 2] = line[p + 2];
				remaining[x] = trail;
			} else if (remaining[x] > 0 && alpha > 0) {
				// `floorDiv(2 * n + 1000, 2000)` on a non-negative `n`.
				const red = Math.trunc((carry[c] * d + line[p] * keep + 500) / 1000);
				const green = Math.trunc(
					(carry[c + 1] * d + line[p + 1] * keep + 500) / 1000,
				);
				const blue = Math.trunc(
					(carry[c + 2] * d + line[p + 2] * keep + 500) / 1000,
				);
				carry[c] = red;
				carry[c + 1] = green;
				carry[c + 2] = blue;
				dst[start + p] = red;
				dst[start + p + 1] = green;
				dst[start + p + 2] = blue;
				remaining[x]--;
			}
		}
	}

	ctx.progress(1);
}

export const pixelSmearEffect: EffectDefinition<PixelSmearParams> = {
	...pixelSmearSpec,
	async render(input, output, params, ctx) {
		const angleIndex = normalizeAngleIndex(params.angle);
		const vertical = angleIndex === 900 || angleIndex === 2700;
		if (vertical && ctx.debugView !== 'selection') {
			await smearColumns(input, output, params, ctx, angleIndex === 2700);
			return;
		}

		const {width, height} = input;
		const total = width * height;
		const in32 = inputWords(input);
		const outAligned = output.data.byteOffset % 4 === 0;
		const out32 = outAligned
			? new Uint32Array(output.data.buffer, output.data.byteOffset, total)
			: new Uint32Array(total);
		const partition = createLinePartition(width, height, params.angle);
		const capacity = partition.maxLineLength;
		// Per-line buffers, free under the scratch limit (engine.md section 4.1).
		const pixels = new Uint32Array(capacity);
		const line = new Uint8Array(
			pixels.buffer,
			pixels.byteOffset,
			pixels.byteLength,
		);
		const keys = new Uint16Array(capacity);
		const selected = new Uint8Array(capacity);

		const lo16 = thresholdBound(params.threshold[0]);
		const hi16 = thresholdBound(params.threshold[1]);
		const trail = ctx.pxLength(params.maxLength);
		const d = Math.round(params.decay * 1000);
		const showSelection = ctx.debugView === 'selection';

		let done = 0;
		let sinceCheckpoint = CHECKPOINT_PIXELS;
		const walker = partition.createWalker();
		while (walker.next()) {
			const {length} = walker;
			if (sinceCheckpoint + length > CHECKPOINT_PIXELS) {
				ctx.progress(done / total);
				const pending = ctx.checkpoint();
				if (pending) {
					await pending;
				}

				sinceCheckpoint = 0;
			}

			sinceCheckpoint += length;
			done += length;

			walker.gather32(in32, pixels);
			fillKeys(params.selectKey, line, 0, length, keys);
			selectThreshold(line, keys, length, lo16, hi16, params.invert, selected);
			if (showSelection) {
				writeSelectionView(line, selected, length, line);
			} else {
				smearLine(line, selected, length, trail, d);
			}

			walker.scatter32(pixels, out32);
		}

		if (!outAligned) {
			output.data.set(
				new Uint8Array(out32.buffer, out32.byteOffset, out32.byteLength),
			);
		}

		ctx.progress(1);
	},
};

export {type PixelSmearParams} from './pixel-smear-spec.ts';
