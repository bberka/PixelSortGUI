import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type ImageBlendMode =
	| 'normal'
	| 'multiply'
	| 'screen'
	| 'overlay'
	| 'lighten'
	| 'darken'
	| 'difference'
	| 'exclusion'
	| 'add'
	| 'subtract';

export type ImageBlendFit = 'cover' | 'contain' | 'stretch' | 'tile' | 'none';

export type ImageBlendParams = {
	image: string;
	blendMode: ImageBlendMode;
	opacity: number;
	fit: ImageBlendFit;
	scale: number;
	offsetX: number;
	offsetY: number;
	rotation: number;
};

export const imageBlendParamSpecs: ParamSpecs<ImageBlendParams> = {
	image: {kind: 'image', label: 'Blend image', group: 'Source', default: ''},
	blendMode: {
		kind: 'enum',
		label: 'Blend mode',
		group: 'Blend',
		options: [
			{value: 'normal', label: 'Normal'},
			{value: 'multiply', label: 'Multiply'},
			{value: 'screen', label: 'Screen'},
			{value: 'overlay', label: 'Overlay'},
			{value: 'lighten', label: 'Lighten'},
			{value: 'darken', label: 'Darken'},
			{value: 'difference', label: 'Difference'},
			{value: 'exclusion', label: 'Exclusion'},
			{value: 'add', label: 'Add'},
			{value: 'subtract', label: 'Subtract'},
		],
		default: 'normal',
	},
	opacity: {
		kind: 'number',
		label: 'Opacity',
		group: 'Blend',
		min: 0,
		max: 1,
		step: 0.01,
		default: 1,
		unit: 'percent',
	},
	fit: {
		kind: 'enum',
		label: 'Fit',
		group: 'Placement',
		options: [
			{value: 'cover', label: 'Cover'},
			{value: 'contain', label: 'Contain'},
			{value: 'stretch', label: 'Stretch'},
			{value: 'tile', label: 'Tile'},
			{value: 'none', label: 'Original size'},
		],
		default: 'cover',
	},
	scale: {
		kind: 'number',
		label: 'Scale',
		group: 'Placement',
		min: 0.1,
		max: 4,
		step: 0.01,
		default: 1,
		unit: 'percent',
	},
	offsetX: {
		kind: 'number',
		label: 'Offset X',
		group: 'Placement',
		min: -1,
		max: 1,
		step: 0.01,
		default: 0,
		unit: 'percent',
	},
	offsetY: {
		kind: 'number',
		label: 'Offset Y',
		group: 'Placement',
		min: -1,
		max: 1,
		step: 0.01,
		default: 0,
		unit: 'percent',
	},
	rotation: {
		kind: 'angle',
		label: 'Rotation',
		group: 'Placement',
		default: 0,
		snaps: [0, 45, 90, 135, 180, 225, 270, 315],
		help: 'Degrees clockwise.',
	},
};

export const imageBlendSpec: Omit<
	EffectDefinition<ImageBlendParams>,
	'render'
> = {
	type: 'imageBlend',
	version: 1,
	label: 'Image blend',
	description:
		'Composite another image over the current result with blend mode, fit, and transform.',
	category: 'color',
	params: imageBlendParamSpecs,
	// Nothing can set `image` until the image control exists (roadmap T8.10).
	unlisted: true,
};
