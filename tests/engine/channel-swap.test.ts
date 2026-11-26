import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	channelSwapEffect,
	type ChannelSwapOrder,
} from '../../src/engine/effects/channel-swap.ts';
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

// Expected output for the input pixels (10, 20, 30, 40) and (50, 60, 70, 0).
const EXPECTED: ReadonlyArray<readonly [ChannelSwapOrder, number[]]> = [
	['rgb', [10, 20, 30, 40, 50, 60, 70, 0]],
	['rbg', [10, 30, 20, 40, 50, 70, 60, 0]],
	['grb', [20, 10, 30, 40, 60, 50, 70, 0]],
	['gbr', [20, 30, 10, 40, 60, 70, 50, 0]],
	['brg', [30, 10, 20, 40, 70, 50, 60, 0]],
	['bgr', [30, 20, 10, 40, 70, 60, 50, 0]],
];

const arbOrder = fc.constantFrom(...EXPECTED.map(([order]) => order));

const arbImage: fc.Arbitrary<RgbaImage> = fc
	.record({
		width: fc.integer({min: 1, max: 64}),
		height: fc.integer({min: 1, max: 64}),
		seed: fc.integer({min: 0, max: 1_000_000}),
	})
	.map(({width, height, seed}) => noiseImage(width, height, seed));

async function render(
	input: RgbaImage,
	order: ChannelSwapOrder,
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: input.width,
		sourceHeight: input.height,
		renderWidth: input.width,
	});
	await channelSwapEffect.render(input, output, {order}, ctx);
	return output;
}

describe('channelSwapEffect', () => {
	it('is registered for the main thread and workers with the spec schema', () => {
		expect(effectRegistry.get('channelSwap')?.params).toBe(
			channelSwapEffect.params,
		);
		expect(runtimeEffectRegistry.get('channelSwap')).toBe(channelSwapEffect);
		expect(channelSwapEffect.version).toBe(1);
		expect(channelSwapEffect.category).toBe('color');
		expect(defaultParams(channelSwapEffect.params)).toEqual({order: 'gbr'});
		const spec = channelSwapEffect.params.order;
		expect(spec.kind === 'enum' && spec.options.map((o) => o.value)).toEqual(
			EXPECTED.map(([order]) => order),
		);
	});

	it.each(EXPECTED)('writes the %s permutation', async (order, expected) => {
		const input = image(2, 1, [10, 20, 30, 40, 50, 60, 70, 0]);
		expect(bytes(await render(input, order))).toEqual(expected);
	});

	it('permutes every pixel of random images and keeps alpha', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbOrder, async (input, order) => {
				const output = await render(input, order);
				const expected = input.data.map((_, i) => {
					const channel = i % 4;
					return channel === 3
						? input.data[i]
						: input.data[i - channel + 'rgb'.indexOf(order[channel])];
				});
				expect(output.data).toEqual(expected);
			}),
			{numRuns: 200},
		);
	});

	it('never writes its input and is deterministic', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbOrder, async (input, order) => {
				const snapshot = bytes(input);
				const first = await render(input, order);
				const second = await render(input, order);
				expect(bytes(input)).toEqual(snapshot);
				expect(first.data).toEqual(second.data);
			}),
			{numRuns: 200},
		);
	});

	it('renders images larger than one checkpoint slice', async () => {
		const input = noiseImage(160, 160, 3);
		const swapped = await render(input, 'bgr');
		expect((await render(swapped, 'bgr')).data).toEqual(input.data);
		expect(swapped.data).not.toEqual(input.data);
	});

	it('survives a saved-stack round trip and repairs an unknown order', async () => {
		const input = noiseImage(9, 7, 5);
		const saved = stack(instance('channelSwap', {params: {order: 'brg'}}));
		// eslint-disable-next-line unicorn/prefer-structured-clone -- saved projects are JSON
		const loaded = JSON.parse(JSON.stringify(saved)) as typeof saved;
		expect(loaded).toEqual(saved);
		const result = await renderStack(
			input,
			loaded,
			runtimeEffectRegistry,
			options(input),
		);
		expect(result.image.data).toEqual((await render(input, 'brg')).data);
		expect(validateParams(channelSwapEffect.params, {order: 'rrr'})).toEqual({
			order: 'gbr',
		});
	});
});
