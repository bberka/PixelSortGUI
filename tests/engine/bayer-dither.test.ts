import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	BAYER_MATRICES,
	bayerDitherEffect,
	type BayerDitherParams,
} from '../../src/engine/effects/bayer-dither.ts';
import {effectRegistry} from '../../src/engine/effects/index.ts';
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

const DEFAULTS: BayerDitherParams = {
	matrix: '4',
	levels: 2,
	monochrome: false,
	spread: 1,
	pixelScale: 1,
};

const arbParams: fc.Arbitrary<BayerDitherParams> = fc.record({
	matrix: fc.constantFrom('2' as const, '4' as const, '8' as const),
	levels: fc.integer({min: 2, max: 16}),
	monochrome: fc.boolean(),
	spread: fc.integer({min: 0, max: 100}).map((n) => n / 100),
	pixelScale: fc.integer({min: 1, max: 16}),
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
	params: Partial<BayerDitherParams> = {},
	sourceWidth = input.width,
	sourceHeight = input.height,
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth,
		sourceHeight,
		renderWidth: input.width,
	});
	await bayerDitherEffect.render(input, output, {...DEFAULTS, ...params}, ctx);
	return output;
}

function flat(width: number, height: number, value: number): RgbaImage {
	return image(
		width,
		height,
		Array.from({length: width * height}, () => [
			value,
			value,
			value,
			255,
		]).flat(),
	);
}

function reds(output: RgbaImage): number[] {
	return bytes(output).filter((_, i) => i % 4 === 0);
}

describe('bayerDitherEffect', () => {
	it('is registered for the main thread and workers with the spec schema', () => {
		expect(effectRegistry.get('bayerDither')?.params).toBe(
			bayerDitherEffect.params,
		);
		expect(runtimeEffectRegistry.get('bayerDither')).toBe(bayerDitherEffect);
		expect(bayerDitherEffect.version).toBe(1);
		expect(bayerDitherEffect.category).toBe('color');
		expect(defaultParams(bayerDitherEffect.params)).toEqual(DEFAULTS);
	});

	it('checks in the recursive Bayer matrices', () => {
		const base = BAYER_MATRICES['2'];
		for (const [size, previous, next] of [
			[2, base, BAYER_MATRICES['4']],
			[4, BAYER_MATRICES['4'], BAYER_MATRICES['8']],
		] as const) {
			const expected = Array.from({length: 4 * size * size}, (_, i) => {
				const x = i % (2 * size);
				const y = Math.floor(i / (2 * size));
				return (
					4 * previous[(y % size) * size + (x % size)] +
					base[Math.floor(y / size) * 2 + Math.floor(x / size)]
				);
			});
			expect(next).toEqual(expected);
		}
	});

	// Mid grey 128 at two levels is white exactly where the offset is positive.
	it('writes the 2x2 pattern on mid grey', async () => {
		const out = await render(flat(4, 2, 128), {matrix: '2'});
		expect(reds(out)).toEqual([0, 255, 0, 255, 255, 0, 255, 0]);
	});

	it('enlarges the pattern by the pattern scale', async () => {
		const out = await render(flat(4, 4, 128), {matrix: '2', pixelScale: 2});
		expect(reds(out)).toEqual([
			0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 0, 0, 255, 255, 0, 0,
		]);
	});

	it('places the pattern in source space on a half-scale render', async () => {
		const out = await render(
			flat(4, 4, 128),
			{matrix: '2', pixelScale: 2},
			8,
			8,
		);
		// Source coordinates 1, 3, 5, 7 give matrix coordinates 0, 1, 0, 1.
		expect(reds(out)).toEqual([
			0, 255, 0, 255, 255, 0, 255, 0, 0, 255, 0, 255, 255, 0, 255, 0,
		]);
	});

	it('dithers luma in monochrome and keeps alpha', async () => {
		// Luma 88; levels 2, spread 0 rounds it to black.
		const input = image(1, 1, [10, 100, 200, 40]);
		expect(bytes(await render(input, {monochrome: true, spread: 0}))).toEqual([
			0, 0, 0, 40,
		]);
	});

	it('only writes the evenly spread levels, keeps alpha and greys monochrome', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const steps = params.levels - 1;
				const allowed = new Set(
					Array.from({length: params.levels}, (_, i) =>
						Math.floor((i * 255 + Math.floor(steps / 2)) / steps),
					),
				);
				const {data} = await render(input, params);
				// One assertion per image: per-pixel `expect` calls time out under load.
				const bad = data.findIndex((value, i) => {
					const channel = i % 4;
					if (channel === 3) {
						return value !== input.data[i];
					}

					return (
						!allowed.has(value) ||
						(params.monochrome && value !== data[i - channel])
					);
				});
				expect(bad).toBe(-1);
			}),
			{numRuns: 200},
		);
	});

	it('is plain quantisation when spread is 0', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const once = await render(input, {...params, spread: 0});
				expect((await render(once, {...params, spread: 0})).data).toEqual(
					once.data,
				);
				expect(
					(
						await render(input, {
							...params,
							spread: 0,
							matrix: '8',
							pixelScale: 1,
						})
					).data,
				).toEqual(once.data);
			}),
			{numRuns: 200},
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
			{numRuns: 200},
		);
	});

	it('survives a saved-stack round trip and repairs bad values', async () => {
		const input = noiseImage(160, 160, 5);
		const params: BayerDitherParams = {
			matrix: '8',
			levels: 5,
			monochrome: true,
			spread: 0.4,
			pixelScale: 3,
		};
		const saved = stack(instance('bayerDither', {params}));
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
			validateParams(bayerDitherEffect.params, {
				matrix: '3',
				levels: 99,
				pixelScale: 0,
			}),
		).toEqual({...DEFAULTS, levels: 16, pixelScale: 1});
	});
});
