import type {EffectDefinition} from '../types.ts';
import {channelSwapSpec, type ChannelSwapParams} from './channel-swap-spec.ts';

const CHECKPOINT_PIXELS = 16_384;

export const channelSwapEffect: EffectDefinition<ChannelSwapParams> = {
	...channelSwapSpec,
	async render(input, output, params, ctx) {
		const src = input.data;
		const dst = output.data;
		// Byte offsets of the input channels written to output R, G and B.
		const r = 'rgb'.indexOf(params.order[0]);
		const g = 'rgb'.indexOf(params.order[1]);
		const b = 'rgb'.indexOf(params.order[2]);
		const sliceBytes = CHECKPOINT_PIXELS * 4;

		for (let start = 0; start < src.length; start += sliceBytes) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const end = Math.min(src.length, start + sliceBytes);
			for (let i = start; i < end; i += 4) {
				dst[i] = src[i + r];
				dst[i + 1] = src[i + g];
				dst[i + 2] = src[i + b];
				dst[i + 3] = src[i + 3];
			}

			ctx.progress(end / src.length);
		}
	},
};

export {
	type ChannelSwapOrder,
	type ChannelSwapParams,
} from './channel-swap-spec.ts';
