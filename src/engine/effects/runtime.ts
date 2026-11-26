import {createRegistry} from '../registry.ts';
import type {EffectDefinition} from '../types.ts';
import {bayerDitherEffect} from './bayer-dither.ts';
import {blockShuffleEffect} from './block-shuffle.ts';
import {channelShiftEffect} from './channel-shift.ts';
import {channelSwapEffect} from './channel-swap.ts';
import {imageBlendEffect} from './image-blend.ts';
import {jpegCrushEffect} from './jpeg-crush.ts';
import {mirrorFoldEffect} from './mirror-fold.ts';
import {pixelSmearEffect} from './pixel-smear.ts';
import {pixelSortEffect} from './pixel-sort/index.ts';
import {sliceShiftEffect} from './slice-shift.ts';
import {posterizeEffect} from './posterize.ts';
import {rgbNoiseEffect} from './rgb-noise.ts';
import {scanlineWaveEffect} from './scanline-wave.ts';
import {thresholdInvertEffect} from './threshold-invert.ts';

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
	rgbNoiseEffect,
	thresholdInvertEffect,
	pixelSmearEffect,
	jpegCrushEffect,
	imageBlendEffect,
];

export const runtimeEffectRegistry = createRegistry(runtimeEffects);
