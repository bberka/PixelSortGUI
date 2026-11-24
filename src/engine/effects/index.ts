import {createRegistry} from '../registry.ts';
import type {EffectDefinition} from '../types.ts';
import {channelShiftEffect} from './channel-shift.ts';

export const effects: readonly EffectDefinition[] = [channelShiftEffect];

export const effectRegistry = createRegistry(effects);
