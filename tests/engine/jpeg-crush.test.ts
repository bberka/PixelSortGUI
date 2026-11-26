import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {
	CHROMA_TABLE,
	DCT_TABLE,
	jpegCrushEffect,
	LUMA_TABLE,
	scaledTable,
	thousandth,
	type JpegCrushParams,
} from '../../src/engine/effects/jpeg-crush.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {createRenderContext, renderStack} from '../../src/engine/pipeline.ts';
import {unit} from '../../src/engine/random.ts';
import {createImage, type RgbaImage} from '../../src/engine/types.ts';
import {modelJpegCrush} from './jpeg-crush-model.ts';
import {bytes, instance, noiseImage, options, stack} from './sample-effects.ts';

const DEFAULTS: JpegCrushParams = {
	blockSize: 8,
	quality: 12,
	chromaSubsample: true,
	corruptRate: 0.05,
	corruptShift: 0.5,
	seed: 0,
};

const arbParams: fc.Arbitrary<JpegCrushParams> = fc.record({
	blockSize: fc.oneof(fc.constant(8), fc.integer({min: 4, max: 64})),
	quality: fc.integer({min: 1, max: 100}),
	chromaSubsample: fc.boolean(),
	corruptRate: fc.integer({min: 0, max: 50}).map((n) => n / 100),
	corruptShift: fc.integer({min: 0, max: 100}).map((n) => n / 100),
	seed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
});

// A render of an image `shrink` times smaller than its source.
const arbCase = fc
	.record({
		width: fc.integer({min: 1, max: 64}),
		height: fc.integer({min: 1, max: 64}),
		seed: fc.integer({min: 0, max: 1_000_000}),
		shrink: fc.oneof(
			fc.constant(1),
			fc.constant(2),
			fc.double({min: 1, max: 9, noNaN: true}),
		),
	})
	.map(({width, height, seed, shrink}) => ({
		input: noiseImage(width, height, seed),
		sourceWidth: Math.round(width * shrink),
		sourceHeight: Math.round(height * shrink),
	}));

async function render(
	input: RgbaImage,
	params: Partial<JpegCrushParams> = {},
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
	await jpegCrushEffect.render(input, output, {...DEFAULTS, ...params}, ctx);
	return output;
}

function flat(width: number, height: number, pixel: number[]): RgbaImage {
	const output = createImage(width, height);
	for (let i = 0; i < output.data.length; i += 4) {
		output.data.set(pixel, i);
	}

	return output;
}

// Which `size`-pixel square blocks differ between two equally sized renders.
function changedBlocks(a: RgbaImage, b: RgbaImage, size: number): string[] {
	const changed = new Set<string>();
	for (let i = 0; i < a.data.length; i++) {
		if (a.data[i] === b.data[i]) {
			continue;
		}

		const x = Math.floor(i / 4) % a.width;
		const y = Math.floor(i / 4 / a.width);
		changed.add(`${Math.floor(x / size)},${Math.floor(y / size)}`);
	}

	return [...changed].toSorted();
}

describe('jpegCrushEffect', () => {
	it('is registered for the main thread and workers with the spec schema', () => {
		expect(effectRegistry.get('jpegCrush')?.params).toBe(
			jpegCrushEffect.params,
		);
		expect(runtimeEffectRegistry.get('jpegCrush')).toBe(jpegCrushEffect);
		expect(jpegCrushEffect.version).toBe(1);
		expect(jpegCrushEffect.category).toBe('glitch');
		expect(defaultParams(jpegCrushEffect.params)).toEqual(DEFAULTS);
	});

	it('checks in the DCT basis rounded from its formula', () => {
		const expected = Array.from({length: 64}, (_, n) => {
			const u = Math.floor(n / 8);
			const amplitude = u === 0 ? Math.sqrt(1 / 8) : 1 / 2;
			return Math.round(
				8192 * amplitude * Math.cos(((2 * (n % 8) + 1) * u * Math.PI) / 16),
			);
		});
		expect([...DCT_TABLE]).toEqual(expected);
	});

	it('scales the quantisation tables by quality within 1..255', () => {
		expect([...scaledTable(LUMA_TABLE, 50)]).toEqual([...LUMA_TABLE]);
		expect([...scaledTable(CHROMA_TABLE, 50)]).toEqual([...CHROMA_TABLE]);
		expect(new Set(scaledTable(LUMA_TABLE, 100))).toEqual(new Set([1]));
		expect(new Set(scaledTable(LUMA_TABLE, 1))).toEqual(new Set([255]));
		// Quality 12: k = 416, so 16 becomes floor((16 * 416 + 50) / 100) = 67.
		expect(scaledTable(LUMA_TABLE, 12)[0]).toBe(67);
	});

	it('divides by 1000 exactly over the colour conversion range', () => {
		let wrong = -1;
		for (let n = 0; n < 470_000 && wrong < 0; n++) {
			if (thousandth(n) !== Math.floor(n / 1000)) {
				wrong = n;
			}
		}

		expect(wrong).toBe(-1);
	});

	// Y, Cb, Cr = 124, 86, 182; their DC levels dequantise to -32, -340 and 425,
	// which invert to 124, 85 and 181.
	it('crushes a flat colour block to the hand-computed colour', async () => {
		const out = await render(flat(8, 8, [200, 100, 50, 90]), {
			quality: 50,
			corruptRate: 0,
		});
		expect(out.data).toEqual(flat(8, 8, [198, 101, 48, 90]).data);
	});

	it('matches a direct reading of the specification', async () => {
		await fc.assert(
			fc.asyncProperty(arbCase, arbParams, async (test, params) => {
				const out = await render(
					test.input,
					params,
					test.sourceWidth,
					test.sourceHeight,
				);
				expect(out.data).toEqual(
					modelJpegCrush(test.input, params, test.sourceWidth).data,
				);
			}),
			{numRuns: 200},
		);
	}, 60_000);

	// Checkerboard and ramp inputs reach larger coefficients than noise does.
	it('matches the specification on extreme blocks', async () => {
		for (const quality of [1, 50, 100]) {
			for (const period of [1, 2, 4, 8]) {
				const input = createImage(24, 16);
				for (let i = 0; i < input.data.length; i += 4) {
					const x = (i / 4) % 24;
					const y = Math.floor(i / 96);
					const on = (Math.floor(x / period) + Math.floor(y / period)) % 2;
					input.data.set([on * 255, on * 255, (1 - on) * 255, 255], i);
				}

				const params = {
					...DEFAULTS,
					quality,
					chromaSubsample: false,
					corruptRate: 0.5,
					corruptShift: 1,
					seed: period,
				};

				expect((await render(input, params)).data).toEqual(
					modelJpegCrush(input, params, 24).data,
				);
			}
		}
	});

	it('corrupts the same source blocks on a half-scale render', async () => {
		const params = {corruptRate: 0.3, corruptShift: 1, seed: 7};
		const expected: string[] = [];
		for (let by = 0; by < 6; by++) {
			for (let bx = 0; bx < 6; bx++) {
				if (unit(params.seed, 1, bx, by) < params.corruptRate) {
					expected.push(`${bx},${by}`);
				}
			}
		}

		expect(expected.length).toBeGreaterThan(0);
		expect(expected.length).toBeLessThan(36);

		for (const size of [48, 24]) {
			const input = flat(size, size, [90, 140, 60, 255]);

			const bent = await render(input, params, 48, 48);

			const clean = await render(input, {...params, corruptRate: 0}, 48, 48);
			expect(changedBlocks(bent, clean, size / 6)).toEqual(expected.toSorted());
		}
	});

	it('keeps each source block to itself on a half-scale render', async () => {
		const input = noiseImage(16, 16, 3);
		const edited = {...input, data: new Uint8ClampedArray(input.data)};
		// Render pixel (5, 1) lies in block (1, 0) of 4 render px.
		edited.data.set([255, 255, 255, 255], (16 + 5) * 4);
		const params = {quality: 80, corruptRate: 0};
		expect(
			changedBlocks(
				await render(input, params, 32, 32),
				await render(edited, params, 32, 32),
				4,
			),
		).toEqual(['1,0']);
	});

	it('does not corrupt at rate 0 or strength 0', async () => {
		await fc.assert(
			fc.asyncProperty(arbCase, arbParams, async ({input}, params) => {
				const noRate = await render(input, {...params, corruptRate: 0});
				const noShift = await render(input, {...params, corruptShift: 0});
				expect(noShift.data).toEqual(noRate.data);
			}),
			{numRuns: 200},
		);
	}, 30_000);

	it('keeps size and alpha, never writes its input and is deterministic', async () => {
		await fc.assert(
			fc.asyncProperty(arbCase, arbParams, async (test, params) => {
				const snapshot = bytes(test.input);
				const first = await render(
					test.input,
					params,
					test.sourceWidth,
					test.sourceHeight,
				);
				const second = await render(
					test.input,
					params,
					test.sourceWidth,
					test.sourceHeight,
				);
				expect(bytes(test.input)).toEqual(snapshot);
				expect(first.data).toEqual(second.data);
				expect(first.data.length).toBe(test.input.data.length);
				expect(
					first.data.findIndex(
						(value, i) => i % 4 === 3 && value !== test.input.data[i],
					),
				).toBe(-1);
			}),
			{numRuns: 200},
		);
	}, 30_000);

	it('handles thin images at both ends of every range', async () => {
		const ends: Array<Partial<JpegCrushParams>> = [
			{
				blockSize: 4,
				quality: 1,
				chromaSubsample: false,
				corruptRate: 0,
				corruptShift: 0,
				seed: 0,
			},
			{
				blockSize: 64,
				quality: 100,
				chromaSubsample: true,
				corruptRate: 0.5,
				corruptShift: 1,
				seed: 0xff_ff_ff_ff,
			},
		];
		for (const [width, height] of [
			[1, 1],
			[1, 70],
			[70, 1],
		]) {
			const input = noiseImage(width, height, 11);
			for (const params of ends) {
				expect((await render(input, params)).data).toEqual(
					modelJpegCrush(input, {...DEFAULTS, ...params}, width).data,
				);
			}
		}
	});

	it('checks for cancellation at least once per 16,384 pixels', async () => {
		const input = createImage(256, 256);
		let calls = 0;
		const ctx = createRenderContext({
			level: 'full',
			sourceWidth: 256,
			sourceHeight: 256,
			renderWidth: 256,
			checkpoint() {
				calls++;
			},
		});
		await jpegCrushEffect.render(input, createImage(256, 256), DEFAULTS, ctx);
		expect(calls).toBeGreaterThanOrEqual(4);
	});

	it('survives a saved-stack round trip and repairs bad values', async () => {
		const input = noiseImage(96, 64, 5);
		const params: JpegCrushParams = {
			blockSize: 12,
			quality: 30,
			chromaSubsample: false,
			corruptRate: 0.2,
			corruptShift: 0.75,
			seed: 99,
		};
		const saved = stack(instance('jpegCrush', {params}));
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
			validateParams(jpegCrushEffect.params, {
				blockSize: 2,
				quality: 0,
				corruptRate: 3,
			}),
		).toEqual({...DEFAULTS, blockSize: 4, quality: 1, corruptRate: 0.5});
	});
});
