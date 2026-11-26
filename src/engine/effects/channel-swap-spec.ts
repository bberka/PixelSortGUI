import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type ChannelSwapOrder = 'rgb' | 'rbg' | 'grb' | 'gbr' | 'brg' | 'bgr';

export type ChannelSwapParams = {
	order: ChannelSwapOrder;
};

export const channelSwapParamSpecs: ParamSpecs<ChannelSwapParams> = {
	order: {
		kind: 'enum',
		label: 'Channel order',
		group: 'Channels',
		options: [
			{value: 'rgb', label: 'RGB (identity)'},
			{value: 'rbg', label: 'RBG'},
			{value: 'grb', label: 'GRB'},
			{value: 'gbr', label: 'GBR'},
			{value: 'brg', label: 'BRG'},
			{value: 'bgr', label: 'BGR'},
		],
		default: 'gbr',
	},
};

export const channelSwapSpec: Omit<
	EffectDefinition<ChannelSwapParams>,
	'render'
> = {
	type: 'channelSwap',
	version: 1,
	label: 'Channel swap',
	description: 'Swap the red, green and blue channels.',
	category: 'color',
	params: channelSwapParamSpecs,
};
