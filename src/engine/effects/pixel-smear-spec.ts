import {SORT_KEYS, type SortKey} from '../keys.ts';
import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type PixelSmearParams = {
	angle: number;
	selectKey: SortKey;
	threshold: readonly [number, number];
	invert: boolean;
	decay: number;
	maxLength: number;
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

export const pixelSmearParamSpecs: ParamSpecs<PixelSmearParams> = {
	angle: {
		kind: 'angle',
		label: 'Angle',
		group: 'Direction',
		default: 270,
		snaps: [0, 45, 90, 135, 180, 225, 270, 315],
	},
	selectKey: {
		kind: 'enum',
		label: 'Selection key',
		group: 'Selection',
		options: SORT_KEYS.map((value) => ({value, label: KEY_LABELS[value]})),
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
	invert: {
		kind: 'boolean',
		label: 'Invert',
		group: 'Selection',
		default: false,
	},
	decay: {
		kind: 'number',
		label: 'Trail decay',
		group: 'Smear',
		min: 0,
		max: 0.99,
		step: 0.01,
		default: 0.92,
		unit: 'ratio',
	},
	maxLength: {
		kind: 'integer',
		label: 'Max trail length',
		group: 'Smear',
		min: 1,
		max: 4096,
		default: 120,
		unit: 'px',
	},
};

export const pixelSmearSpec: Omit<
	EffectDefinition<PixelSmearParams>,
	'render'
> = {
	type: 'pixelSmear',
	version: 1,
	label: 'Pixel smear',
	description: 'Smear selected pixels along a direction with decay trails.',
	category: 'glitch',
	params: pixelSmearParamSpecs,
	debugViews: ['selection'],
};
