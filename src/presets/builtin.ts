import {blockShuffleSpec} from '../engine/effects/block-shuffle-spec.ts';
import {channelShiftSpec} from '../engine/effects/channel-shift-spec.ts';
import {channelSwapSpec} from '../engine/effects/channel-swap-spec.ts';
import {
	pixelSortSpec,
	type PixelSortParams,
} from '../engine/effects/pixel-sort/spec.ts';
import {sliceShiftSpec} from '../engine/effects/slice-shift-spec.ts';
import {defaultParams} from '../engine/params.ts';
import {
	STACK_SCHEMA_VERSION,
	type EffectDefinition,
	type EffectInstance,
	type EffectStack,
	type ParamValue,
} from '../engine/types.ts';

export type BuiltinPreset = {
	readonly id: string;
	readonly name: string;
	readonly stack: EffectStack;
};

function effectInstance<P extends Record<string, ParamValue>>(
	spec: Omit<EffectDefinition<P>, 'render'>,
	id: string,
	overrides: Partial<P> = {},
): EffectInstance {
	return {
		id,
		type: spec.type,
		version: spec.version,
		enabled: true,
		params: {
			...defaultParams(spec.params),
			...overrides,
		},
		mix: 1,
		blend: 'normal',
	};
}

function pixelSortInstance(
	id: string,
	overrides: Partial<PixelSortParams>,
): EffectInstance {
	return effectInstance(pixelSortSpec, id, overrides);
}

function preset(
	id: string,
	name: string,
	instances: EffectInstance[],
): BuiltinPreset {
	return {
		id,
		name,
		stack: {
			schemaVersion: STACK_SCHEMA_VERSION,
			instances,
		},
	};
}

export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
	preset('builtin:bright-streaks', 'Bright streaks', [
		pixelSortInstance('psbrst01', {
			angle: 0,
			threshold: [0.5, 1],
		}),
	]),
	preset('builtin:dark-drips', 'Dark drips', [
		pixelSortInstance('psdkdr01', {
			angle: 270,
			threshold: [0, 0.4],
		}),
	]),
	preset('builtin:asdf-classic', 'ASDF classic', [
		pixelSortInstance('psasdf01', {
			angle: 270,
			threshold: [0.25, 0.8],
		}),
		pixelSortInstance('psasdf02', {
			angle: 0,
			threshold: [0.25, 0.8],
		}),
	]),
	preset('builtin:grey-band', 'Grey band', [
		pixelSortInstance('psgrbd01', {
			angle: 0,
			selectKey: 'lightness',
			threshold: [0.196, 0.627],
			discretize: 3,
		}),
	]),
	preset('builtin:hue-bands', 'Hue bands', [
		pixelSortInstance('pshubd01', {
			angle: 0,
			intervalMode: 'whole',
			sortKey: 'hue',
			maxLength: 240,
			lengthJitter: 0.5,
			seed: 1,
		}),
	]),
	preset('builtin:edge-melt', 'Edge melt', [
		pixelSortInstance('psedmt01', {
			angle: 270,
			intervalMode: 'edges',
			edgeThreshold: 0.2,
			edgeBlur: 2,
		}),
	]),
	preset('builtin:vhs-split', 'VHS split', [
		effectInstance(sliceShiftSpec, 'slvhsp01', {seed: 7}),
		effectInstance(channelShiftSpec, 'chvhsp02'),
	]),
	preset('builtin:tile-scramble', 'Tile scramble', [
		effectInstance(blockShuffleSpec, 'bltlsc01', {
			tileSize: 96,
			amount: 0.25,
			seed: 3,
		}),
		effectInstance(channelSwapSpec, 'cstlsc02', {order: 'gbr'}),
	]),
];

export function getBuiltinPreset(id: string): BuiltinPreset | undefined {
	return BUILTIN_PRESETS.find((item) => item.id === id);
}
