import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {
	sliceShiftEffect,
	type SliceShiftParams,
} from '../../src/engine/effects/slice-shift.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {createRenderContext, renderStack} from '../../src/engine/pipeline.ts';
import {intIn, unit} from '../../src/engine/random.ts';
import {createImage, type RgbaImage} from '../../src/engine/types.ts';
import {
	bytes,
	image,
	instance,
	noiseImage,
	options,
	stack,
} from './sample-effects.ts';

// One-line slices that are all active.
const EVERY_LINE: SliceShiftParams = {
	axis: 'horizontal',
	sliceMin: 1,
	sliceMax: 1,
	probability: 1,
	maxOffset: 3,
	edge: 'wrap',
	seed: 7,
};

const arbParams: fc.Arbitrary<SliceShiftParams> = fc.record({
	axis: fc.constantFrom('horizontal', 'vertical'),
	// Mostly small bands and offsets, so small images get several shifted slices.
	sliceMin: fc.oneof(
		fc.integer({min: 1, max: 16}),
		fc.integer({min: 1, max: 2048}),
	),
	sliceMax: fc.oneof(
		fc.integer({min: 1, max: 16}),
		fc.integer({min: 1, max: 2048}),
	),
	probability: fc.integer({min: 0, max: 100}).map((n) => n / 100),
	maxOffset: fc.oneof(
		fc.integer({min: 0, max: 64}),
		fc.integer({min: 0, max: 4096}),
	),
	edge: fc.constantFrom('wrap', 'clamp'),
	seed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
});

const arbImage: fc.Arbitrary<RgbaImage> = fc
	.record({
		width: fc.integer({min: 1, max: 64}),
		height: fc.integer({min: 1, max: 64}),
		seed: fc.integer({min: 0, max: 1_000_000}),
	})
	.map(({width, height, seed}) => noiseImage(width, height, seed));

async function renderDirect(
	input: RgbaImage,
	params: SliceShiftParams,
	source: {width: number; height: number} = input,
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: source.width,
		sourceHeight: source.height,
		renderWidth: input.width,
	});
	await sliceShiftEffect.render(input, output, params, ctx);
	return output;
}

// The slice table exactly as engine.md section 16.1 words it: one source offset per source line.
function sourceOffsets(count: number, params: SliceShiftParams): number[] {
	const {sliceMin, sliceMax, probability, maxOffset, seed} = params;
	const offsets: number[] = [];
	for (let i = 0; offsets.length < count; i++) {
		const size = intIn(sliceMin, Math.max(sliceMin, sliceMax), seed, 1, i);
		const offset =
			unit(seed, 2, i) < probability
				? intIn(-maxOffset, maxOffset, seed, 3, i)
				: 0;
		for (let n = 0; n < size && offsets.length < count; n++) {
			offsets.push(offset);
		}
	}

	return offsets;
}

// Reference render, one pixel at a time.
function expected(
	input: RgbaImage,
	params: SliceShiftParams,
	source: {width: number; height: number} = input,
): number[] {
	const {width, height} = input;
	const isRows = params.axis === 'horizontal';
	const sourceCount = isRows ? source.height : source.width;
	const scale = width / source.width;
	const table = sourceOffsets(sourceCount, params);
	const size = isRows ? width : height;
	const result: number[] = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const line = isRows ? y : x;
			const sourceLine = Math.min(
				sourceCount - 1,
				Math.floor((line + 0.5) / scale),
			);
			const scaled = table[sourceLine] * scale;
			const offset = Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5);
			const along = (isRows ? x : y) - offset;
			const mapped =
				params.edge === 'wrap'
					? ((along % size) + size) % size
					: Math.min(size - 1, Math.max(0, along));
			const from = 4 * (isRows ? y * width + mapped : mapped * width + x);
			result.push(...input.data.subarray(from, from + 4));
		}
	}

	return result;
}

// A 4x2 image whose bytes are all distinct.
const SMALL = image(
	4,
	2,
	Array.from({length: 32}, (_, i) => i),
);

describe('sliceShiftEffect', () => {
	it('is registered in both registries with the spec schema and defaults', () => {
		expect(effectRegistry.get('sliceShift')?.params).toBe(
			sliceShiftEffect.params,
		);
		expect(runtimeEffectRegistry.get('sliceShift')).toBe(sliceShiftEffect);
		expect(sliceShiftEffect.version).toBe(1);
		expect(sliceShiftEffect.category).toBe('glitch');
		expect(defaultParams(sliceShiftEffect.params)).toEqual({
			axis: 'horizontal',
			sliceMin: 4,
			sliceMax: 48,
			probability: 0.3,
			maxOffset: 80,
			edge: 'wrap',
			seed: 0,
		});
	});

	it('shifts each row by its slice offset, moving all four channels', async () => {
		// Seed 7 with these parameters draws offset +1 for row 0 and -2 for row 1.
		expect(sourceOffsets(2, EVERY_LINE)).toEqual([1, -2]);

		const wrapped = await renderDirect(SMALL, EVERY_LINE);
		expect(bytes(wrapped)).toEqual([
			// Row 0 reads columns 3, 0, 1, 2.
			12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
			// Row 1 reads columns 2, 3, 0, 1.
			24, 25, 26, 27, 28, 29, 30, 31, 16, 17, 18, 19, 20, 21, 22, 23,
		]);

		const clamped = await renderDirect(SMALL, {...EVERY_LINE, edge: 'clamp'});
		expect(bytes(clamped)).toEqual([
			// Row 0 reads columns 0, 0, 1, 2.
			0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
			// Row 1 reads columns 2, 3, 3, 3.
			24, 25, 26, 27, 28, 29, 30, 31, 28, 29, 30, 31, 28, 29, 30, 31,
		]);
	});

	it('shifts columns down or up on the vertical axis', async () => {
		// The 2x4 transpose of SMALL: pixel (x, y) here is pixel (y, x) there.
		const tall = image(
			2,
			4,
			[
				0, 1, 2, 3, 16, 17, 18, 19, 4, 5, 6, 7, 20, 21, 22, 23, 8, 9, 10, 11,
				24, 25, 26, 27, 12, 13, 14, 15, 28, 29, 30, 31,
			],
		);
		const vertical: SliceShiftParams = {...EVERY_LINE, axis: 'vertical'};

		expect(bytes(await renderDirect(tall, vertical))).toEqual([
			12, 13, 14, 15, 24, 25, 26, 27, 0, 1, 2, 3, 28, 29, 30, 31, 4, 5, 6, 7,
			16, 17, 18, 19, 8, 9, 10, 11, 20, 21, 22, 23,
		]);
		expect(
			bytes(await renderDirect(tall, {...vertical, edge: 'clamp'})),
		).toEqual([
			0, 1, 2, 3, 24, 25, 26, 27, 0, 1, 2, 3, 28, 29, 30, 31, 4, 5, 6, 7, 28,
			29, 30, 31, 8, 9, 10, 11, 28, 29, 30, 31,
		]);
	});

	it('treats sliceMax below sliceMin as sliceMin', async () => {
		const src = noiseImage(23, 31, 3);
		const params = {...EVERY_LINE, sliceMin: 5, maxOffset: 9};
		expect(bytes(await renderDirect(src, {...params, sliceMax: 1}))).toEqual(
			bytes(await renderDirect(src, {...params, sliceMax: 5})),
		);
	});

	it('gives a different result for a different seed', async () => {
		const src = noiseImage(32, 32, 5);
		const first = await renderDirect(src, EVERY_LINE);
		const second = await renderDirect(src, {...EVERY_LINE, seed: 8});
		expect(bytes(first)).not.toEqual(bytes(second));
	});

	it('keeps slices and offsets in source space on a half-scale render', async () => {
		const src = noiseImage(32, 24, 11);
		const source = {width: 64, height: 48};
		for (const axis of ['horizontal', 'vertical'] as const) {
			const params: SliceShiftParams = {
				...EVERY_LINE,
				axis,
				sliceMin: 3,
				sliceMax: 9,
				maxOffset: 20,
			};
			const out = await renderDirect(src, params, source);
			expect(bytes(out)).toEqual(expected(src, params, source));
			// Not the same picture as laying the slices out over the render size.
			expect(bytes(out)).not.toEqual(expected(src, params));
		}
	});

	it('renders both ends of every range on 1x1, 1xN, Nx1 and odd sizes', async () => {
		const sizes = [
			[1, 1],
			[1, 13],
			[13, 1],
			[17, 11],
		] as const;
		const ends: SliceShiftParams[] = [
			{...EVERY_LINE, probability: 0, maxOffset: 0, seed: 0},
			{
				axis: 'vertical',
				sliceMin: 2048,
				sliceMax: 2048,
				probability: 1,
				maxOffset: 4096,
				edge: 'clamp',
				seed: 0xff_ff_ff_ff,
			},
			{...EVERY_LINE, sliceMin: 1, sliceMax: 2048, maxOffset: 4096},
		];

		for (const [width, height] of sizes) {
			const src = noiseImage(width, height, width * 31 + height);
			for (const params of ends) {
				const out = await renderDirect(src, params);
				expect(bytes(out)).toEqual(expected(src, params));
			}
		}
	});

	it('matches the per-pixel reference at any source scale (200 runs)', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbImage,
				arbParams,
				fc.integer({min: 1, max: 5}),
				async (src, params, factor) => {
					const source = {
						width: src.width * factor,
						height: src.height * factor,
					};
					const out = await renderDirect(src, params, source);
					expect(bytes(out)).toEqual(expected(src, params, source));
				},
			),
			{numRuns: 200},
		);
	});

	it('is the identity when probability or maxOffset is 0 (200 runs)', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbImage,
				arbParams,
				fc.constantFrom('probability', 'maxOffset'),
				async (src, params, zeroed) => {
					const out = await renderDirect(src, {...params, [zeroed]: 0});
					expect(out.data).toEqual(src.data);
				},
			),
			{numRuns: 200},
		);
	});

	it('only moves whole pixels within their own line in wrap mode (200 runs)', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (src, params) => {
				const out = await renderDirect(src, {...params, edge: 'wrap'});
				const lines = (img: RgbaImage) => {
					const isRows = params.axis === 'horizontal';
					const result: string[][] = [];
					for (let y = 0; y < img.height; y++) {
						for (let x = 0; x < img.width; x++) {
							const from = 4 * (y * img.width + x);
							(result[isRows ? y : x] ??= []).push(
								img.data.subarray(from, from + 4).join(','),
							);
						}
					}

					return result.map((line) => line.toSorted());
				};

				expect(lines(out)).toEqual(lines(src));
			}),
			{numRuns: 200},
		);
	});

	it('is deterministic, keeps size and input, and matches mix=0 and a JSON round trip (200 runs)', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (src, params) => {
				const snapshot = new Uint8ClampedArray(src.data);
				const first = await renderDirect(src, params);
				const second = await renderDirect(src, params);

				expect(first.width).toBe(src.width);
				expect(first.height).toBe(src.height);
				expect(src.data).toEqual(snapshot);
				expect(first.data).toEqual(second.data);
				expect(validateParams(sliceShiftEffect.params, params)).toEqual(params);

				const saved = stack(instance('sliceShift', {params}));
				// eslint-disable-next-line unicorn/prefer-structured-clone -- a saved project goes through JSON
				const loaded = JSON.parse(JSON.stringify(saved)) as typeof saved;
				expect(loaded).toEqual(saved);
				const rendered = await renderStack(
					src,
					loaded,
					effectRegistry,
					options(src),
				);
				expect(rendered.image.data).toEqual(first.data);

				const mixZero = await renderStack(
					src,
					stack(instance('sliceShift', {params, mix: 0})),
					effectRegistry,
					options(src),
				);
				expect(mixZero.image.data).toEqual(snapshot);
			}),
			{numRuns: 200},
		);
	});
});
