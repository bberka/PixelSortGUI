import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type SliceShiftAxis = 'horizontal' | 'vertical';

export type SliceShiftEdge = 'wrap' | 'clamp';

export type SliceShiftParams = {
	axis: SliceShiftAxis;
	sliceMin: number;
	sliceMax: number;
	probability: number;
	maxOffset: number;
	edge: SliceShiftEdge;
	seed: number;
};

export const sliceShiftParamSpecs: ParamSpecs<SliceShiftParams> = {
	axis: {
		kind: 'enum',
		label: 'Axis',
		group: 'Slices',
		options: [
			{value: 'horizontal', label: 'Rows'},
			{value: 'vertical', label: 'Columns'},
		],
		default: 'horizontal',
	},
	sliceMin: {
		kind: 'integer',
		label: 'Min band size',
		group: 'Slices',
		min: 1,
		max: 2048,
		default: 4,
		unit: 'px',
	},
	sliceMax: {
		kind: 'integer',
		label: 'Max band size',
		group: 'Slices',
		min: 1,
		max: 2048,
		default: 48,
		unit: 'px',
	},
	probability: {
		kind: 'number',
		label: 'Probability',
		group: 'Slices',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.3,
		unit: 'ratio',
	},
	maxOffset: {
		kind: 'integer',
		label: 'Max offset',
		group: 'Offset',
		min: 0,
		max: 4096,
		default: 80,
		unit: 'px',
	},
	edge: {
		kind: 'enum',
		label: 'Edge mode',
		group: 'Offset',
		options: [
			{value: 'wrap', label: 'Wrap around'},
			{value: 'clamp', label: 'Stretch edge'},
		],
		default: 'wrap',
	},
	seed: {kind: 'seed', label: 'Seed', group: 'Seed'},
};

export const sliceShiftSpec: Omit<
	EffectDefinition<SliceShiftParams>,
	'render'
> = {
	type: 'sliceShift',
	version: 1,
	label: 'Slice shift',
	description: 'Shift random bands of the image sideways.',
	category: 'glitch',
	params: sliceShiftParamSpecs,
};
