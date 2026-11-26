import {floorDiv} from '../math.ts';
import {intIn, unit} from '../random.ts';
import type {EffectDefinition} from '../types.ts';
import {rgbNoiseSpec, type RgbNoiseParams} from './rgb-noise-spec.ts';

const CHECKPOINT_PIXELS = 16_384;

// Purpose codes for the random draws (engine.md section 16.1).
const P_RED = 1;
const P_GREEN = 2;
const P_BLUE = 3;
const P_DROPOUT = 4;
const P_HOT = 5;

export const rgbNoiseEffect: EffectDefinition<RgbNoiseParams> = {
	...rgbNoiseSpec,
	async render(input, output, params, ctx) {
		const {amount, monochrome, dropout, grainSize, seed} = params;
		const {width, height, data: src} = input;
		const dst = output.data;
		const amp = Math.round(amount * 255);

		// The grain cell of render pixel `(x, y)`, fixed in source space.
		let gx = 0;
		let gy = 0;
		// The current cell's draw: a replacement grey for a dead or hot pixel,
		// otherwise `replacement` is -1 and the deltas are added to the input.
		let replacement = -1;
		let red = 0;
		let green = 0;
		let blue = 0;
		const drawCell = () => {
			if (dropout > 0 && unit(seed, P_DROPOUT, gx, gy) < dropout) {
				replacement = unit(seed, P_HOT, gx, gy) >= 0.5 ? 255 : 0;
				return;
			}

			replacement = -1;
			red = intIn(-amp, amp, seed, P_RED, gx, gy);
			green = monochrome ? red : intIn(-amp, amp, seed, P_GREEN, gx, gy);
			blue = monochrome ? red : intIn(-amp, amp, seed, P_BLUE, gx, gy);
		};

		for (let start = 0; start < width * height; start += CHECKPOINT_PIXELS) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const end = Math.min(width * height, start + CHECKPOINT_PIXELS);
			let previousGx = -1;
			for (let pixel = start; pixel < end; pixel++) {
				const x = pixel % width;
				gx = floorDiv(ctx.toSource(x), grainSize);
				// Neighbouring pixels of one row often share a cell.
				if (x === 0 || gx !== previousGx) {
					gy = floorDiv(ctx.toSource(floorDiv(pixel, width)), grainSize);
					drawCell();
					previousGx = gx;
				}

				const i = pixel * 4;
				// The clamped array keeps every sum in 0..255.
				dst[i] = replacement < 0 ? src[i] + red : replacement;
				dst[i + 1] = replacement < 0 ? src[i + 1] + green : replacement;
				dst[i + 2] = replacement < 0 ? src[i + 2] + blue : replacement;
				dst[i + 3] = src[i + 3];
			}

			ctx.progress(end / (width * height));
		}
	},
};

export {type RgbNoiseParams} from './rgb-noise-spec.ts';
