import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {
	posterizeEffect,
	type PosterizeParams,
} from '../../src/engine/effects/posterize.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {createRenderContext, renderStack} from '../../src/engine/pipeline.ts';
import {createImage, type RgbaImage} from '../../src/engine/types.ts';
import {
	bytes,
	image,
	instance,
	noiseImage,
	options,
	stack,
} from './sample-effects.ts';

const DEFAULTS: PosterizeParams = {
	mode: 'levels',
	levels: 6,
	bitsDropped: 4,
	preserveLuma: false,
};

const arbParams: fc.Arbitrary<PosterizeParams> = fc.record({
	mode: fc.constantFrom('levels' as const, 'bitCrush' as const),
	levels: fc.integer({min: 2, max: 64}),
	bitsDropped: fc.integer({min: 1, max: 7}),
	preserveLuma: fc.boolean(),
});

const arbImage: fc.Arbitrary<RgbaImage> = fc
	.record({
		width: fc.integer({min: 1, max: 64}),
		height: fc.integer({min: 1, max: 64}),
		seed: fc.integer({min: 0, max: 1_000_000}),
	})
	.map(({width, height, seed}) => noiseImage(width, height, seed));

async function render(
	input: RgbaImage,
	params: Partial<PosterizeParams> = {},
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: input.width,
		sourceHeight: input.height,
		renderWidth: input.width,
	});
	await posterizeEffect.render(input, output, {...DEFAULTS, ...params}, ctx);
	return output;
}

/**
A 256x1 image whose red, green and blue all equal x.
*/
function ramp(): RgbaImage {
	return image(
		256,
		1,
		Array.from({length: 256}, (_, x) => [x, x, x, 255]).flat(),
	);
}

function reds(output: RgbaImage): number[] {
	return bytes(output).filter((_, i) => i % 4 === 0);
}

describe('posterizeEffect', () => {
	it('is registered for the main thread and workers with the spec schema', () => {
		expect(effectRegistry.get('posterize')?.params).toBe(
			posterizeEffect.params,
		);
		expect(runtimeEffectRegistry.get('posterize')).toBe(posterizeEffect);
		expect(posterizeEffect.version).toBe(1);
		expect(posterizeEffect.category).toBe('color');
		expect(defaultParams(posterizeEffect.params)).toEqual(DEFAULTS);
	});

	// Input pixels (10, 100, 200, 40) and (255, 128, 0, 0).
	it.each([
		['levels', {levels: 6}, [0, 102, 204, 40, 255, 153, 0, 0]],
		['two levels', {levels: 2}, [0, 0, 255, 40, 255, 255, 0, 0]],
		[
			'bit crush',
			{mode: 'bitCrush', bitsDropped: 4},
			[0, 96, 192, 40, 240, 128, 0, 0],
		],
		// Luma is 88 and 146.
		[
			'monochrome levels',
			{preserveLuma: true, levels: 6},
			[102, 102, 102, 40, 153, 153, 153, 0],
		],
		[
			'monochrome bit crush',
			{mode: 'bitCrush', bitsDropped: 6, preserveLuma: true},
			[64, 64, 64, 40, 128, 128, 128, 0],
		],
	] as const)('writes %s', async (_name, params, expected) => {
		const input = image(2, 1, [10, 100, 200, 40, 255, 128, 0, 0]);
		expect(bytes(await render(input, params))).toEqual(expected);
	});

	it('maps a ramp to exactly L evenly spread values for every L', async () => {
		for (let levels = 2; levels <= 64; levels++) {
			const out = reds(await render(ramp(), {levels}));
			expect(new Set(out).size).toBe(levels);
			expect([out[0], out[255]]).toEqual([0, 255]);
			expect(out).toEqual(out.toSorted((a, b) => a - b));
		}
	});

	it('clears exactly the dropped bits for every bit count', async () => {
		for (let bitsDropped = 1; bitsDropped <= 7; bitsDropped++) {
			const step = 2 ** bitsDropped;
			const out = reds(await render(ramp(), {mode: 'bitCrush', bitsDropped}));
			expect(out).toEqual(Array.from({length: 256}, (_, c) => c - (c % step)));
		}
	});

	it('is idempotent, keeps alpha and makes monochrome output grey', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const output = await render(input, params);
				expect((await render(output, params)).data).toEqual(output.data);
				for (let i = 0; i < input.data.length; i += 4) {
					expect(output.data[i + 3]).toBe(input.data[i + 3]);
					if (!params.preserveLuma) {
						continue;
					}

					expect(output.data[i + 1]).toBe(output.data[i]);
					expect(output.data[i + 2]).toBe(output.data[i]);
				}
			}),
			{numRuns: 100},
		);
	});

	it('never writes its input and is deterministic', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const snapshot = bytes(input);
				const first = await render(input, params);
				const second = await render(input, params);
				expect(bytes(input)).toEqual(snapshot);
				expect(first.data).toEqual(second.data);
			}),
			{numRuns: 100},
		);
	});

	it('renders every pixel of images larger than one checkpoint slice', async () => {
		const input = noiseImage(160, 160, 3);
		const output = await render(input, {mode: 'bitCrush', bitsDropped: 1});
		expect(output.data).toEqual(
			input.data.map((c, i) => (i % 4 === 3 ? c : c - (c % 2))),
		);
	});

	it('survives a saved-stack round trip and repairs bad values', async () => {
		const input = noiseImage(9, 7, 5);
		const params: PosterizeParams = {
			mode: 'bitCrush',
			levels: 6,
			bitsDropped: 3,
			preserveLuma: true,
		};
		const saved = stack(instance('posterize', {params}));
		// eslint-disable-next-line unicorn/prefer-structured-clone -- saved projects are JSON
		const loaded = JSON.parse(JSON.stringify(saved)) as typeof saved;
		expect(loaded).toEqual(saved);
		const result = await renderStack(
			input,
			loaded,
			runtimeEffectRegistry,
			options(input),
		);
		expect(result.image.data).toEqual((await render(input, params)).data);
		expect(
			validateParams(posterizeEffect.params, {
				mode: 'nope',
				levels: 1000,
				bitsDropped: 0,
			}),
		).toEqual({...DEFAULTS, levels: 64, bitsDropped: 1});
	});
});
