import {describe, expect, it} from 'vite-plus/test';
import {channelShiftParamSpecs} from '../../src/engine/effects/channel-shift-spec.ts';
import {pixelSortParamSpecs} from '../../src/engine/effects/pixel-sort/spec.ts';
import {
	IDENTITY_TRANSFORM,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import type {ParamSpec, ParamValue} from '../../src/engine/types.ts';
import {
	formatParamCommitLabel,
	formatTransformCommitLabel,
} from '../../src/state/commit-labels.ts';

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

function geometry(change: Partial<SourceTransform> = {}): SourceTransform {
	return {...IDENTITY_TRANSFORM, ...change};
}

const crop = {x: 0, y: 0, width: 1200, height: 800};
const resize = {width: 2000, height: 1500, filter: 'lanczos3'} as const;

describe('formatTransformCommitLabel', () => {
	it.each<[Partial<SourceTransform>, Partial<SourceTransform>, string]>([
		[{}, {rotation: 90}, 'Rotate 90° CW'],
		[{rotation: 270}, {}, 'Rotate 90° CW'],
		[{}, {rotation: 270}, 'Rotate 90° CCW'],
		[{rotation: 90}, {rotation: 270}, 'Rotate 180°'],
		[{}, {flipX: true}, 'Flip horizontal'],
		[{flipY: true}, {}, 'Flip vertical'],
		[{rotation: 90}, {rotation: 90, flipX: true}, 'Flip horizontal'],
		// A quarter turn of a mirrored image changes the stored flip axis.
		[{flipX: true}, {rotation: 90, flipY: true}, 'Rotate 90° CW'],
		[{crop}, {rotation: 90, crop: {...crop, width: 800}}, 'Rotate 90° CW'],
		[{}, {rotation: 90, flipX: true}, 'Transform'],
		[{}, {crop}, 'Crop 1200 × 800'],
		[{crop, resize}, {crop: {...crop, width: 600}}, 'Crop 600 × 800'],
		[{crop}, {}, 'Reset crop'],
		[{rotation: 90, crop}, {rotation: 90}, 'Reset crop'],
		[{}, {resize}, 'Resize 2000 × 1500'],
		[{resize}, {}, 'Reset resize'],
		[{crop, resize}, {}, 'Reset transform'],
		[{rotation: 90, crop}, {}, 'Reset transform'],
	])('labels %o changed to %o', (before, after, expected) => {
		expect(formatTransformCommitLabel(geometry(before), geometry(after))).toBe(
			expected,
		);
	});
});
