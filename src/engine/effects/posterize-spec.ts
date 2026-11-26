import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type PosterizeMode = 'levels' | 'bitCrush';

export type PosterizeParams = {
	mode: PosterizeMode;
	levels: number;
	bitsDropped: number;
	preserveLuma: boolean;
};

export const posterizeParamSpecs: ParamSpecs<PosterizeParams> = {
	mode: {
		kind: 'enum',
		label: 'Mode',
		group: 'Quantise',
		options: [
			{value: 'levels', label: 'Levels'},
			{value: 'bitCrush', label: 'Bit crush'},
		],
		default: 'levels',
	},
	levels: {
		kind: 'integer',
		label: 'Levels per channel',
		group: 'Quantise',
		min: 2,
		max: 64,
		default: 6,
		visibleWhen: {param: 'mode', equals: ['levels']},
	},
	bitsDropped: {
		kind: 'integer',
		label: 'Bits dropped',
		group: 'Quantise',
		min: 1,
		max: 7,
		default: 4,
		visibleWhen: {param: 'mode', equals: ['bitCrush']},
	},
	preserveLuma: {
		kind: 'boolean',
		label: 'Monochrome (luma)',
		group: 'Output',
		default: false,
	},
};

export const posterizeSpec: Omit<
	EffectDefinition<PosterizeParams>,
	'render'
> = {
	type: 'posterize',
	version: 1,
	label: 'Posterize',
	description: 'Reduce colour depth by quantising levels or crushing low bits.',
	category: 'color',
	params: posterizeParamSpecs,
};
