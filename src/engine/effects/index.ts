import {createRegistry} from '../registry.ts';
import type {EffectDefinition} from '../types.ts';
import {
	channelShiftSpec,
	type ChannelShiftParams,
} from './channel-shift-spec.ts';
import {channelSwapSpec, type ChannelSwapParams} from './channel-swap-spec.ts';
import {pixelSortSpec, type PixelSortParams} from './pixel-sort/spec.ts';

const lazyPixelSortEffect: EffectDefinition<PixelSortParams> = {
	...pixelSortSpec,
	async render(input, output, params, ctx) {
		const {pixelSortEffect} = await import('./pixel-sort/index.ts');
		return pixelSortEffect.render(input, output, params, ctx);
	},
};

const lazyChannelShiftEffect: EffectDefinition<ChannelShiftParams> = {
	...channelShiftSpec,
	async render(input, output, params, ctx) {
		const {channelShiftEffect} = await import('./channel-shift.ts');
		return channelShiftEffect.render(input, output, params, ctx);
	},
};

const lazyChannelSwapEffect: EffectDefinition<ChannelSwapParams> = {
	...channelSwapSpec,
	async render(input, output, params, ctx) {
		const {channelSwapEffect} = await import('./channel-swap.ts');
		return channelSwapEffect.render(input, output, params, ctx);
	},
};

/**
 Main-thread effect registry: carries schemas, labels, and defaults without
 statically importing render implementations (such as the direction table).
 Calling `render` dynamically loads the implementation if ever invoked outside
 a worker.
 */
export const effects: readonly EffectDefinition[] = [
	lazyPixelSortEffect,
	lazyChannelShiftEffect,
	lazyChannelSwapEffect,
];

export const effectRegistry = createRegistry(effects);
