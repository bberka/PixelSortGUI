import {
	pixelSortSpec,
	type PixelSortParams,
} from '../engine/effects/pixel-sort/spec.ts';
import {defaultParams} from '../engine/params.ts';
import {
	STACK_SCHEMA_VERSION,
	type EffectInstance,
	type EffectStack,
} from '../engine/types.ts';

export type BuiltinPreset = {
	readonly id: string;
	readonly name: string;
	readonly stack: EffectStack;
};

const PIXEL_SORT_DEFAULTS = defaultParams(pixelSortSpec.params);

function pixelSortInstance(
	id: string,
	overrides: Partial<PixelSortParams>,
): EffectInstance {
	return {
		id,
		type: pixelSortSpec.type,
		version: pixelSortSpec.version,
		enabled: true,
		params: {
			...PIXEL_SORT_DEFAULTS,
			...overrides,
		},
		mix: 1,
		blend: 'normal',
	};
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
];

export function getBuiltinPreset(id: string): BuiltinPreset | undefined {
	return BUILTIN_PRESETS.find((item) => item.id === id);
}
