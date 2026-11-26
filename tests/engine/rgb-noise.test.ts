import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {
	rgbNoiseEffect,
	type RgbNoiseParams,
} from '../../src/engine/effects/rgb-noise.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {createRenderContext, renderStack} from '../../src/engine/pipeline.ts';
import {intIn, unit} from '../../src/engine/random.ts';
import {createImage, type RgbaImage} from '../../src/engine/types.ts';
import {bytes, instance, noiseImage, options, stack} from './sample-effects.ts';

const DEFAULTS: RgbNoiseParams = {
	amount: 0.15,
	monochrome: false,
	dropout: 0,
	grainSize: 1,
	seed: 0,
};

const arbParams: fc.Arbitrary<RgbNoiseParams> = fc.record({
	amount: fc.integer({min: 0, max: 100}).map((n) => n / 100),
	monochrome: fc.boolean(),
	dropout: fc.integer({min: 0, max: 250}).map((n) => n / 1000),
	grainSize: fc.integer({min: 1, max: 16}),
	seed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
});

const arbImage: fc.Arbitrary<RgbaImage> = fc
	.record({
		width: fc.integer({min: 1, max: 48}),
		height: fc.integer({min: 1, max: 48}),
		seed: fc.integer({min: 0, max: 1_000_000}),
	})
	.map(({width, height, seed}) => noiseImage(width, height, seed));

async function render(
	input: RgbaImage,
	params: Partial<RgbNoiseParams> = {},
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
	await rgbNoiseEffect.render(input, output, {...DEFAULTS, ...params}, ctx);
	return output;
}

// The behaviour of engine.md section 16.1, written out one pixel at a time.
function model(
	input: RgbaImage,
	params: RgbNoiseParams,
	scale = 1,
): Uint8ClampedArray {
	const {amount, monochrome, dropout, grainSize, seed} = params;
	const amp = Math.round(amount * 255);
	const expected = new Uint8ClampedArray(input.data);
	for (let y = 0; y < input.height; y++) {
		for (let x = 0; x < input.width; x++) {
			const gx = Math.floor(Math.floor((x + 0.5) / scale) / grainSize);
			const gy = Math.floor(Math.floor((y + 0.5) / scale) / grainSize);
			const i = (y * input.width + x) * 4;
			if (dropout > 0 && unit(seed, 4, gx, gy) < dropout) {
				expected.fill(unit(seed, 5, gx, gy) >= 0.5 ? 255 : 0, i, i + 3);
				continue;
			}

			for (let channel = 0; channel < 3; channel++) {
				const purpose = monochrome ? 1 : channel + 1;
				expected[i + channel] =
					input.data[i + channel] + intIn(-amp, amp, seed, purpose, gx, gy);
			}
		}
	}

	return expected;
}

function flat(width: number, height: number): RgbaImage {
	const output = createImage(width, height);
	output.data.fill(128);
	return output;
}

describe('rgbNoiseEffect', () => {
	it('is registered for the main thread and workers with the spec schema', () => {
		expect(effectRegistry.get('rgbNoise')?.params).toBe(rgbNoiseEffect.params);
		expect(runtimeEffectRegistry.get('rgbNoise')).toBe(rgbNoiseEffect);
		expect(rgbNoiseEffect.version).toBe(1);
		expect(rgbNoiseEffect.category).toBe('glitch');
		expect(defaultParams(rgbNoiseEffect.params)).toEqual(DEFAULTS);
	});

	it('matches the per-pixel rule and never writes its input', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const snapshot = bytes(input);
				const output = await render(input, params);
				expect(output.data).toEqual(model(input, params));
				expect(bytes(input)).toEqual(snapshot);
			}),
			{numRuns: 100},
		);
	});

	it('repeats for a seed and changes with it', async () => {
		await fc.assert(
			fc.asyncProperty(arbParams, async (params) => {
				const input = flat(24, 24);
				const noisy = {...params, amount: 1, grainSize: 1};
				const first = await render(input, noisy);
				expect((await render(input, noisy)).data).toEqual(first.data);
				const other = await render(input, {
					...noisy,
					seed: (noisy.seed + 1) % 2 ** 32,
				});
				expect(other.data).not.toEqual(first.data);
			}),
			{numRuns: 50},
		);
	});

	it('is the identity with no amount and no dropout', async () => {
		const input = noiseImage(31, 17, 2);
		expect((await render(input, {amount: 0})).data).toEqual(input.data);
	});

	it('adds one delta to all colour channels when monochrome', async () => {
		const grey = await render(flat(32, 32), {monochrome: true});
		const colour = await render(flat(32, 32));
		const isGrey = (data: Uint8ClampedArray) =>
			data.every((value, i) => i % 4 === 3 || value === data[i - (i % 4)]);
		expect(isGrey(grey.data)).toBe(true);
		expect(isGrey(colour.data)).toBe(false);
	});

	it('writes both dead and hot pixels and keeps alpha', async () => {
		const output = await render(flat(64, 64), {amount: 0, dropout: 0.25});
		const reds = new Set(output.data.filter((_, i) => i % 4 === 0));
		expect([...reds].toSorted((a, b) => a - b)).toEqual([0, 128, 255]);
		expect(output.data.every((a, i) => i % 4 !== 3 || a === 128)).toBe(true);
	});

	it('keys grain cells to source coordinates on a scaled render', async () => {
		const input = noiseImage(20, 14, 9);
		for (const grainSize of [1, 3, 16]) {
			const params = {...DEFAULTS, grainSize, dropout: 0.2, seed: 77};
			const output = await render(input, params, 40, 28);
			expect(output.data).toEqual(model(input, params, 0.5));
		}
	});

	it('renders every pixel of rows that span checkpoint slices', async () => {
		for (const [width, height] of [
			[160, 160],
			[20_000, 2],
		]) {
			const input = noiseImage(width, height, 3);
			const params = {...DEFAULTS, grainSize: 16, seed: 5};
			expect((await render(input, params)).data).toEqual(model(input, params));
		}
	});

	it('survives a saved-stack round trip and repairs bad values', async () => {
		const input = noiseImage(9, 7, 5);
		const params: RgbNoiseParams = {
			amount: 0.5,
			monochrome: true,
			dropout: 0.1,
			grainSize: 2,
			seed: 1234,
		};
		const saved = stack(instance('rgbNoise', {params}));
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
			validateParams(rgbNoiseEffect.params, {
				amount: 5,
				dropout: 1,
				grainSize: 0,
			}),
		).toEqual({...DEFAULTS, amount: 1, dropout: 0.25, grainSize: 1});
	});
});
