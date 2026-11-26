import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type BayerDitherMatrix = '2' | '4' | '8';

export type BayerDitherParams = {
	matrix: BayerDitherMatrix;
	levels: number;
	monochrome: boolean;
	spread: number;
	pixelScale: number;
};

export const bayerDitherParamSpecs: ParamSpecs<BayerDitherParams> = {
	matrix: {
		kind: 'enum',
		label: 'Matrix size',
		group: 'Pattern',
		options: [
			{value: '2', label: '2×2'},
			{value: '4', label: '4×4'},
			{value: '8', label: '8×8'},
		],
		default: '4',
	},
	levels: {
		kind: 'integer',
		label: 'Levels per channel',
		group: 'Palette',
		min: 2,
		max: 16,
		default: 2,
	},
	monochrome: {
		kind: 'boolean',
		label: 'Monochrome',
		group: 'Palette',
		default: false,
	},
	spread: {
		kind: 'number',
		label: 'Spread',
		group: 'Pattern',
		min: 0,
		max: 1,
		step: 0.01,
		default: 1,
		unit: 'ratio',
	},
	pixelScale: {
		kind: 'integer',
		label: 'Pattern scale',
		group: 'Pattern',
		min: 1,
		max: 16,
		default: 1,
		unit: 'px',
	},
};

export const bayerDitherSpec: Omit<
	EffectDefinition<BayerDitherParams>,
	'render'
> = {
	type: 'bayerDither',
	version: 1,
	label: 'Bayer dither',
	description: 'Apply ordered Bayer matrix dithering.',
	category: 'color',
	params: bayerDitherParamSpecs,
};
