import {createRegistry} from '../registry.ts';
import type {EffectDefinition} from '../types.ts';
import {channelShiftEffect} from './channel-shift.ts';
import {channelSwapEffect} from './channel-swap.ts';
import {pixelSortEffect} from './pixel-sort/index.ts';

/**
 Static effect registry for render workers, bundling all render implementations
 directly so workers do not dynamically import modules at render time.
 */
export const runtimeEffects: readonly EffectDefinition[] = [
	pixelSortEffect,
	channelShiftEffect,
	channelSwapEffect,
];

export const runtimeEffectRegistry = createRegistry(runtimeEffects);
