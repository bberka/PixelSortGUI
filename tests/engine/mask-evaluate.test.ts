import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {imageBlendEffect} from '../../src/engine/effects/image-blend.ts';
import {
	renderMask,
	resolveMask,
	type MaskInputs,
} from '../../src/engine/mask/evaluate.ts';
import {featherMask} from '../../src/engine/mask/feather.ts';
import {fitPaintedMask} from '../../src/engine/mask/fit.ts';
import {maskGridSize} from '../../src/engine/mask/grid.ts';
import type {MaskBitmap} from '../../src/engine/mask/types.ts';
import {clamp, floorDiv} from '../../src/engine/math.ts';
import {defaultParams} from '../../src/engine/params.ts';
import {createRenderContext} from '../../src/engine/pipeline.ts';
import {hash32} from '../../src/engine/random.ts';
import {
	applyTransform,
	effectiveDimensions,
	IDENTITY_TRANSFORM,
	type RotationDegrees,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import {
	createImage,
	type ExtraSource,
	type RgbaImage,
} from '../../src/engine/types.ts';
import {noiseImage} from './sample-effects.ts';

const HASH = 'cd'.repeat(32);
const noPace = () => undefined;

function grid(
	width: number,
	height: number,
	values: readonly number[],
): MaskBitmap {
	return {width, height, data: Uint8Array.from(values)};
}

function noiseGrid(width: number, height: number, seed = 5): MaskBitmap {
	return {
		width,
		height,
		data: Uint8Array.from(
			{length: width * height},
			(_, i) => hash32(seed, i) % 256,
		),
	};
}

async function fitGrid(
	bitmap: MaskBitmap,
	width: number,
	height: number,
	transform: Partial<SourceTransform> = {},
	source: {width: number; height: number} = bitmap,
): Promise<number[]> {
	const target = new Uint8Array(width * height);
	await fitPaintedMask(
		bitmap,
		{
			sourceWidth: source.width,
			sourceHeight: source.height,
			transform: {...IDENTITY_TRANSFORM, ...transform},
		},
		width,
		height,
		target,
		noPace,
	);
	return [...target];
}

// The final mask of `mask` over `source`, as the pipeline computes it.
async function evaluate(
	mask: unknown,
	source: RgbaImage,
	inputs: Partial<MaskInputs> = {},
	checkpoint: () => void = () => undefined,
): Promise<number[]> {
	const all: MaskInputs = {
		source,
		sourceWidth: source.width,
		sourceHeight: source.height,
		...inputs,
	};
	const resolved = resolveMask(mask, all);
	if (resolved.status !== 'ready') {
		throw new Error(resolved.code);
	}

	const size = source.width * source.height;
	return [
		...(await renderMask(resolved, {
			width: source.width,
			height: source.height,
			sourceWidth: all.sourceWidth,
			target: new Uint8Array(size).fill(77),
			spare: () => new Uint8Array(size).fill(99),
			checkpoint,
		})),
	];
}

function greyRow(...levels: number[]): RgbaImage {
	return {
		width: levels.length,
		height: 1,
		data: new Uint8ClampedArray(levels.flatMap((g) => [g, g, g, 255])),
	};
}

describe('fitting a painted mask (engine.md section 16.6)', () => {
	const six = grid(3, 2, [10, 20, 30, 40, 50, 60]);

	it('copies the grid for an identity transform at the grid size', async () => {
		expect(await fitGrid(six, 3, 2)).toEqual([...six.data]);
	});

	it.each<[RotationDegrees, boolean, boolean, number[]]>([
		[0, true, false, [30, 20, 10, 60, 50, 40]],
		[0, false, true, [40, 50, 60, 10, 20, 30]],
		[90, false, false, [40, 10, 50, 20, 60, 30]],
		[180, false, false, [60, 50, 40, 30, 20, 10]],
		[270, false, false, [30, 60, 20, 50, 10, 40]],
		[90, true, false, [10, 40, 20, 50, 30, 60]],
		[270, false, true, [10, 40, 20, 50, 30, 60]],
	])(
		'orients the grid: rotation %i, flipX %s, flipY %s',
		async (rotation, flipX, flipY, expected) => {
			const turned = rotation === 90 || rotation === 270;
			expect(
				await fitGrid(six, turned ? 2 : 3, turned ? 3 : 2, {
					rotation,
					flipX,
					flipY,
				}),
			).toEqual(expected);
		},
	);

	it('takes the crop in oriented source pixels', async () => {
		const four = grid(4, 1, [10, 20, 30, 40]);
		const crop = {x: 1, y: 0, width: 2, height: 1};
		expect(await fitGrid(four, 2, 1, {crop})).toEqual([20, 30]);
		// Flipped first, so the same rectangle reads the other way round.
		expect(await fitGrid(four, 2, 1, {crop, flipX: true})).toEqual([30, 20]);
	});

	it('averages by area when shrinking', async () => {
		const four = grid(4, 1, [0, 100, 200, 255]);
		expect(await fitGrid(four, 2, 1)).toEqual([50, 228]);
		// 1.5 grid pixels per destination: weights 256 and 128.
		expect(await fitGrid(grid(3, 1, [0, 90, 255]), 2, 1)).toEqual([30, 200]);
	});

	it('interpolates linearly when enlarging', async () => {
		expect(await fitGrid(grid(2, 1, [0, 255]), 4, 1)).toEqual([
			0, 64, 191, 255,
		]);
		expect(await fitGrid(grid(1, 2, [0, 255]), 1, 4)).toEqual([
			0, 64, 191, 255,
		]);
	});

	it('uses the two-dimensional weights of both axes', async () => {
		expect(await fitGrid(grid(2, 2, [0, 40, 80, 200]), 1, 1)).toEqual([80]);
		// (1, 1) of a 4 x 4 render takes 3/4 and 1/4 of each axis.
		const out = await fitGrid(grid(2, 2, [0, 64, 128, 255]), 4, 4);
		expect(out[5]).toBe(floorDiv(2 * (3 * 64 + 128 * 3 + 255) + 16, 32));
	});

	it('scales a grid smaller than the stored source', async () => {
		// An 8 px source with a 4 px grid, cropped to its right half.
		const four = grid(4, 1, [10, 20, 30, 40]);
		const crop = {x: 4, y: 0, width: 4, height: 1};
		expect(await fitGrid(four, 2, 1, {crop}, {width: 8, height: 1})).toEqual([
			30, 40,
		]);
	});

	it('orients and crops like the geometry transform of the photo', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.record({
					width: fc.integer({min: 1, max: 9}),
					height: fc.integer({min: 1, max: 9}),
					rotation: fc.constantFrom<RotationDegrees>(0, 90, 180, 270),
					flipX: fc.boolean(),
					flipY: fc.boolean(),
					cut: fc.tuple(fc.nat(), fc.nat(), fc.nat(), fc.nat()),
				}),
				async ({width, height, rotation, flipX, flipY, cut}) => {
					const turned = rotation === 90 || rotation === 270;
					const [w, h] = turned ? [height, width] : [width, height];
					const x = cut[0] % w;
					const y = cut[1] % h;
					const crop = {
						x,
						y,
						width: 1 + (cut[2] % (w - x)),
						height: 1 + (cut[3] % (h - y)),
					};
					const transform = {
						rotation,
						flipX,
						flipY,
						crop,
						resize: null,
					};
					const bitmap = noiseGrid(width, height);
					const photo = createImage(width, height);
					for (const [i, value] of bitmap.data.entries()) {
						photo.data[4 * i] = value;
					}

					const expected = applyTransform(photo, transform);
					const actual = await fitGrid(
						bitmap,
						crop.width,
						crop.height,
						transform,
					);
					expect(actual).toEqual(
						Array.from(
							{length: crop.width * crop.height},
							(_, i) => expected.data[4 * i],
						),
					);
				},
			),
		);
	});

	it('maps the crop, not the resize filter, onto the render', async () => {
		const bitmap = noiseGrid(12, 8);
		const crop = {x: 2, y: 2, width: 8, height: 4};
		const resized = (filter: 'nearest' | 'lanczos3') =>
			fitGrid(bitmap, 16, 8, {crop, resize: {width: 16, height: 8, filter}});
		expect(await resized('nearest')).toEqual(await resized('lanczos3'));
		expect(await resized('nearest')).toEqual(
			await fitGrid(bitmap, 16, 8, {crop}),
		);
	});

	it('keeps a flat grid flat at any size and crop', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 0, max: 255}),
				fc.integer({min: 1, max: 40}),
				fc.integer({min: 1, max: 40}),
				fc.integer({min: 1, max: 40}),
				async (value, side, source, render) => {
					const bitmap = grid(
						side,
						1,
						Array.from({length: side}, () => value),
					);
					const out = await fitGrid(
						bitmap,
						render,
						3,
						{},
						{width: source, height: 1},
					);
					expect(new Set(out)).toEqual(new Set([value]));
				},
			),
		);
	});

	it('throws for a transform outside the source', async () => {
		await expect(
			fitGrid(six, 3, 2, {crop: {x: 2, y: 0, width: 2, height: 1}}),
		).rejects.toThrow(RangeError);
	});
});

describe('resolving a painted mask', () => {
	const source = noiseImage(3, 2);
	const painted = {kind: 'paint', asset: HASH};
	const six = grid(3, 2, [0, 51, 102, 153, 204, 255]);

	it('sizes the grid by the 4 MP cap on the stored source', () => {
		expect(maskGridSize(640, 480)).toMatchObject({width: 640, height: 480});
		expect(maskGridSize(8192, 2048)).toMatchObject({width: 4096, height: 1024});
	});

	it('reads the bitmap named by the asset', async () => {
		expect(
			await evaluate(painted, source, {masks: new Map([[HASH, six]])}),
		).toEqual([...six.data]);
	});

	it('is 0 everywhere for an empty asset, and 255 once inverted', async () => {
		expect(await evaluate({kind: 'paint'}, source)).toEqual([0, 0, 0, 0, 0, 0]);
		expect(await evaluate({kind: 'paint', invert: true}, source)).toEqual([
			255, 255, 255, 255, 255, 255,
		]);
	});

	it('is missing without the bitmap or with the wrong size', () => {
		const inputs = {source, sourceWidth: 3, sourceHeight: 2};
		const bad = [
			undefined,
			grid(2, 3, [...six.data]),
			grid(3, 1, [1, 2, 3]),
			{width: 3, height: 2, data: new Uint8Array(5)},
		];
		for (const bitmap of bad) {
			const masks = bitmap && new Map([[HASH, bitmap]]);
			expect(resolveMask(painted, {...inputs, masks})).toEqual({
				status: 'missing',
				code: 'missing-mask',
			});
		}

		// The grid follows the stored source, not the effective image.
		expect(
			resolveMask(painted, {
				...inputs,
				masks: new Map([[HASH, six]]),
				geometry: {
					sourceWidth: 6,
					sourceHeight: 4,
					transform: IDENTITY_TRANSFORM,
				},
			}),
		).toMatchObject({status: 'missing'});
	});

	it('places the grid through the geometry', async () => {
		const transform: SourceTransform = {...IDENTITY_TRANSFORM, rotation: 90};
		expect(effectiveDimensions(3, 2, transform)).toEqual({
			width: 2,
			height: 3,
		});
		expect(
			await evaluate(painted, noiseImage(2, 3), {
				masks: new Map([[HASH, six]]),
				geometry: {sourceWidth: 3, sourceHeight: 2, transform},
			}),
		).toEqual([153, 0, 204, 51, 255, 102]);
	});
});

describe('brightness base', () => {
	const levels = greyRow(0, 50, 51, 52, 127, 128, 153, 154, 255);

	it('is exact at both ends with softness 0', async () => {
		const mask = {kind: 'luma', range: [0.2, 0.6], softness: 0};
		expect(await evaluate(mask, levels)).toEqual([
			0, 0, 255, 255, 255, 255, 255, 0, 0,
		]);
	});

	it('selects 128 and up for the range 50% to 100% (AC-F29.10)', async () => {
		const mask = {kind: 'luma', range: [0.5, 1], softness: 0};
		expect(await evaluate(mask, greyRow(127, 128))).toEqual([0, 255]);
	});

	it('ramps down over the softness on both sides', async () => {
		// Lo 51, hi 153, s = 26.
		const mask = {kind: 'luma', range: [0.2, 0.6], softness: 0.1};
		expect(
			await evaluate(
				mask,
				greyRow(24, 25, 38, 50, 51, 153, 154, 166, 179, 180),
			),
		).toEqual([0, 9, 132, 246, 255, 255, 246, 132, 9, 0]);
	});

	it('uses rounded Rec. 709 luma and ignores alpha', async () => {
		const image: RgbaImage = {
			width: 2,
			height: 1,
			// Pure green has luma 182.
			data: new Uint8ClampedArray([0, 255, 0, 0, 0, 255, 0, 255]),
		};
		const at = (level: number) => ({
			kind: 'luma',
			range: [level / 255, level / 255],
			softness: 0,
		});
		expect(await evaluate(at(182), image)).toEqual([255, 255]);
		expect(await evaluate(at(183), image)).toEqual([0, 0]);
	});
});

describe('image base', () => {
	function extra(
		width: number,
		height: number,
		pixels: ReadonlyArray<readonly [number, number, number, number]>,
	): ExtraSource {
		return {
			width,
			height,
			sourceWidth: width,
			sourceHeight: height,
			data: new Uint8ClampedArray(pixels.flat()),
		};
	}

	const WHITE = [255, 255, 255, 255] as const;
	const BLACK = [0, 0, 0, 255] as const;
	const from = (image: ExtraSource) => ({
		extraSources: new Map([[HASH, image]]),
	});
	const imageMask = (fitName: string) => ({
		kind: 'image',
		source: HASH,
		fit: fitName,
	});

	it('stretches the image over the frame with bilinear sampling', async () => {
		const halves = extra(2, 1, [WHITE, BLACK]);
		expect(
			await evaluate(imageMask('stretch'), noiseImage(4, 1), from(halves)),
		).toEqual([255, 191, 64, 0]);
	});

	it('is transparent black outside a contained image', async () => {
		const dot = extra(1, 1, [WHITE]);
		expect(
			await evaluate(imageMask('contain'), noiseImage(3, 1), from(dot)),
		).toEqual([0, 255, 0]);
		expect(
			await evaluate(imageMask('contain'), noiseImage(1, 3), from(dot)),
		).toEqual([0, 255, 0]);
		expect(
			await evaluate(imageMask('cover'), noiseImage(3, 1), from(dot)),
		).toEqual([255, 255, 255]);
	});

	it('weighs luma by alpha', async () => {
		const image = extra(3, 1, [
			[255, 255, 255, 128],
			[255, 255, 255, 0],
			[0, 255, 0, 255],
		]);
		expect(
			await evaluate(imageMask('stretch'), noiseImage(3, 1), from(image)),
		).toEqual([128, 0, 182]);
	});

	it('is 0 everywhere for no image and missing for an absent one', async () => {
		const source = noiseImage(2, 1);
		expect(await evaluate({kind: 'image'}, source)).toEqual([0, 0]);
		expect(
			resolveMask(imageMask('cover'), {
				source,
				sourceWidth: 2,
				sourceHeight: 1,
			}),
		).toEqual({status: 'missing', code: 'missing-source'});
	});

	it('samples exactly like imageBlend over a transparent base', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.record({
					width: fc.integer({min: 1, max: 12}),
					height: fc.integer({min: 1, max: 12}),
					imageWidth: fc.integer({min: 1, max: 12}),
					imageHeight: fc.integer({min: 1, max: 12}),
					seed: fc.integer({min: 0, max: 0xff_ff}),
					fit: fc.constantFrom('cover', 'contain', 'stretch'),
				}),
				async ({
					width,
					height,
					imageWidth,
					imageHeight,
					seed,
					fit: fitName,
				}) => {
					const image: ExtraSource = {
						...noiseImage(imageWidth, imageHeight, seed),
						sourceWidth: imageWidth,
						sourceHeight: imageHeight,
					};
					const base = createImage(width, height);
					const sampled = createImage(width, height);
					await imageBlendEffect.render(
						base,
						sampled,
						{
							...defaultParams(imageBlendEffect.params),
							image: HASH,
							fit: fitName,
						},
						createRenderContext({
							level: 'full',
							sourceWidth: width,
							sourceHeight: height,
							renderWidth: width,
							extraSources: new Map([[HASH, image]]),
						}),
					);
					const expected = Array.from({length: width * height}, (_, i) => {
						const [r, g, b, a] = sampled.data.subarray(4 * i, 4 * i + 4);
						const level = floorDiv(
							2126 * r + 7152 * g + 722 * b + 5000,
							10_000,
						);
						return floorDiv(2 * level * a + 255, 510);
					});
					expect(await evaluate(imageMask(fitName), base, from(image))).toEqual(
						expected,
					);
				},
			),
		);
	});
});

// Section 16.6 feather written the slow way.
function modelFeather(
	values: Uint8Array,
	width: number,
	height: number,
	radius: number,
): number[] {
	const n = 2 * radius + 1;
	let map = [...values];
	for (let pass = 0; pass < 2; pass++) {
		for (const [dx, dy] of [
			[1, 0],
			[0, 1],
		]) {
			const from = map;
			map = from.map((_, i) => {
				let sum = 0;
				for (let d = -radius; d <= radius; d++) {
					const x = clamp((i % width) + d * dx, 0, width - 1);
					const y = clamp(Math.floor(i / width) + d * dy, 0, height - 1);
					sum += from[y * width + x];
				}

				return floorDiv(2 * sum + n, 2 * n);
			});
		}
	}

	return map;
}

describe('feather', () => {
	async function feathered(
		bitmap: MaskBitmap,
		radius: number,
	): Promise<number[]> {
		const mask = Uint8Array.from(bitmap.data);
		await featherMask(
			mask,
			new Uint8Array(mask.length),
			bitmap.width,
			bitmap.height,
			radius,
			noPace,
		);
		return [...mask];
	}

	it('runs two box passes', async () => {
		const spike = grid(5, 1, [0, 0, 255, 0, 0]);
		expect(await feathered(spike, 1)).toEqual([28, 57, 85, 57, 28]);
		expect(await feathered(grid(1, 5, [...spike.data]), 1)).toEqual([
			28, 57, 85, 57, 28,
		]);
		expect(await feathered(spike, 0)).toEqual([...spike.data]);
	});

	it('matches the slow model, also for a radius past the image', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 1, max: 12}),
				fc.integer({min: 1, max: 12}),
				fc.oneof(fc.integer({min: 1, max: 6}), fc.integer({min: 7, max: 64})),
				fc.integer({min: 0, max: 0xff_ff}),
				async (width, height, radius, seed) => {
					const bitmap = noiseGrid(width, height, seed);
					expect(await feathered(bitmap, radius)).toEqual(
						modelFeather(bitmap.data, width, height, radius),
					);
				},
			),
		);
	});

	const spikeSource = greyRow(0, 0, 0, 0, 255, 0, 0, 0, 0);
	const lumaSpike = {kind: 'luma', range: [1, 1], softness: 0};

	it('scales the radius from effective-image pixels', async () => {
		// A render at half size: feather 2 px is a radius of 1.
		const half = await evaluate({...lumaSpike, feather: 2}, spikeSource, {
			sourceWidth: 18,
		});
		expect(half).toEqual([0, 0, 28, 57, 85, 57, 28, 0, 0]);
		// A positive feather never becomes a radius of 0.
		const tiny = await evaluate({...lumaSpike, feather: 1}, spikeSource, {
			sourceWidth: 900,
		});
		expect(tiny).toEqual(half);
	});

	it('runs before invert', async () => {
		const out = await evaluate(
			{...lumaSpike, feather: 1, invert: true},
			spikeSource,
		);
		expect(out).toEqual([255, 255, 227, 198, 170, 198, 227, 255, 255]);
	});
});

describe('mask checkpoints', () => {
	// 200 x 200 px: each full pass over the mask owes at least two checkpoints.
	const source = noiseImage(200, 200);
	const passes = Math.floor(40_000 / 16_384);

	it.each([
		['luma', {kind: 'luma'}],
		['paint', {kind: 'paint', asset: HASH}],
		['image', {kind: 'image', source: HASH}],
	])('checkpoints while rendering a %s mask', async (_name, mask) => {
		const inputs = {
			masks: new Map([[HASH, noiseGrid(200, 200)]]),
			extraSources: new Map([
				[HASH, {...source, sourceWidth: 200, sourceHeight: 200}],
			]),
		};
		let plain = 0;
		await evaluate(mask, source, inputs, () => {
			plain++;
		});
		let full = 0;
		await evaluate({...mask, feather: 3, invert: true}, source, inputs, () => {
			full++;
		});
		expect(plain).toBeGreaterThanOrEqual(passes);
		// Base, four blur passes and invert.
		expect(full).toBeGreaterThanOrEqual(6 * passes);
	});

	it('stops when the checkpoint throws', async () => {
		await expect(
			evaluate({kind: 'luma'}, source, {}, () => {
				throw new Error('stale');
			}),
		).rejects.toThrow('stale');
	});
});
