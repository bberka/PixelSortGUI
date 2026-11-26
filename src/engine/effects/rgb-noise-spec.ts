import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type RgbNoiseParams = {
	amount: number;
	monochrome: boolean;
	dropout: number;
	grainSize: number;
	seed: number;
};

export const rgbNoiseParamSpecs: ParamSpecs<RgbNoiseParams> = {
	amount: {
		kind: 'number',
		label: 'Amount',
		group: 'Noise',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.15,
		unit: 'ratio',
	},
	monochrome: {
		kind: 'boolean',
		label: 'Monochrome',
		group: 'Noise',
		default: false,
	},
	grainSize: {
		kind: 'integer',
		label: 'Grain size',
		group: 'Noise',
		min: 1,
		max: 16,
		default: 1,
		unit: 'px',
	},
	dropout: {
		kind: 'number',
		label: 'Dead/hot pixel chance',
		group: 'Dropout',
		min: 0,
		max: 0.25,
		step: 0.001,
		default: 0,
		unit: 'ratio',
	},
	seed: {kind: 'seed', label: 'Seed', group: 'Seed'},
};

export const rgbNoiseSpec: Omit<EffectDefinition<RgbNoiseParams>, 'render'> = {
	type: 'rgbNoise',
	version: 1,
	label: 'RGB noise',
	description: 'Add deterministic colour or monochrome noise and dead pixels.',
	category: 'glitch',
	params: rgbNoiseParamSpecs,
};
