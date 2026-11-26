import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {
	thresholdInvertEffect,
	type ThresholdInvertParams,
} from '../../src/engine/effects/threshold-invert.ts';
import {computeKey16, SORT_KEYS} from '../../src/engine/keys.ts';
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

const DEFAULTS: ThresholdInvertParams = {
	selectKey: 'luma',
	threshold: [0.5, 1],
	invertSelection: false,
	channels: 'rgb',
};

const arbParams: fc.Arbitrary<ThresholdInvertParams> = fc.record({
	selectKey: fc.constantFrom(...SORT_KEYS),
	threshold: fc
		.tuple(fc.integer({min: 0, max: 1000}), fc.integer({min: 0, max: 1000}))
		.map(([a, b]) => [Math.min(a, b) / 1000, Math.max(a, b) / 1000] as const),
	invertSelection: fc.boolean(),
	channels: fc.constantFrom(
		'rgb' as const,
		'red' as const,
		'green' as const,
		'blue' as const,
	),
});

// Noise with some fully transparent pixels.
const arbImage: fc.Arbitrary<RgbaImage> = fc
	.record({
		width: fc.integer({min: 1, max: 64}),
		height: fc.integer({min: 1, max: 64}),
		seed: fc.integer({min: 0, max: 1_000_000}),
	})
	.map(({width, height, seed}) => {
		const noise = noiseImage(width, height, seed);
		for (let i = 3; i < noise.data.length; i += 28) {
			noise.data[i] = 0;
		}

		return noise;
	});

async function render(
	input: RgbaImage,
	params: Partial<ThresholdInvertParams> = {},
	debugView: 'none' | 'selection' = 'none',
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: input.width,
		sourceHeight: input.height,
		renderWidth: input.width,
		debugView,
	});
	await thresholdInvertEffect.render(
		input,
		output,
		{...DEFAULTS, ...params},
		ctx,
	);
	return output;
}

function isSelected(
	{data}: RgbaImage,
	i: number,
	{selectKey, threshold, invertSelection}: ThresholdInvertParams,
): boolean {
	const key = computeKey16(selectKey, data[i], data[i + 1], data[i + 2]);
	const inBand =
		key >= Math.floor(threshold[0] * 65_535 + 0.5) &&
		key <= Math.floor(threshold[1] * 65_535 + 0.5);
	return data[i + 3] !== 0 && inBand !== invertSelection;
}

describe('thresholdInvertEffect', () => {
	it('is registered for the main thread and workers with the spec schema', () => {
		expect(effectRegistry.get('thresholdInvert')?.params).toBe(
			thresholdInvertEffect.params,
		);
		expect(runtimeEffectRegistry.get('thresholdInvert')).toBe(
			thresholdInvertEffect,
		);
		expect(thresholdInvertEffect.version).toBe(1);
		expect(thresholdInvertEffect.category).toBe('color');
		expect(thresholdInvertEffect.debugViews).toEqual(['selection']);
		expect(defaultParams(thresholdInvertEffect.params)).toEqual(DEFAULTS);
	});

	// Red keys are R * 257, so the bounds 100/255 and 200/255 land on R exactly.
	const row = image(
		4,
		1,
		[99, 1, 2, 255, 100, 1, 2, 255, 200, 1, 2, 40, 201, 1, 2, 255],
	);
	const band = {
		selectKey: 'red',
		threshold: [100 / 255, 200 / 255],
	} as const;

	it('inverts the pixels inside the band, both ends included', async () => {
		expect(bytes(await render(row, band))).toEqual([
			99, 1, 2, 255, 155, 254, 253, 255, 55, 254, 253, 40, 201, 1, 2, 255,
		]);
	});

	it('inverts the other pixels and only the target channel', async () => {
		expect(
			bytes(
				await render(row, {...band, invertSelection: true, channels: 'green'}),
			),
		).toEqual([
			99, 254, 2, 255, 100, 1, 2, 255, 200, 1, 2, 40, 201, 254, 2, 255,
		]);
	});

	it('never selects a transparent pixel', async () => {
		const clear = image(1, 1, [10, 20, 30, 0]);
		for (const invertSelection of [false, true]) {
			expect(
				bytes(await render(clear, {threshold: [0, 1], invertSelection})),
			).toEqual([10, 20, 30, 0]);
		}
	});

	it('darkens unselected pixels in the selection view', async () => {
		expect(bytes(await render(row, band, 'selection'))).toEqual([
			24, 0, 0, 255, 100, 1, 2, 255, 200, 1, 2, 40, 50, 0, 0, 255,
		]);
	});

	it('changes exactly the target channels of selected pixels', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const {data} = await render(input, params);
				const view = (await render(input, params, 'selection')).data;
				const targets = {rgb: [0, 1, 2], red: [0], green: [1], blue: [2]}[
					params.channels
				];
				// One assertion per image: per-pixel `expect` calls time out under load.
				const bad = data.findIndex((value, i) => {
					const channel = i % 4;
					const source = input.data[i];
					const selected = isSelected(input, i - channel, params);
					const flipped = selected && targets.includes(channel);
					const shown =
						selected || channel === 3 ? source : Math.floor(source / 4);
					return (
						value !== (flipped ? 255 - source : source) || view[i] !== shown
					);
				});
				expect(bad).toBe(-1);
			}),
			{numRuns: 200},
		);
	});

	it('is its own inverse when the key selects the same pixels twice', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const all = {
					...params,
					threshold: [0, 1] as const,
					invertSelection: false,
				};
				const once = await render(input, all);
				expect((await render(once, all)).data).toEqual(input.data);
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
		const params: ThresholdInvertParams = {
			selectKey: 'hue',
			threshold: [0.1, 0.7],
			invertSelection: true,
			channels: 'blue',
		};
		const saved = stack(instance('thresholdInvert', {params}));
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
			validateParams(thresholdInvertEffect.params, {
				selectKey: 'alpha',
				threshold: [2, -1],
				channels: 'cmy',
			}),
		).toEqual({...DEFAULTS, threshold: [0, 1]});
	});
});
