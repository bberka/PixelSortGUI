import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type ChannelShiftEdge = 'clamp' | 'wrap';

export type ChannelShiftParams = {
	redX: number;
	redY: number;
	greenX: number;
	greenY: number;
	blueX: number;
	blueY: number;
	edge: ChannelShiftEdge;
};

export const channelShiftParamSpecs: ParamSpecs<ChannelShiftParams> = {
	redX: {
		kind: 'integer',
		label: 'Red X',
		group: 'Red',
		min: -1024,
		max: 1024,
		default: 6,
		unit: 'px',
	},
	redY: {
		kind: 'integer',
		label: 'Red Y',
		group: 'Red',
		min: -1024,
		max: 1024,
		default: 0,
		unit: 'px',
	},
	greenX: {
		kind: 'integer',
		label: 'Green X',
		group: 'Green',
		min: -1024,
		max: 1024,
		default: 0,
		unit: 'px',
	},
	greenY: {
		kind: 'integer',
		label: 'Green Y',
		group: 'Green',
		min: -1024,
		max: 1024,
		default: 0,
		unit: 'px',
	},
	blueX: {
		kind: 'integer',
		label: 'Blue X',
		group: 'Blue',
		min: -1024,
		max: 1024,
		default: -6,
		unit: 'px',
	},
	blueY: {
		kind: 'integer',
		label: 'Blue Y',
		group: 'Blue',
		min: -1024,
		max: 1024,
		default: 0,
		unit: 'px',
	},
	edge: {
		kind: 'enum',
		label: 'Edge mode',
		group: 'Edges',
		options: [
			{value: 'clamp', label: 'Stretch edge'},
			{value: 'wrap', label: 'Wrap around'},
		],
		default: 'clamp',
	},
};

export const channelShiftSpec: Omit<
	EffectDefinition<ChannelShiftParams>,
	'render'
> = {
	type: 'channelShift',
	version: 1,
	label: 'Channel shift',
	description: 'Offset the red, green and blue channels.',
	category: 'glitch',
	params: channelShiftParamSpecs,
};
