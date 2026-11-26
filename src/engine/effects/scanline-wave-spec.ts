import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type ScanlineWaveAxis = 'horizontal' | 'vertical';

export type ScanlineWaveform = 'sine' | 'triangle' | 'square' | 'sawtooth';

export type ScanlineWaveEdge = 'wrap' | 'clamp';

export type ScanlineWaveParams = {
	axis: ScanlineWaveAxis;
	waveform: ScanlineWaveform;
	amplitude: number;
	wavelength: number;
	phase: number;
	jitter: number;
	edge: ScanlineWaveEdge;
	seed: number;
};

export const scanlineWaveParamSpecs: ParamSpecs<ScanlineWaveParams> = {
	axis: {
		kind: 'enum',
		label: 'Axis',
		group: 'Wave',
		options: [
			{value: 'horizontal', label: 'Rows'},
			{value: 'vertical', label: 'Columns'},
		],
		default: 'horizontal',
	},
	waveform: {
		kind: 'enum',
		label: 'Waveform',
		group: 'Wave',
		options: [
			{value: 'sine', label: 'Sine'},
			{value: 'triangle', label: 'Triangle'},
			{value: 'square', label: 'Square'},
			{value: 'sawtooth', label: 'Sawtooth'},
		],
		default: 'sine',
	},
	amplitude: {
		kind: 'integer',
		label: 'Amplitude',
		group: 'Wave',
		min: 0,
		max: 2048,
		default: 24,
		unit: 'px',
	},
	wavelength: {
		kind: 'integer',
		label: 'Wavelength',
		group: 'Wave',
		min: 4,
		max: 4096,
		default: 120,
		unit: 'px',
	},
	phase: {
		kind: 'angle',
		label: 'Phase',
		group: 'Wave',
		default: 0,
		snaps: [0, 90, 180, 270],
	},
	jitter: {
		kind: 'integer',
		label: 'Line jitter',
		group: 'Jitter',
		min: 0,
		max: 512,
		default: 0,
		unit: 'px',
	},
	edge: {
		kind: 'enum',
		label: 'Edge mode',
		group: 'Edges',
		options: [
			{value: 'wrap', label: 'Wrap around'},
			{value: 'clamp', label: 'Stretch edge'},
		],
		default: 'wrap',
	},
	seed: {
		kind: 'seed',
		label: 'Seed',
		group: 'Seed',
		visibleWhen: {param: 'jitter', notEquals: [0]},
	},
};

export const scanlineWaveSpec: Omit<
	EffectDefinition<ScanlineWaveParams>,
	'render'
> = {
	type: 'scanlineWave',
	version: 1,
	label: 'Scanline wave',
	description: 'Displace rows or columns along a wave with optional jitter.',
	category: 'glitch',
	params: scanlineWaveParamSpecs,
};
