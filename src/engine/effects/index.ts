import {createRegistry} from '../registry.ts';
import type {EffectDefinition} from '../types.ts';
import {channelShiftEffect} from './channel-shift.ts';
import {pixelSortEffect} from './pixel-sort/index.ts';

export const effects: readonly EffectDefinition[] = [
	pixelSortEffect,
	channelShiftEffect,
];

export const effectRegistry = createRegistry(effects);
