import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type MirrorFoldMode = 'horizontal' | 'vertical' | 'quad' | 'octant';

export type MirrorFoldParams = {
	mode: MirrorFoldMode;
	flipSource: boolean;
	centerX: number;
	centerY: number;
};

export const mirrorFoldParamSpecs: ParamSpecs<MirrorFoldParams> = {
	mode: {
		kind: 'enum',
		label: 'Symmetry',
		group: 'Fold',
		options: [
			{value: 'horizontal', label: 'Left to right'},
			{value: 'vertical', label: 'Top to bottom'},
			{value: 'quad', label: 'Quad (4-way)'},
			{value: 'octant', label: 'Kaleidoscope (8-way)'},
		],
		default: 'horizontal',
	},
	flipSource: {
		kind: 'boolean',
		label: 'Flip source side',
		group: 'Fold',
		default: false,
	},
	centerX: {
		kind: 'number',
		label: 'Centre X',
		group: 'Axis',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.5,
		unit: 'ratio',
	},
	centerY: {
		kind: 'number',
		label: 'Centre Y',
		group: 'Axis',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.5,
		unit: 'ratio',
		visibleWhen: {param: 'mode', equals: ['vertical', 'quad', 'octant']},
	},
};

export const mirrorFoldSpec: Omit<
	EffectDefinition<MirrorFoldParams>,
	'render'
> = {
	type: 'mirrorFold',
	version: 1,
	label: 'Mirror fold',
	description: 'Mirror or fold the image into symmetrical quadrants or wedges.',
	category: 'glitch',
	params: mirrorFoldParamSpecs,
};
