import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	channelShiftEffect,
	type ChannelShiftParams,
} from '../../src/engine/effects/channel-shift.ts';
import {effectRegistry, effects} from '../../src/engine/effects/index.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {createRenderContext, renderStack} from '../../src/engine/pipeline.ts';
import {
	Cancelled,
	createImage,
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

const ZERO_PARAMS: ChannelShiftParams = {
	redX: 0,
	redY: 0,
	greenX: 0,
	greenY: 0,
	blueX: 0,
	blueY: 0,
	edge: 'clamp',
};

const arbParams: fc.Arbitrary<ChannelShiftParams> = fc.record({
	redX: fc.integer({min: -1024, max: 1024}),
	redY: fc.integer({min: -1024, max: 1024}),
	greenX: fc.integer({min: -1024, max: 1024}),
	greenY: fc.integer({min: -1024, max: 1024}),
	blueX: fc.integer({min: -1024, max: 1024}),
	blueY: fc.integer({min: -1024, max: 1024}),
	edge: fc.constantFrom('clamp', 'wrap'),
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
	params: ChannelShiftParams,
	overrides: {
		sourceWidth?: number;
		sourceHeight?: number;
		checkpoint?: () => void | Promise<void>;
	} = {},
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: overrides.sourceWidth ?? input.width,
		sourceHeight: overrides.sourceHeight ?? input.height,
		renderWidth: input.width,
		checkpoint: overrides.checkpoint,
	});
	await channelShiftEffect.render(input, output, params, ctx);
	return output;
}

describe('channelShiftEffect', () => {
	it('is registered in effects/index.ts with the spec schema and defaults', () => {
		expect(effects.map((effect) => effect.type)).toContain('channelShift');
		expect(effectRegistry.get('channelShift')?.params).toBe(
			channelShiftEffect.params,
		);
		expect(channelShiftEffect.type).toBe('channelShift');
		expect(channelShiftEffect.version).toBe(1);
		expect(channelShiftEffect.category).toBe('glitch');
		expect(defaultParams(channelShiftEffect.params)).toEqual({
			redX: 6,
			redY: 0,
			greenX: 0,
			greenY: 0,
			blueX: -6,
			blueY: 0,
			edge: 'clamp',
		});
	});

	it('matches hand-computed pixels in clamp mode at image borders', async () => {
		// 3x2 image; each pixel has distinct R, G, B, A so channel movement is unambiguous.
		const src = image(
			3,
			2,
			[
				// Row 0: (0,0), (1,0), (2,0)
				10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
				// Row 1: (0,1), (1,1), (2,1)
				130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240,
			],
		);

		// Red shifts (+1, +1) (right 1, down 1), Green shifts (0, -1) (up 1), Blue shifts (-1, 0) (left 1).
		// Alpha stays at (x, y).
		const out = await renderDirect(src, {
			redX: 1,
			redY: 1,
			greenX: 0,
			greenY: -1,
			blueX: -1,
			blueY: 0,
			edge: 'clamp',
		});

		expect(bytes(out)).toEqual([
			// (0,0): R from (0,0)=10, G from (0,1)=140, B from (1,0)=70, A=(0,0)=40
			10, 140, 70, 40,
			// (1,0): R from (0,0)=10, G from (1,1)=180, B from (2,0)=110, A=(1,0)=80
			10, 180, 110, 80,
			// (2,0): R from (1,0)=50, G from (2,1)=220, B from (2,0)=110, A=(2,0)=120
			50, 220, 110, 120,
			// (0,1): R from (0,0)=10, G from (0,1)=140, B from (1,1)=190, A=(0,1)=160
			10, 140, 190, 160,
			// (1,1): R from (0,0)=10, G from (1,1)=180, B from (2,1)=230, A=(1,1)=200
			10, 180, 230, 200,
			// (2,1): R from (1,0)=50, G from (2,1)=220, B from (2,1)=230, A=(2,1)=240
			50, 220, 230, 240,
		]);
	});

	it('matches hand-computed pixels in wrap mode at image borders', async () => {
		const src = image(
			3,
			2,
			[
				// Row 0
				10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
				// Row 1
				130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240,
			],
		);

		// Red (+1, +1), Green (0, -1), Blue (-1, 0), wrap around.
		const out = await renderDirect(src, {
			redX: 1,
			redY: 1,
			greenX: 0,
			greenY: -1,
			blueX: -1,
			blueY: 0,
			edge: 'wrap',
		});

		expect(bytes(out)).toEqual([
			// (0,0): R from (2,1)=210, G from (0,1)=140, B from (1,0)=70, A=40
			210, 140, 70, 40,
			// (1,0): R from (0,1)=130, G from (1,1)=180, B from (2,0)=110, A=80
			130, 180, 110, 80,
			// (2,0): R from (1,1)=170, G from (2,1)=220, B from (0,0)=30, A=120
			170, 220, 30, 120,
			// (0,1): R from (2,0)=90, G from (0,0)=20, B from (1,1)=190, A=160
			90, 20, 190, 160,
			// (1,1): R from (0,0)=10, G from (1,0)=60, B from (2,1)=230, A=200
			10, 60, 230, 200,
			// (2,1): R from (1,0)=50, G from (2,0)=100, B from (0,1)=150, A=240
			50, 100, 150, 240,
		]);
	});

	it('moves each channel independently and preserves alpha at (x, y)', async () => {
		const src = noiseImage(7, 5, 42);
		const onlyRed = await renderDirect(src, {
			...ZERO_PARAMS,
			redX: 2,
			redY: -1,
			edge: 'wrap',
		});

		for (let i = 0; i < src.data.length; i += 4) {
			expect(onlyRed.data[i + 1]).toBe(src.data[i + 1]);
			expect(onlyRed.data[i + 2]).toBe(src.data[i + 2]);
			expect(onlyRed.data[i + 3]).toBe(src.data[i + 3]);
		}

		const onlyGreen = await renderDirect(src, {
			...ZERO_PARAMS,
			greenX: -3,
			greenY: 2,
			edge: 'clamp',
		});
		for (let i = 0; i < src.data.length; i += 4) {
			expect(onlyGreen.data[i]).toBe(src.data[i]);
			expect(onlyGreen.data[i + 2]).toBe(src.data[i + 2]);
			expect(onlyGreen.data[i + 3]).toBe(src.data[i + 3]);
		}

		const onlyBlue = await renderDirect(src, {
			...ZERO_PARAMS,
			blueX: 1,
			blueY: 1,
			edge: 'wrap',
		});
		for (let i = 0; i < src.data.length; i += 4) {
			expect(onlyBlue.data[i]).toBe(src.data[i]);
			expect(onlyBlue.data[i + 1]).toBe(src.data[i + 1]);
			expect(onlyBlue.data[i + 3]).toBe(src.data[i + 3]);
		}
	});

	it('handles offsets larger than the image in both edge modes', async () => {
		const src = image(
			3,
			2,
			[
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
				21, 22, 23, 24,
			],
		);

		// Clamp: redX = 100 clamps x - 100 to 0; blueX = -100 clamps x + 100 to 2.
		const clamped = await renderDirect(src, {
			redX: 100,
			redY: 100,
			greenX: -100,
			greenY: -100,
			blueX: -100,
			blueY: 100,
			edge: 'clamp',
		});
		for (let p = 0; p < clamped.data.length; p += 4) {
			expect(clamped.data[p]).toBe(1); // (0, 0).R
			expect(clamped.data[p + 1]).toBe(22); // (2, 1).G
			expect(clamped.data[p + 2]).toBe(11); // (2, 0).B
			expect(clamped.data[p + 3]).toBe(src.data[p + 3]);
		}

		// Wrap: shifting by a multiple of width/height is the identity.
		const wrapped = await renderDirect(src, {
			redX: 3 * 17,
			redY: -2 * 9,
			greenX: -3 * 5,
			greenY: 2 * 11,
			blueX: 3 * 33,
			blueY: 2 * 4,
			edge: 'wrap',
		});
		expect(bytes(wrapped)).toEqual(bytes(src));
	});

	it('renders at min, max, and default params on 1x1, 1xN, Nx1, and odd-sized images', async () => {
		const sizes: Array<[number, number]> = [
			[1, 1],
			[1, 13],
			[13, 1],
			[17, 11],
		];
		const paramSets: ChannelShiftParams[] = [
			defaultParams(channelShiftEffect.params),
			{
				redX: -1024,
				redY: -1024,
				greenX: -1024,
				greenY: -1024,
				blueX: -1024,
				blueY: -1024,
				edge: 'clamp',
			},
			{
				redX: 1024,
				redY: 1024,
				greenX: 1024,
				greenY: 1024,
				blueX: 1024,
				blueY: 1024,
				edge: 'wrap',
			},
		];

		for (const [w, h] of sizes) {
			const src = noiseImage(w, h, w * 31 + h);
			for (const params of paramSets) {
				const out = await renderDirect(src, params);
				expect(out.width).toBe(w);
				expect(out.height).toBe(h);
				expect(out.data.length).toBe(w * h * 4);
			}
		}
	});

	it('scales offsets with render size for resolution independence (section 10.3)', async () => {
		// At scale 0.5, source offsets (+10, -4) become (+5, -2) in render pixels.
		const renderImg = noiseImage(16, 12, 99);
		const atHalfScale = await renderDirect(
			renderImg,
			{
				redX: 10,
				redY: -4,
				greenX: -6,
				greenY: 2,
				blueX: 4,
				blueY: 8,
				edge: 'wrap',
			},
			{sourceWidth: 32, sourceHeight: 24},
		);
		const atFullScaleHalvedParams = await renderDirect(
			renderImg,
			{
				redX: 5,
				redY: -2,
				greenX: -3,
				greenY: 1,
				blueX: 2,
				blueY: 4,
				edge: 'wrap',
			},
			{sourceWidth: 16, sourceHeight: 12},
		);

		expect(bytes(atHalfScale)).toEqual(bytes(atFullScaleHalvedParams));
	});

	it('calls checkpoint and propagates cancellation', async () => {
		const src = noiseImage(64, 64, 7);
		let calls = 0;
		await expect(
			renderDirect(src, defaultParams(channelShiftEffect.params), {
				checkpoint() {
					calls++;
					if (calls === 1) {
						throw new Cancelled();
					}
				},
			}),
		).rejects.toBeInstanceOf(Cancelled);
		expect(calls).toBe(1);
	});

	it('zero offsets leave any image bit-identical (200 runs)', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbImage,
				fc.constantFrom<'clamp' | 'wrap'>('clamp', 'wrap'),
				async (src, edge) => {
					const out = await renderDirect(src, {...ZERO_PARAMS, edge});
					expect(out.data).toEqual(src.data);
				},
			),
			{numRuns: 200},
		);
	});

	it('is deterministic, preserves input bytes and alpha, and matches mix=0 identity (200 runs)', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (src, params) => {
				const snapshot = new Uint8ClampedArray(src.data);
				const first = await renderDirect(src, params);
				const second = await renderDirect(src, params);

				expect(first.width).toBe(src.width);
				expect(first.height).toBe(src.height);
				expect(src.data).toEqual(snapshot);
				expect(first.data).toEqual(second.data);
				for (let i = 3; i < src.data.length; i += 4) {
					expect(first.data[i]).toBe(src.data[i]);
				}

				const validated = validateParams(channelShiftEffect.params, params);
				expect(validateParams(channelShiftEffect.params, validated)).toEqual(
					validated,
				);

				const mixZero = await renderStack(
					src,
					stack(instance('channelShift', {params, mix: 0})),
					effectRegistry,
					options(src),
				);
				expect(mixZero.image.data).toEqual(snapshot);
			}),
			{numRuns: 200},
		);
	});
});
