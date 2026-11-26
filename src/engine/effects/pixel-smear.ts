import {createLinePartition} from '../lines.ts';
import type {EffectDefinition} from '../types.ts';
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

export const pixelSmearEffect: EffectDefinition<PixelSmearParams> = {
	...pixelSmearSpec,
	async render(input, output, params, ctx) {
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
