import {describe, expect, it} from 'vite-plus/test';
import {channelShiftParamSpecs} from '../../src/engine/effects/channel-shift-spec.ts';
import {pixelSortParamSpecs} from '../../src/engine/effects/pixel-sort/spec.ts';
import type {ParamSpec, ParamValue} from '../../src/engine/types.ts';
import {formatParamCommitLabel} from '../../src/state/commit-labels.ts';

const specs = pixelSortParamSpecs;
const percent: ParamSpec = {
	kind: 'number',
	label: 'Amount',
	group: 'Output',
	min: 0,
	max: 1,
	step: 0.01,
	default: 0,
	unit: 'percent',
};

describe('formatParamCommitLabel', () => {
	it.each<[ParamSpec, ParamValue, string]>([
		[specs.threshold, [0.25, 0.8], 'Threshold range 0.25 to 0.80'],
		[specs.threshold, [0, 0.253], 'Threshold range 0.00 to 0.253'],
		[specs.edgeThreshold, 0.2, 'Edge threshold 0.20'],
		[specs.angle, 90, 'Angle 90°'],
		[specs.angle, 37.5, 'Angle 37.5°'],
		[specs.maxLength, 120, 'Maximum interval length 120 px'],
		[specs.discretize, 8, 'Discretize 8'],
		[specs.invert, true, 'Invert on'],
		[specs.invert, false, 'Invert off'],
		[specs.order, 'random', 'Order Random direction'],
		[specs.seed, 12_345, 'Seed 12345'],
		[channelShiftParamSpecs.redX, -20, 'Red X -20 px'],
		[percent, 0.45, 'Amount 45%'],
	])('labels %o set to %o', (spec, value, expected) => {
		expect(formatParamCommitLabel(spec, value)).toBe(expected);
	});
});
