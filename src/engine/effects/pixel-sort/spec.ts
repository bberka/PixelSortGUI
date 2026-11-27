import {SORT_KEYS, type SortKey} from '../../keys.ts';
import type {EffectDefinition, ParamSpecs} from '../../types.ts';

export type IntervalMode = 'threshold' | 'edges' | 'whole';
export type ChannelMode = 'rgba' | 'rgb' | 'r' | 'g' | 'b';
export type SortOrder = 'ascending' | 'descending' | 'shuffle' | 'random';
export type FillMode = 'sort' | 'average' | 'gradient';
export type IntervalTransform =
	'none' | 'reverse' | 'mirror' | 'splice' | 'fold';

export type PixelSortParams = {
	angle: number;
	intervalMode: IntervalMode;
	selectKey: SortKey;
	threshold: readonly [number, number];
	edgeThreshold: number;
	edgeBlur: number;
	invert: boolean;
	maxLength: number;
	lengthJitter: number;
	skipChance: number;
	channelMode: ChannelMode;
	sortKey: SortKey;
	order: SortOrder;
	discretize: number;
	fill: FillMode;
	intervalTransform: IntervalTransform;
	seed: number;
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

const keyOptions = SORT_KEYS.map((value) => ({
	value,
	label: KEY_LABELS[value],
}));

export const pixelSortParamSpecs: ParamSpecs<PixelSortParams> = {
	angle: {
		kind: 'angle',
		label: 'Angle',
		group: 'Direction',
		help: 'Degrees counter-clockwise from rightward: 0 sorts left to right, 90 bottom to top, 180 right to left, 270 top to bottom.',
		default: 0,
		snaps: [0, 45, 90, 135, 180, 225, 270, 315],
	},
	intervalMode: {
		kind: 'enum',
		label: 'Interval mode',
		group: 'Selection',
		help: 'How pixels are selected for sorting: by a threshold on a key, between edges, or the whole line.',
		options: [
			{value: 'threshold', label: 'Threshold'},
			{value: 'edges', label: 'Edges'},
			{value: 'whole', label: 'Whole line'},
		],
		default: 'threshold',
	},
	selectKey: {
		kind: 'enum',
		label: 'Selection key',
		group: 'Selection',
		help: 'The key the threshold range is compared against.',
		options: keyOptions,
		default: 'luma',
		visibleWhen: {param: 'intervalMode', equals: ['threshold']},
	},
	threshold: {
		kind: 'range',
		label: 'Threshold range',
		group: 'Selection',
		help: 'Pixels whose selection key lies in this range, inclusive at both ends, are selected.',
		min: 0,
		max: 1,
		step: 0.001,
		default: [0.25, 0.8],
		visibleWhen: {param: 'intervalMode', equals: ['threshold']},
	},
	edgeThreshold: {
		kind: 'number',
		label: 'Edge threshold',
		group: 'Selection',
		help: 'Edge strength, as a fraction of the maximum single-axis gradient, at which a pixel counts as an edge. Pixels that are not edges are selected.',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.2,
		unit: 'ratio',
		visibleWhen: {param: 'intervalMode', equals: ['edges']},
	},
	edgeBlur: {
		kind: 'integer',
		label: 'Edge blur',
		group: 'Selection',
		help: 'Box blur radius applied before edge detection.',
		min: 0,
		max: 8,
		default: 1,
		unit: 'px',
		visibleWhen: {param: 'intervalMode', equals: ['edges']},
	},
	invert: {
		kind: 'boolean',
		label: 'Invert',
		group: 'Selection',
		help: 'Select the pixels that would not be selected, and the other way round.',
		default: false,
		visibleWhen: {param: 'intervalMode', notEquals: ['whole']},
	},
	maxLength: {
		kind: 'integer',
		label: 'Maximum interval length',
		group: 'Length',
		help: 'Splits each run into intervals of at most this length. 0 means no limit.',
		min: 0,
		max: 16_384,
		default: 0,
		unit: 'px',
	},
	lengthJitter: {
		kind: 'number',
		label: 'Length jitter',
		group: 'Length',
		help: 'Random variation of each interval length around the maximum.',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0,
		unit: 'ratio',
		visibleWhen: {param: 'maxLength', notEquals: [0]},
	},
	skipChance: {
		kind: 'number',
		label: 'Skip chance',
		group: 'Length',
		help: 'Chance that an interval is left unchanged.',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0,
		unit: 'ratio',
	},
	channelMode: {
		kind: 'enum',
		label: 'Channels',
		group: 'Order',
		help: 'Sort whole RGBA pixels together, sort red, green and blue independently, or sort a single colour channel while leaving other channels and alpha unchanged.',
		options: [
			{value: 'rgba', label: 'All (RGBA)'},
			{value: 'rgb', label: 'RGB independent'},
			{value: 'r', label: 'Red only'},
			{value: 'g', label: 'Green only'},
			{value: 'b', label: 'Blue only'},
		],
		default: 'rgba',
	},
	sortKey: {
		kind: 'enum',
		label: 'Sort key',
		group: 'Order',
		help: 'The key each interval is sorted by.',
		options: keyOptions,
		default: 'luma',
		visibleWhen: {param: 'channelMode', equals: ['rgba']},
	},
	order: {
		kind: 'enum',
		label: 'Order',
		group: 'Order',
		help: 'Ascending puts the smallest key first along the line direction. Random direction picks ascending or descending per interval.',
		options: [
			{value: 'ascending', label: 'Ascending'},
			{value: 'descending', label: 'Descending'},
			{value: 'shuffle', label: 'Shuffle'},
			{value: 'random', label: 'Random direction'},
		],
		default: 'ascending',
	},
	discretize: {
		kind: 'integer',
		label: 'Discretize',
		group: 'Order',
		help: 'Colours within about this many 8-bit steps compare equal and keep their order, giving clumpier streaks. 0 turns it off.',
		min: 0,
		max: 64,
		default: 0,
		visibleWhen: {param: 'fill', notEquals: ['average']},
	},
	fill: {
		kind: 'enum',
		label: 'Fill',
		group: 'Output',
		help: 'Sort moves the pixels; average paints each interval with its mean colour; gradient blends from its first ordered pixel to its last.',
		options: [
			{value: 'sort', label: 'Sort'},
			{value: 'average', label: 'Average'},
			{value: 'gradient', label: 'Gradient'},
		],
		default: 'sort',
	},
	intervalTransform: {
		kind: 'enum',
		label: 'Interval transform',
		group: 'Output',
		help: 'Rearranges each ordered interval: reverse flips it end to end, mirror peaks in the centre, splice swaps the two halves, and fold puts the smallest values in the centre.',
		options: [
			{value: 'none', label: 'None'},
			{value: 'reverse', label: 'Reverse'},
			{value: 'mirror', label: 'Mirror'},
			{value: 'splice', label: 'Splice'},
			{value: 'fold', label: 'Fold'},
		],
		default: 'none',
		visibleWhen: {param: 'fill', notEquals: ['average']},
	},
	seed: {
		kind: 'seed',
		label: 'Seed',
		group: 'Seed',
		help: 'Drives length jitter, skipping, shuffle and random direction.',
	},
};

export const pixelSortSpec: Omit<
	EffectDefinition<PixelSortParams>,
	'render'
> = {
	type: 'pixelSort',
	version: 2,
	label: 'Pixel sort',
	description:
		'Sort runs of pixels along a direction by brightness, hue or a channel.',
	category: 'sort',
	params: pixelSortParamSpecs,
	migrations: {
		1: (old) => ({
			...old,
			channelMode: old.channelMode ?? 'rgba',
			intervalTransform: old.intervalTransform ?? 'none',
		}),
	},
	debugViews: ['selection'],
};
