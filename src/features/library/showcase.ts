import {channelShiftSpec} from '@/engine/effects/channel-shift-spec.ts';
import {posterizeSpec} from '@/engine/effects/posterize-spec.ts';
import {sliceShiftSpec} from '@/engine/effects/slice-shift-spec.ts';
import {defaultParams} from '@/engine/params.ts';
import {
	STACK_SCHEMA_VERSION,
	type EffectDefinition,
	type EffectStack,
	type ParamValue,
} from '@/engine/types.ts';
import {getBuiltinPreset} from '@/presets/builtin.ts';

export type ShowcaseTile = {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly stack: EffectStack;
};

function singleEffect<P extends Record<string, ParamValue>>(
	spec: Omit<EffectDefinition<P>, 'render'>,
	id: string,
	overrides: Partial<P>,
): EffectStack {
	return {
		schemaVersion: STACK_SCHEMA_VERSION,
		instances: [
			{
				id,
				type: spec.type,
				version: spec.version,
				enabled: true,
				params: {...defaultParams(spec.params), ...overrides},
				mix: 1,
				blend: 'normal',
			},
		],
	};
}

/**
 The effect tiles of the empty Library (product.md F27).
 */
export const SHOWCASE_TILES: readonly ShowcaseTile[] = [
	{
		id: 'pixel-sort',
		name: 'Pixel sort',
		description: 'Drag runs of pixels into streaks.',
		stack: getBuiltinPreset('builtin:asdf-classic')!.stack,
	},
	{
		id: 'channel-shift',
		name: 'Channel shift',
		description: 'Pull red, green and blue apart.',
		stack: singleEffect(channelShiftSpec, 'chshow01', {redX: -28, blueX: 28}),
	},
	{
		id: 'slice-shift',
		name: 'Slice shift',
		description: 'Knock bands sideways, VHS style.',
		stack: singleEffect(sliceShiftSpec, 'slshow01', {
			sliceMin: 12,
			sliceMax: 64,
			probability: 0.6,
			maxOffset: 180,
			seed: 7,
		}),
	},
	{
		id: 'posterize',
		name: 'Posterize',
		description: 'Flatten colours into hard steps.',
		stack: singleEffect(posterizeSpec, 'poshow01', {levels: 4}),
	},
];
