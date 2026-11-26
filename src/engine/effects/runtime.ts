import {createRegistry} from '../registry.ts';
import type {EffectDefinition} from '../types.ts';
import {bayerDitherEffect} from './bayer-dither.ts';
import {blockShuffleEffect} from './block-shuffle.ts';
import {channelShiftEffect} from './channel-shift.ts';
import {channelSwapEffect} from './channel-swap.ts';
import {mirrorFoldEffect} from './mirror-fold.ts';
import {pixelSortEffect} from './pixel-sort/index.ts';
import {sliceShiftEffect} from './slice-shift.ts';
import {posterizeEffect} from './posterize.ts';
import {scanlineWaveEffect} from './scanline-wave.ts';

/**
 Static effect registry for render workers, bundling all render implementations
 directly so workers do not dynamically import modules at render time.
 */
export const runtimeEffects: readonly EffectDefinition[] = [
	pixelSortEffect,
	channelShiftEffect,
	channelSwapEffect,
	sliceShiftEffect,
	blockShuffleEffect,
	posterizeEffect,
	scanlineWaveEffect,
	mirrorFoldEffect,
	bayerDitherEffect,
];

export const runtimeEffectRegistry = createRegistry(runtimeEffects);
