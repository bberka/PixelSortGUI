import {createRegistry} from '../registry.ts';
import type {EffectDefinition} from '../types.ts';
import {pixelSortEffect} from './pixel-sort/index.ts';

export const effects: readonly EffectDefinition[] = [pixelSortEffect];

export const effectRegistry = createRegistry(effects);
