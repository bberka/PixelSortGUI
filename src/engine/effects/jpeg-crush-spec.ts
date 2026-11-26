import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type JpegCrushParams = {
	blockSize: number;
	quality: number;
	chromaSubsample: boolean;
	corruptRate: number;
	corruptShift: number;
	seed: number;
};

export const jpegCrushParamSpecs: ParamSpecs<JpegCrushParams> = {
	blockSize: {
		kind: 'integer',
		label: 'Block size',
		group: 'Blocks',
		min: 4,
		max: 64,
		default: 8,
		unit: 'px',
	},
	quality: {
		kind: 'integer',
		label: 'Crush quality',
		group: 'Quantise',
		min: 1,
		max: 100,
		default: 12,
	},
	chromaSubsample: {
		kind: 'boolean',
		label: 'Subsample chroma',
		group: 'Quantise',
		default: true,
	},
	corruptRate: {
		kind: 'number',
		label: 'Block corruption',
		group: 'Data bend',
		min: 0,
		max: 0.5,
		step: 0.01,
		default: 0.05,
		unit: 'ratio',
	},
	corruptShift: {
		kind: 'number',
		label: 'Corruption strength',
		group: 'Data bend',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.5,
		unit: 'ratio',
		visibleWhen: {param: 'corruptRate', notEquals: [0]},
	},
	seed: {
		kind: 'seed',
		label: 'Seed',
		group: 'Seed',
		visibleWhen: {param: 'corruptRate', notEquals: [0]},
	},
};

export const jpegCrushSpec: Omit<
	EffectDefinition<JpegCrushParams>,
	'render'
> = {
	type: 'jpegCrush',
	version: 1,
	label: 'JPEG crush',
	description: 'Crush blocks like a badly saved JPEG and bend their data.',
	category: 'glitch',
	params: jpegCrushParamSpecs,
};
