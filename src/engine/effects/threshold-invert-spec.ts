import {SORT_KEYS, type SortKey} from '../keys.ts';
import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type ThresholdInvertChannels = 'rgb' | 'red' | 'green' | 'blue';

export type ThresholdInvertParams = {
	selectKey: SortKey;
	threshold: readonly [number, number];
	invertSelection: boolean;
	channels: ThresholdInvertChannels;
};

const KEY_LABELS: Readonly<Record<SortKey, string>> = {
	luma: 'Luma',
	lightness: 'Lightness',
	value: 'Value',
	saturation: 'Saturation',
	hue: 'Hue',
	red: 'Red',
	green: 'Green',
	blue: 'Blue',
};

export const thresholdInvertParamSpecs: ParamSpecs<ThresholdInvertParams> = {
	selectKey: {
		kind: 'enum',
		label: 'Selection key',
		group: 'Selection',
		options: SORT_KEYS.map((key) => ({value: key, label: KEY_LABELS[key]})),
		default: 'luma',
	},
	threshold: {
		kind: 'range',
		label: 'Threshold range',
		group: 'Selection',
		min: 0,
		max: 1,
		step: 0.001,
		default: [0.5, 1],
	},
	invertSelection: {
		kind: 'boolean',
		label: 'Invert selection',
		group: 'Selection',
		default: false,
	},
	channels: {
		kind: 'enum',
		label: 'Target channels',
		group: 'Output',
		options: [
			{value: 'rgb', label: 'RGB'},
			{value: 'red', label: 'Red'},
			{value: 'green', label: 'Green'},
			{value: 'blue', label: 'Blue'},
		],
		default: 'rgb',
	},
};

export const thresholdInvertSpec: Omit<
	EffectDefinition<ThresholdInvertParams>,
	'render'
> = {
	type: 'thresholdInvert',
	version: 1,
	label: 'Threshold invert',
	description: 'Invert colours or channels for pixels within a key range.',
	category: 'color',
	params: thresholdInvertParamSpecs,
	debugViews: ['selection'],
};
