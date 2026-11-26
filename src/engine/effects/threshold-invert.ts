/* eslint-disable no-bitwise -- the selection view quarters channels with a shift (engine.md section 16.1) */
import {getKeyFn} from '../keys.ts';
import type {EffectDefinition} from '../types.ts';
import {thresholdBound} from './pixel-sort/select.ts';
import {
	thresholdInvertSpec,
	type ThresholdInvertParams,
} from './threshold-invert-spec.ts';

const CHECKPOINT_PIXELS = 16_384;

export const thresholdInvertEffect: EffectDefinition<ThresholdInvertParams> = {
	...thresholdInvertSpec,
	async render(input, output, params, ctx) {
		const {width, height} = input;
		const src = input.data;
		const dst = output.data;
		const key16 = getKeyFn(params.selectKey);
		const lo16 = thresholdBound(params.threshold[0]);
		const hi16 = thresholdBound(params.threshold[1]);
		const {channels, invertSelection} = params;
		const flipRed = channels === 'rgb' || channels === 'red';
		const flipGreen = channels === 'rgb' || channels === 'green';
		const flipBlue = channels === 'rgb' || channels === 'blue';
		const showSelection = ctx.debugView === 'selection';
		const total = width * height;

		for (let start = 0; start < total; start += CHECKPOINT_PIXELS) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const end = Math.min(total, start + CHECKPOINT_PIXELS);
			for (let i = start * 4; i < end * 4; i += 4) {
				const r = src[i];
				const g = src[i + 1];
				const b = src[i + 2];
				const a = src[i + 3];
				const key = key16(r, g, b);
				const selected =
					a !== 0 && (key >= lo16 && key <= hi16) !== invertSelection;
				if (showSelection) {
					dst[i] = selected ? r : r >> 2;
					dst[i + 1] = selected ? g : g >> 2;
					dst[i + 2] = selected ? b : b >> 2;
				} else {
					dst[i] = selected && flipRed ? 255 - r : r;
					dst[i + 1] = selected && flipGreen ? 255 - g : g;
					dst[i + 2] = selected && flipBlue ? 255 - b : b;
				}

				dst[i + 3] = a;
			}

			ctx.progress(end / total);
		}
	},
};

export {
	type ThresholdInvertChannels,
	type ThresholdInvertParams,
} from './threshold-invert-spec.ts';
