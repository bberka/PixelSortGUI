import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {
	mirrorFoldEffect,
	type MirrorFoldParams,
} from '../../src/engine/effects/mirror-fold.ts';
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

const DEFAULTS: MirrorFoldParams = {
	mode: 'horizontal',
	flipSource: false,
	centerX: 0.5,
	centerY: 0.5,
};

const arbParams: fc.Arbitrary<MirrorFoldParams> = fc.record({
	mode: fc.constantFrom(
		'horizontal' as const,
		'vertical' as const,
		'quad' as const,
		'octant' as const,
	),
	flipSource: fc.boolean(),
	centerX: fc.integer({min: 0, max: 100}).map((v) => v / 100),
	centerY: fc.integer({min: 0, max: 100}).map((v) => v / 100),
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
	params: Partial<MirrorFoldParams> = {},
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: input.width,
		sourceHeight: input.height,
		renderWidth: input.width,
	});
	await mirrorFoldEffect.render(input, output, {...DEFAULTS, ...params}, ctx);
	return output;
}

/**
An image whose red channel numbers its pixels row by row.
*/
function numbered(width: number, height: number): RgbaImage {
	return image(
		width,
		height,
		Array.from({length: width * height}, (_, i) => [i, 0, 0, 255]).flat(),
	);
}

function reds(output: RgbaImage): number[] {
	return bytes(output).filter((_, i) => i % 4 === 0);
}

describe('mirrorFoldEffect', () => {
	it('is registered for the main thread and workers with the spec schema', () => {
		expect(effectRegistry.get('mirrorFold')?.params).toBe(
			mirrorFoldEffect.params,
		);
		expect(runtimeEffectRegistry.get('mirrorFold')).toBe(mirrorFoldEffect);
		expect(mirrorFoldEffect.version).toBe(1);
		expect(mirrorFoldEffect.category).toBe('glitch');
		expect(defaultParams(mirrorFoldEffect.params)).toEqual(DEFAULTS);
	});

	// 3x3 image numbered 0..8, centre pixel 4.
	it.each([
		['left to right', {}, [0, 1, 0, 3, 4, 3, 6, 7, 6]],
		['right to left', {flipSource: true}, [2, 1, 2, 5, 4, 5, 8, 7, 8]],
		['top to bottom', {mode: 'vertical'}, [0, 1, 2, 3, 4, 5, 0, 1, 2]],
		[
			'bottom to top',
			{mode: 'vertical', flipSource: true},
			[6, 7, 8, 3, 4, 5, 6, 7, 8],
		],
		['quad', {mode: 'quad'}, [0, 1, 0, 3, 4, 3, 0, 1, 0]],
		['octant', {mode: 'octant'}, [8, 5, 8, 5, 4, 5, 8, 5, 8]],
		[
			'flipped octant',
			{mode: 'octant', flipSource: true},
			[0, 3, 0, 3, 4, 3, 0, 3, 0],
		],
	] as const)('writes %s', async (_name, params, expected) => {
		expect(reds(await render(numbered(3, 3), params))).toEqual(expected);
	});

	it('clamps reflections that fall outside the image', async () => {
		expect(reds(await render(numbered(5, 1), {centerX: 0.25}))).toEqual([
			0, 1, 0, 0, 0,
		]);
	});

	it('copies all four channels, including transparency', async () => {
		const input = image(2, 1, [1, 2, 3, 0, 9, 9, 9, 255]);
		expect(bytes(await render(input, {centerX: 0}))).toEqual([
			1, 2, 3, 0, 1, 2, 3, 0,
		]);
	});

	it('keeps size and input, is deterministic and only moves input pixels', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const snapshot = bytes(input);
				const first = await render(input, params);
				const second = await render(input, params);
				expect(bytes(input)).toEqual(snapshot);
				expect(first.data).toEqual(second.data);
				expect([first.width, first.height]).toEqual([
					input.width,
					input.height,
				]);
				const source = new Set(
					new Uint32Array(
						input.data.buffer,
						input.data.byteOffset,
						input.data.length / 4,
					),
				);
				expect(
					new Uint32Array(
						first.data.buffer,
						first.data.byteOffset,
						first.data.length / 4,
					).every((p) => source.has(p)),
				).toBe(true);
			}),
			{numRuns: 200},
		);
	});

	it('is idempotent for centred axis folds', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbImage,
				fc.constantFrom(
					'horizontal' as const,
					'vertical' as const,
					'quad' as const,
				),
				async (input, mode) => {
					const params = {mode, centerX: 0.5, centerY: 0.5};
					const once = await render(input, params);
					expect((await render(once, params)).data).toEqual(once.data);
				},
			),
			{numRuns: 200},
		);
	});

	it('leaves the source side of a horizontal fold untouched', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (input, params) => {
				const output = await render(input, {...params, mode: 'horizontal'});
				const cx = Math.round(params.centerX * (input.width - 1));
				for (let i = 0; i < input.data.length; i++) {
					const x = Math.floor(i / 4) % input.width;
					if (params.flipSource ? x >= cx : x <= cx) {
						expect(output.data[i]).toBe(input.data[i]);
					}
				}
			}),
			{numRuns: 200},
		);
	}, 30_000);

	it('renders every pixel of images larger than one checkpoint slice', async () => {
		const input = noiseImage(160, 160, 3);
		const output = await render(input, {centerX: 1});
		expect(output.data).toEqual(input.data);
	});

	it('survives a saved-stack round trip and repairs bad values', async () => {
		const input = noiseImage(9, 7, 5);
		const params: MirrorFoldParams = {
			mode: 'octant',
			flipSource: true,
			centerX: 0.25,
			centerY: 0.75,
		};
		const saved = stack(instance('mirrorFold', {params}));
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
			validateParams(mirrorFoldEffect.params, {
				mode: 'nope',
				centerX: 4,
				centerY: -1,
			}),
		).toEqual({...DEFAULTS, centerX: 1, centerY: 0});
	});
});
