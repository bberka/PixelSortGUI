import {createRegistry} from '../registry.ts';
import type {EffectDefinition} from '../types.ts';
import {bayerDitherSpec, type BayerDitherParams} from './bayer-dither-spec.ts';
import {
	blockShuffleSpec,
	type BlockShuffleParams,
} from './block-shuffle-spec.ts';
import {
	channelShiftSpec,
	type ChannelShiftParams,
} from './channel-shift-spec.ts';
import {channelSwapSpec, type ChannelSwapParams} from './channel-swap-spec.ts';
import {pixelSortSpec, type PixelSortParams} from './pixel-sort/spec.ts';
import {sliceShiftSpec, type SliceShiftParams} from './slice-shift-spec.ts';
import {mirrorFoldSpec, type MirrorFoldParams} from './mirror-fold-spec.ts';
import {posterizeSpec, type PosterizeParams} from './posterize-spec.ts';
import {
	scanlineWaveSpec,
	type ScanlineWaveParams,
} from './scanline-wave-spec.ts';
import {
	thresholdInvertSpec,
	type ThresholdInvertParams,
} from './threshold-invert-spec.ts';

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

const lazySliceShiftEffect: EffectDefinition<SliceShiftParams> = {
	...sliceShiftSpec,
	async render(input, output, params, ctx) {
		const {sliceShiftEffect} = await import('./slice-shift.ts');
		return sliceShiftEffect.render(input, output, params, ctx);
	},
};

const lazyBlockShuffleEffect: EffectDefinition<BlockShuffleParams> = {
	...blockShuffleSpec,
	async render(input, output, params, ctx) {
		const {blockShuffleEffect} = await import('./block-shuffle.ts');
		return blockShuffleEffect.render(input, output, params, ctx);
	},
};

const lazyPosterizeEffect: EffectDefinition<PosterizeParams> = {
	...posterizeSpec,
	async render(input, output, params, ctx) {
		const {posterizeEffect} = await import('./posterize.ts');
		return posterizeEffect.render(input, output, params, ctx);
	},
};

const lazyScanlineWaveEffect: EffectDefinition<ScanlineWaveParams> = {
	...scanlineWaveSpec,
	async render(input, output, params, ctx) {
		const {scanlineWaveEffect} = await import('./scanline-wave.ts');
		return scanlineWaveEffect.render(input, output, params, ctx);
	},
};

const lazyMirrorFoldEffect: EffectDefinition<MirrorFoldParams> = {
	...mirrorFoldSpec,
	async render(input, output, params, ctx) {
		const {mirrorFoldEffect} = await import('./mirror-fold.ts');
		return mirrorFoldEffect.render(input, output, params, ctx);
	},
};

const lazyBayerDitherEffect: EffectDefinition<BayerDitherParams> = {
	...bayerDitherSpec,
	async render(input, output, params, ctx) {
		const {bayerDitherEffect} = await import('./bayer-dither.ts');
		return bayerDitherEffect.render(input, output, params, ctx);
	},
};

const lazyThresholdInvertEffect: EffectDefinition<ThresholdInvertParams> = {
	...thresholdInvertSpec,
	async render(input, output, params, ctx) {
		const {thresholdInvertEffect} = await import('./threshold-invert.ts');
		return thresholdInvertEffect.render(input, output, params, ctx);
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
	lazySliceShiftEffect,
	lazyBlockShuffleEffect,
	lazyPosterizeEffect,
	lazyScanlineWaveEffect,
	lazyMirrorFoldEffect,
	lazyBayerDitherEffect,
	lazyThresholdInvertEffect,
];

export const effectRegistry = createRegistry(effects);
