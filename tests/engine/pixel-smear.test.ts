import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {
	pixelSmearEffect,
	type PixelSmearParams,
} from '../../src/engine/effects/pixel-smear.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {SORT_KEYS} from '../../src/engine/keys.ts';
import {createLinePartition} from '../../src/engine/lines.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {createRenderContext, renderStack} from '../../src/engine/pipeline.ts';
import {
	createImage,
	type DebugView,
	type RgbaImage,
} from '../../src/engine/types.ts';
import {
	bytes,
	image,
	instance,
	noiseImage,
	options,
	stack,
} from './sample-effects.ts';

const DEFAULTS: PixelSmearParams = {
	angle: 270,
	selectKey: 'luma',
	threshold: [0.5, 1],
	invert: false,
	decay: 0.92,
	maxLength: 120,
};

const arbParams: fc.Arbitrary<PixelSmearParams> = fc.record({
	angle: fc.integer({min: 0, max: 3599}).map((n) => n / 10),
	selectKey: fc.constantFrom(...SORT_KEYS),
	threshold: fc
		.tuple(fc.integer({min: 0, max: 1000}), fc.integer({min: 0, max: 1000}))
		.map(
			([a, b]) =>
				[Math.min(a, b) / 1000, Math.max(a, b) / 1000] as [number, number],
		),
	invert: fc.boolean(),
	decay: fc.integer({min: 0, max: 99}).map((n) => n / 100),
	maxLength: fc.integer({min: 1, max: 4096}),
});

// Noise with a share of fully transparent pixels.
const arbImage: fc.Arbitrary<RgbaImage> = fc
	.record({
		width: fc.integer({min: 1, max: 64}),
		height: fc.integer({min: 1, max: 64}),
		seed: fc.integer({min: 0, max: 1_000_000}),
	})
	.map(({width, height, seed}) => {
		const noise = noiseImage(width, height, seed);
		for (let i = 3; i < noise.data.length; i += 4) {
			if (noise.data[i] < 40) {
				noise.data[i] = 0;
			}
		}

		return noise;
	});

async function render(
	input: RgbaImage,
	params: Partial<PixelSmearParams> = {},
	{
		sourceWidth = input.width,
		sourceHeight = input.height,
		debugView = 'none',
	}: {
		sourceWidth?: number;
		sourceHeight?: number;
		debugView?: DebugView;
	} = {},
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth,
		sourceHeight,
		renderWidth: input.width,
		debugView,
	});
	await pixelSmearEffect.render(input, output, {...DEFAULTS, ...params}, ctx);
	return output;
}

// Opaque greys; `alpha` overrides single pixels.
function greys(
	width: number,
	values: number[],
	alpha: Record<number, number> = {},
): RgbaImage {
	return image(
		width,
		values.length / width,
		values.flatMap((v, i) => [v, v, v, alpha[i] ?? 255]),
	);
}

function reds(output: RgbaImage): number[] {
	return bytes(output).filter((_, i) => i % 4 === 0);
}

// Pixels the effect selects, read from the selection view of an opaque image
// with no channel below 4, which the view therefore darkens when unselected.
async function selection(
	input: RgbaImage,
	params: PixelSmearParams,
): Promise<boolean[]> {
	const view = await render(input, params, {debugView: 'selection'});
	return Array.from({length: input.width * input.height}, (_, i) =>
		samePixel(view, input, i),
	);
}

// Engine.md section 16.1: the decay blend, `d` in thousandths.
function blend(carry: number[], rgb: number[], d: number): number[] {
	return rgb.map((v, c) =>
		Math.floor((2 * (carry[c] * d + v * (1000 - d)) + 1000) / 2000),
	);
}

function samePixel(a: RgbaImage, b: RgbaImage, i: number): boolean {
	return [0, 1, 2].every((c) => a.data[4 * i + c] === b.data[4 * i + c]);
}

describe('pixelSmearEffect', () => {
	it('is registered for the main thread and workers with the spec schema', () => {
		expect(effectRegistry.get('pixelSmear')?.params).toBe(
			pixelSmearEffect.params,
		);
		expect(effectRegistry.get('pixelSmear')?.debugViews).toEqual(['selection']);
		expect(runtimeEffectRegistry.get('pixelSmear')).toBe(pixelSmearEffect);
		expect(pixelSmearEffect.version).toBe(1);
		expect(pixelSmearEffect.category).toBe('glitch');
		expect(defaultParams(pixelSmearEffect.params)).toEqual(DEFAULTS);
	});

	it('blends the carried colour into each following pixel up to the length', async () => {
		const out = await render(greys(5, [255, 0, 0, 0, 0]), {
			angle: 0,
			decay: 0.5,
			maxLength: 2,
		});
		// 255 -> 127.5 rounds to 128, then 64; the trail ends after two pixels.
		expect(reds(out)).toEqual([255, 128, 64, 0, 0]);
	});

	it('reloads the carry at every selected pixel', async () => {
		const out = await render(greys(5, [255, 0, 200, 0, 0]), {
			angle: 0,
			decay: 0.5,
			maxLength: 1,
		});
		expect(reds(out)).toEqual([255, 128, 200, 100, 0]);
	});

	it('walks the line in the direction of the angle', async () => {
		const input = greys(1, [0, 0, 255]);
		// 90 reads the column bottom to top, 270 top to bottom.
		expect(reds(await render(input, {angle: 90, decay: 0.5}))).toEqual([
			64, 128, 255,
		]);
		expect(reds(await render(input, {angle: 270, decay: 0.5}))).toEqual([
			0, 0, 255,
		]);
		const diagonal = greys(2, [0, 0, 255, 0]);
		// 45 runs up and to the right: (0, 1) then (1, 0).
		expect(reds(await render(diagonal, {angle: 45, decay: 0.5}))).toEqual([
			0, 128, 255, 0,
		]);
	});

	it('passes over transparent pixels without spending the trail', async () => {
		const input = greys(4, [255, 7, 0, 0], {1: 0});
		const out = await render(input, {angle: 0, decay: 0.5, maxLength: 1});
		expect(reds(out)).toEqual([255, 7, 128, 0]);
		expect(out.data[7]).toBe(0);
	});

	it('never selects a transparent pixel', async () => {
		const input = greys(2, [255, 0], {0: 0});
		expect((await render(input, {angle: 0})).data).toEqual(input.data);
	});

	it('scales the trail length with the render', async () => {
		const input = greys(4, [255, 0, 0, 0]);
		const out = await render(
			input,
			{angle: 0, decay: 0.5, maxLength: 4},
			{sourceWidth: 8, sourceHeight: 2},
		);
		expect(reds(out)).toEqual([255, 128, 64, 0]);
	});

	it('renders buffers that are not word aligned', async () => {
		const input = noiseImage(9, 7, 3);
		const shifted = (data?: Uint8ClampedArray): RgbaImage => {
			const buffer = new Uint8ClampedArray(input.data.length + 1).subarray(1);
			buffer.set(data ?? []);
			return {width: 9, height: 7, data: buffer};
		};

		const output = shifted();
		await pixelSmearEffect.render(
			shifted(input.data),
			output,
			{...DEFAULTS, angle: 30},
			createRenderContext({
				level: 'full',
				sourceWidth: 9,
				sourceHeight: 7,
				renderWidth: 9,
			}),
		);
		expect([...output.data]).toEqual(bytes(await render(input, {angle: 30})));
	});

	it('darkens unselected pixels in the selection view', async () => {
		const input = image(3, 1, [200, 220, 240, 255, 40, 80, 123, 9, 9, 9, 9, 0]);
		const out = await render(input, {angle: 0}, {debugView: 'selection'});
		expect(bytes(out)).toEqual([200, 220, 240, 255, 10, 20, 30, 9, 2, 2, 2, 0]);
	});

	it('keeps alpha, selected pixels and transparent pixels', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const opaque = {
					...input,
					data: input.data.map((v, i) => (i % 4 === 3 ? 255 : Math.max(4, v))),
				};
				const selected = await selection(opaque, params);
				const out = await render(opaque, params);
				const moved = selected.findIndex(
					(on, i) => on && !samePixel(out, opaque, i),
				);
				expect(moved).toBe(-1);
				const {data} = await render(input, params);
				// One assertion per image: per-pixel `expect` calls time out under load.
				const bad = data.findIndex((value, i) => {
					const transparent = input.data[i - (i % 4) + 3] === 0;
					return (i % 4 === 3 || transparent) && value !== input.data[i];
				});
				expect(bad).toBe(-1);
			}),
			{numRuns: 200},
		);
	});

	it('matches a pixel-by-pixel walk of the line partition', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const opaque = {
					...input,
					data: input.data.map((v, i) => (i % 4 === 3 ? 255 : Math.max(4, v))),
				};
				const selected = await selection(opaque, params);
				const expected = new Uint8ClampedArray(opaque.data);
				const d = Math.round(params.decay * 1000);
				const walker = createLinePartition(
					opaque.width,
					opaque.height,
					params.angle,
					{disableFastPath: true},
				).createWalker();
				const offsets = new Int32Array(64);
				while (walker.next()) {
					const length = walker.fillOffsets(offsets);
					let carry = [0, 0, 0];
					let remaining = 0;
					for (const at of offsets.subarray(0, length)) {
						const rgb = [...opaque.data.subarray(4 * at, 4 * at + 3)];
						if (selected[at]) {
							carry = rgb;
							remaining = params.maxLength;
						} else if (remaining > 0) {
							carry = blend(carry, rgb, d);
							expected.set(carry, 4 * at);
							remaining--;
						}
					}
				}

				expect((await render(opaque, params)).data).toEqual(expected);
			}),
			{numRuns: 200},
		);
	});

	it('is the identity at decay 0 and when every pixel is selected', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				expect((await render(input, {...params, decay: 0})).data).toEqual(
					input.data,
				);
				const all = {...params, threshold: [0, 1] as const, invert: false};
				expect((await render(input, all)).data).toEqual(input.data);
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
		const params: PixelSmearParams = {
			angle: 33.3,
			selectKey: 'hue',
			threshold: [0.1, 0.4],
			invert: true,
			decay: 0.7,
			maxLength: 9,
		};
		const saved = stack(instance('pixelSmear', {params}));
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
			validateParams(pixelSmearEffect.params, {decay: 2, maxLength: 0}),
		).toEqual({...DEFAULTS, decay: 0.99, maxLength: 1});
	});
});
