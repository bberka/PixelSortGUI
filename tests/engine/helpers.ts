import {hash32} from '../../src/engine/random.ts';
import type {PipelineOptions} from '../../src/engine/pipeline.ts';
import type {
	BlendMode,
	EffectDefinition,
	EffectInstance,
	EffectStack,
	ParamValue,
	RgbaImage,
} from '../../src/engine/types.ts';

export function image(
	width: number,
	height: number,
	values: readonly number[],
): RgbaImage {
	if (values.length !== width * height * 4) {
		throw new Error(
			`expected ${width * height * 4} bytes, got ${values.length}`,
		);
	}

	return {width, height, data: new Uint8ClampedArray(values)};
}

export function noiseImage(width: number, height: number, seed = 1): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i++) {
		data[i] = hash32(seed, i) % 256;
	}

	return {width, height, data};
}

export function bytes(img: RgbaImage): number[] {
	return [...img.data];
}

let nextId = 0;

export function instance(
	type: string,
	overrides: Partial<EffectInstance> = {},
): EffectInstance {
	nextId++;
	return {
		id: nextId.toString(36).padStart(8, '0'),
		type,
		version: 1,
		enabled: true,
		params: {},
		mix: 1,
		blend: 'normal' satisfies BlendMode,
		...overrides,
	};
}

export function stack(...instances: EffectInstance[]): EffectStack {
	return {schemaVersion: 1, instances};
}

export function options(
	source: RgbaImage,
	overrides: Partial<PipelineOptions> = {},
): PipelineOptions {
	return {
		level: 'settle',
		sourceWidth: source.width,
		sourceHeight: source.height,
		checkpoint() {},
		...overrides,
	};
}

const base = {
	version: 1,
	description: 'Test effect.',
	category: 'color',
} as const;

// Adds `amount` to R, G and B. Alpha is copied.
export function addEffect(
	onRender?: (amount: number) => void,
): EffectDefinition<{amount: number}> {
	return {
		...base,
		type: 'testAdd',
		label: 'Add',
		params: {
			amount: {
				kind: 'integer',
				label: 'Amount',
				group: 'Main',
				min: -255,
				max: 255,
				default: 10,
			},
		},
		render(input, output, params) {
			onRender?.(params.amount);
			for (let p = 0; p < input.data.length; p += 4) {
				output.data[p] = input.data[p] + params.amount;
				output.data[p + 1] = input.data[p + 1] + params.amount;
				output.data[p + 2] = input.data[p + 2] + params.amount;
				output.data[p + 3] = input.data[p + 3];
			}
		},
	};
}

export const invertEffect: EffectDefinition<{}> = {
	...base,
	type: 'testInvert',
	label: 'Invert',
	params: {},
	render(input, output) {
		for (let p = 0; p < input.data.length; p += 4) {
			output.data[p] = 255 - input.data[p];
			output.data[p + 1] = 255 - input.data[p + 1];
			output.data[p + 2] = 255 - input.data[p + 2];
			output.data[p + 3] = input.data[p + 3];
		}
	},
};

// Seeded noise keyed to source coordinates, XORed onto the input. Yields at every row.
export const noiseEffect: EffectDefinition<{seed: number; strength: number}> = {
	...base,
	type: 'testNoise',
	label: 'Noise',
	category: 'glitch',
	params: {
		seed: {kind: 'seed', label: 'Seed', group: 'Main'},
		strength: {
			kind: 'number',
			label: 'Strength',
			group: 'Main',
			min: 0,
			max: 1,
			step: 0.01,
			default: 1,
		},
	},
	async render(input, output, params, ctx) {
		const levels = Math.round(params.strength * 255);
		for (let y = 0; y < input.height; y++) {
			await ctx.checkpoint();
			for (let x = 0; x < input.width; x++) {
				const p = 4 * (y * input.width + x);
				const noise =
					hash32(ctx.seed, 1, ctx.toSource(x), ctx.toSource(y)) % (levels + 1);
				// eslint-disable-next-line no-bitwise -- test effect
				output.data[p] = input.data[p] ^ noise;
				output.data[p + 1] = input.data[p + 1];
				output.data[p + 2] = input.data[p + 2];
				output.data[p + 3] = input.data[p + 3];
			}

			ctx.progress((y + 1) / input.height);
		}
	},
};

// Copies its input, or paints opaque white when asked for the selection view.
export const selectionEffect: EffectDefinition<{}> = {
	...base,
	type: 'testSelection',
	label: 'Selection',
	params: {},
	debugViews: ['selection'],
	render(input, output, _params, ctx) {
		if (ctx.debugView === 'selection') {
			output.data.fill(255);
		} else {
			output.data.set(input.data);
		}
	},
};

export type Params = Record<string, ParamValue>;
