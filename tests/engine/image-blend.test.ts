import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {channelShiftEffect} from '../../src/engine/effects/channel-shift.ts';
import {
	BLEND_CHANNEL,
	imageBlendEffect,
	type ImageBlendFit,
	type ImageBlendMode,
	type ImageBlendParams,
} from '../../src/engine/effects/image-blend.ts';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {pixelSortEffect} from '../../src/engine/effects/pixel-sort/index.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {
	createRenderContext,
	createStageCache,
	renderStack,
} from '../../src/engine/pipeline.ts';
import {applyTransform} from '../../src/engine/transform.ts';
import {
	Cancelled,
	copyImage,
	createImage,
	type ExtraSource,
	type RgbaImage,
} from '../../src/engine/types.ts';
import {modelImageBlend} from './image-blend-model.ts';
import {
	bytes,
	image,
	instance,
	noiseImage,
	options,
	stack,
} from './sample-effects.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const DEFAULTS: ImageBlendParams = {
	image: '',
	blendMode: 'normal',
	opacity: 1,
	fit: 'cover',
	scale: 1,
	offsetX: 0,
	offsetY: 0,
	rotation: 0,
};

const MODES: readonly ImageBlendMode[] = [
	'normal',
	'multiply',
	'screen',
	'overlay',
	'lighten',
	'darken',
	'difference',
	'exclusion',
	'add',
	'subtract',
];

const FITS: readonly ImageBlendFit[] = [
	'cover',
	'contain',
	'stretch',
	'tile',
	'none',
];

function extra(
	pixels: RgbaImage,
	sourceWidth = pixels.width,
	sourceHeight = pixels.height,
): ExtraSource {
	return {...pixels, sourceWidth, sourceHeight};
}

function flat(width: number, height: number, pixel: number[]): RgbaImage {
	const output = createImage(width, height);
	for (let i = 0; i < output.data.length; i += 4) {
		output.data.set(pixel, i);
	}

	return output;
}

// `image` with every pixel opaque.
function opaque(source: RgbaImage): RgbaImage {
	const output = copyImage(source);
	for (let i = 3; i < output.data.length; i += 4) {
		output.data[i] = 255;
	}

	return output;
}

type RenderOptions = {
	sourceWidth?: number;
	sourceHeight?: number;
};

async function render(
	base: RgbaImage,
	overlay: ExtraSource | RgbaImage | undefined,
	params: Partial<ImageBlendParams> = {},
	{sourceWidth = base.width, sourceHeight = base.height}: RenderOptions = {},
): Promise<RgbaImage> {
	const output = createImage(base.width, base.height);
	output.data.fill(123);
	const sources = new Map<string, ExtraSource>();
	if (overlay) {
		sources.set(SHA_A, 'sourceWidth' in overlay ? overlay : extra(overlay));
	}

	const ctx = createRenderContext({
		level: 'full',
		sourceWidth,
		sourceHeight,
		renderWidth: base.width,
		extraSources: sources,
	});
	await imageBlendEffect.render(
		base,
		output,
		{...DEFAULTS, image: SHA_A, ...params},
		ctx,
	);
	return output;
}

function pixelAt(source: RgbaImage, x: number, y: number): number[] {
	const p = (y * source.width + x) * 4;
	return [...source.data.slice(p, p + 4)];
}

// The `(x, y)` pairs where `after` differs from `before`.
function changed(before: RgbaImage, after: RgbaImage): string[] {
	const found: string[] = [];
	for (let y = 0; y < before.height; y++) {
		for (let x = 0; x < before.width; x++) {
			if (pixelAt(before, x, y).join(',') !== pixelAt(after, x, y).join(',')) {
				found.push(`${x},${y}`);
			}
		}
	}

	return found;
}

function box(x0: number, x1: number, y0: number, y1: number): string[] {
	const found: string[] = [];
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			found.push(`${x},${y}`);
		}
	}

	return found;
}

describe('imageBlend registration', () => {
	it('is registered for the main thread and workers, unlisted, with the spec schema', async () => {
		const main = effectRegistry.get('imageBlend');
		expect(main?.params).toBe(imageBlendEffect.params);
		expect(runtimeEffectRegistry.get('imageBlend')).toBe(imageBlendEffect);
		expect(main?.unlisted).toBe(true);
		expect(imageBlendEffect.version).toBe(1);
		expect(imageBlendEffect.category).toBe('color');
		expect(defaultParams(imageBlendEffect.params)).toEqual(DEFAULTS);
		const {params} = imageBlendEffect;
		expect(
			params.blendMode.kind === 'enum' &&
				params.blendMode.options.map((option) => option.value),
		).toEqual(MODES);
		expect(
			params.fit.kind === 'enum' &&
				params.fit.options.map((option) => option.value),
		).toEqual(FITS);
	});

	it('renders the same bytes through the lazy main-thread definition', async () => {
		const base = noiseImage(9, 7, 1);
		const sources = new Map([[SHA_A, extra(noiseImage(5, 4, 2))]]);
		const saved = stack(
			instance('imageBlend', {
				params: {...DEFAULTS, image: SHA_A, blendMode: 'screen'},
			}),
		);
		const settings = {...options(base), extraSources: sources};
		const main = await renderStack(base, saved, effectRegistry, settings);
		const worker = await renderStack(
			base,
			saved,
			runtimeEffectRegistry,
			settings,
		);
		expect(main.image.data).toEqual(worker.image.data);
		expect(main.image.data).not.toEqual(base.data);
	});
});

describe('imageBlend blend modes', () => {
	// Each formula against its real-number definition for all 65,536 pairs.
	// 255 is odd, so no product lands on a rounding tie.
	const over255 = (n: number) => Math.round(n / 255);
	const reference: Record<ImageBlendMode, (i: number, f: number) => number> = {
		normal: (_i, f) => f,
		multiply: (i, f) => over255(i * f),
		screen: (i, f) => i + f - over255(i * f),
		overlay: (i, f) =>
			i < 128 ? over255(2 * i * f) : 255 - over255(2 * (255 - i) * (255 - f)),
		lighten: (i, f) => Math.max(i, f),
		darken: (i, f) => Math.min(i, f),
		difference: (i, f) => (i > f ? i - f : f - i),
		exclusion: (i, f) => i + f - over255(2 * i * f),
		add: (i, f) => Math.min(i + f, 255),
		subtract: (i, f) => (i > f ? i - f : 0),
	};

	it.each(MODES)('%s matches its definition on every channel pair', (mode) => {
		const wrong: string[] = [];
		for (let i = 0; i < 256; i++) {
			for (let f = 0; f < 256; f++) {
				const got = BLEND_CHANNEL[mode](i, f);
				if (got !== reference[mode](i, f) || got < 0 || got > 255) {
					wrong.push(`${i},${f} -> ${got}`);
				}
			}
		}

		expect(wrong).toEqual([]);
	});

	// Base (200, 100, 50) under overlay (60, 180, 220), both opaque.
	it.each<[ImageBlendMode, number[]]>([
		['normal', [60, 180, 220]],
		['multiply', [47, 71, 43]],
		['screen', [213, 209, 227]],
		['overlay', [171, 141, 86]],
		['lighten', [200, 180, 220]],
		['darken', [60, 100, 50]],
		['difference', [140, 80, 170]],
		['exclusion', [166, 139, 184]],
		['add', [255, 255, 255]],
		['subtract', [140, 0, 0]],
	])('%s on hand-computed pixels', async (blendMode, expected) => {
		const result = await render(
			image(1, 1, [200, 100, 50, 255]),
			image(1, 1, [60, 180, 220, 255]),
			{blendMode},
		);
		expect(bytes(result)).toEqual([...expected, 255]);
	});

	it('adds without clamping below 255', async () => {
		const result = await render(
			image(1, 1, [10, 20, 30, 255]),
			image(1, 1, [1, 2, 3, 255]),
			{blendMode: 'add'},
		);
		expect(bytes(result)).toEqual([11, 22, 33, 255]);
	});
});

describe('imageBlend alpha', () => {
	const half = image(1, 1, [200, 0, 0, 128]);
	const blue = image(1, 1, [0, 0, 200, 128]);

	it('composites two half-transparent pixels source-over', async () => {
		// EffA = 128, outA = round(48896 / 255) = 192.
		expect(bytes(await render(half, blue))).toEqual([66, 0, 134, 192]);
	});

	it.each(MODES)(
		'leaves the base bytes alone under a transparent overlay (%s)',
		async (blendMode) => {
			const base = image(1, 1, [9, 8, 7, 0]);
			const result = await render(base, image(1, 1, [255, 255, 255, 0]), {
				blendMode,
			});
			expect(bytes(result)).toEqual([9, 8, 7, 0]);
		},
	);

	it.each(MODES)(
		'shows the overlay colour on a transparent base (%s)',
		async (blendMode) => {
			const base = image(1, 1, [255, 255, 255, 0]);
			const opaqueOver = await render(base, image(1, 1, [10, 20, 30, 255]), {
				blendMode,
			});
			expect(bytes(opaqueOver)).toEqual([10, 20, 30, 255]);
			// No dark fringe: the colour is not scaled by the alpha.
			const faintOver = await render(base, image(1, 1, [10, 20, 30, 3]), {
				blendMode,
			});
			expect(bytes(faintOver)).toEqual([10, 20, 30, 3]);
		},
	);

	it('rounds the effective overlay alpha half up', async () => {
		const base = image(1, 1, [0, 0, 0, 0]);
		const full = image(1, 1, [40, 50, 60, 255]);
		const faint = image(1, 1, [40, 50, 60, 1]);
		expect(bytes(await render(base, full, {opacity: 0.5}))).toEqual([
			40, 50, 60, 128,
		]);
		expect(bytes(await render(base, faint, {opacity: 0.5}))).toEqual([
			40, 50, 60, 1,
		]);
		expect(bytes(await render(base, faint, {opacity: 0.49}))).toEqual([
			0, 0, 0, 0,
		]);
	});

	it('returns the base bytes at opacity 0', async () => {
		const base = noiseImage(13, 11, 3);
		const result = await render(base, noiseImage(7, 5, 4), {
			opacity: 0,
			blendMode: 'difference',
		});
		expect(result.data).toEqual(base.data);
	});

	it('weights bilinear taps by alpha, so a transparent colour never bleeds', async () => {
		// One output pixel halfway between opaque red and transparent green.
		const overlay = image(2, 1, [255, 0, 0, 255, 0, 255, 0, 0]);
		const result = await render(image(1, 1, [0, 0, 0, 0]), overlay, {
			fit: 'stretch',
		});
		expect(bytes(result)).toEqual([255, 0, 0, 128]);
	});

	it('matches W3C source-over computed in real numbers', async () => {
		const channel = fc.integer({min: 0, max: 255});
		const rgba = fc.tuple(channel, channel, channel, channel);
		await fc.assert(
			fc.asyncProperty(
				rgba,
				rgba,
				fc.integer({min: 0, max: 100}),
				fc.constantFrom(...MODES),
				async (base, over, percent, blendMode) => {
					const result = await render(image(1, 1, base), image(1, 1, over), {
						opacity: percent / 100,
						blendMode,
					});
					// A tap with alpha 0 samples as (0, 0, 0, 0).
					const sourceAlpha = Math.round((over[3] * percent) / 100) / 255;
					if (sourceAlpha === 0) {
						expect(bytes(result)).toEqual(base);
						return;
					}

					const backAlpha = base[3] / 255;
					const alpha = sourceAlpha + backAlpha * (1 - sourceAlpha);
					expect(result.data[3]).toBe(Math.round(alpha * 255));
					expect(result.data[3]).toBeGreaterThanOrEqual(base[3]);
					for (let c = 0; c < 3; c++) {
						const mixed = BLEND_CHANNEL[blendMode](base[c], over[c]);
						const colour =
							(sourceAlpha * (1 - backAlpha) * over[c] +
								sourceAlpha * backAlpha * mixed +
								(1 - sourceAlpha) * backAlpha * base[c]) /
							alpha;
						expect(Math.abs(result.data[c] - colour)).toBeLessThanOrEqual(
							0.5 + 1e-6,
						);
					}
				},
			),
			{numRuns: 500},
		);
	});
});

describe('imageBlend placement', () => {
	const base = flat(8, 4, [10, 10, 10, 255]);
	const white = flat(2, 2, [255, 255, 255, 255]);

	it.each<[ImageBlendFit, string[]]>([
		['cover', box(0, 7, 0, 3)],
		['contain', box(2, 5, 0, 3)],
		['stretch', box(0, 7, 0, 3)],
		['tile', box(0, 7, 0, 3)],
		['none', box(3, 4, 1, 2)],
	])('%s covers the expected pixels', async (fit, expected) => {
		const result = await render(base, white, {fit});
		expect(changed(base, result)).toEqual(expected);
	});

	it('crops under cover and distorts under stretch', async () => {
		// Black above white. Row 0 of the output samples between them under
		// cover (uy = 0.125) and above the first centre under stretch.
		const overlay = image(
			2,
			2,
			[0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255],
		);
		const cover = await render(base, overlay, {fit: 'cover'});
		const stretch = await render(base, overlay, {fit: 'stretch'});
		expect([0, 1, 2, 3].map((y) => pixelAt(cover, 0, y)[0])).toEqual([
			32, 96, 159, 223,
		]);
		expect([0, 1, 2, 3].map((y) => pixelAt(stretch, 0, y)[0])).toEqual([
			0, 64, 191, 255,
		]);
	});

	it.each(FITS)(
		'%s of an opaque image the size of the base is that image',
		async (fit) => {
			const overlay = opaque(noiseImage(17, 9, 5));
			const result = await render(noiseImage(17, 9, 6), overlay, {fit});
			expect(result.data).toEqual(overlay.data);
		},
	);

	it('repeats the overlay when tiled, wrapping across the edges', async () => {
		const overlay = image(2, 1, [1, 2, 3, 255, 4, 5, 6, 255]);
		const result = await render(flat(6, 1, [0, 0, 0, 255]), overlay, {
			fit: 'tile',
		});
		expect(bytes(result)).toEqual([1, 2, 3].flatMap(() => bytes(overlay)));
		// A quarter-pixel shift reads between the last and first columns.
		const shifted = await render(
			flat(4, 1, [0, 0, 0, 255]),
			image(2, 1, [0, 0, 0, 255, 200, 200, 200, 255]),
			{fit: 'tile', offsetX: 0.13},
		);
		expect(shifted.data[0]).toBeGreaterThan(0);
		expect(shifted.data[0]).toBeLessThan(200);
	});

	it('moves the overlay by a fraction of the base size', async () => {
		const overlay = opaque(noiseImage(2, 2, 7));
		const under = flat(4, 4, [0, 0, 0, 255]);
		const result = await render(under, overlay, {
			fit: 'none',
			offsetX: 0.25,
			offsetY: -0.25,
		});
		expect(changed(under, result)).toEqual(box(2, 3, 0, 1));
		for (let y = 0; y < 2; y++) {
			for (let x = 0; x < 2; x++) {
				expect(pixelAt(result, x + 2, y)).toEqual(pixelAt(overlay, x, y));
			}
		}
	});

	it.each<[number, number]>([
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	])('leaves the base alone when moved out (%d, %d)', async (x, y) => {
		const under = noiseImage(8, 8, 8);
		const result = await render(under, noiseImage(8, 8, 9), {
			offsetX: x,
			offsetY: y,
		});
		expect(result.data).toEqual(under.data);
	});

	it('multiplies the fitted size by scale', async () => {
		const under = flat(8, 8, [0, 0, 0, 255]);
		const result = await render(under, white, {scale: 0.5});
		expect(changed(under, result)).toEqual(box(2, 5, 2, 5));
	});

	it.each<ImageBlendFit>(['none', 'tile'])(
		'sizes %s from the stored image, whatever proxy it is given',
		async (fit) => {
			// An 8x8 source rendered at 4x4, and a 4x4 overlay given at full size
			// and as a 1x1 proxy: both cover the middle 2x2 render pixels.
			const under = flat(4, 4, [0, 0, 0, 255]);
			const settings = {sourceWidth: 8, sourceHeight: 8};
			const params = {fit, offsetX: 0, offsetY: 0};
			const full = await render(
				under,
				extra(flat(4, 4, [255, 255, 255, 255]), 4, 4),
				params,
				settings,
			);
			const proxy = await render(
				under,
				extra(flat(1, 1, [255, 255, 255, 255]), 4, 4),
				params,
				settings,
			);
			expect(proxy.data).toEqual(full.data);
			expect(changed(under, full)).toEqual(
				fit === 'none' ? box(1, 2, 1, 2) : box(0, 3, 0, 3),
			);
		},
	);

	it.each<ImageBlendFit>(['cover', 'contain', 'stretch'])(
		'ignores the stored size under %s',
		async (fit) => {
			const overlay = noiseImage(5, 3, 10);
			const under = noiseImage(9, 7, 11);
			const a = await render(under, extra(overlay, 5, 3), {fit});
			const b = await render(under, extra(overlay, 500, 30), {fit});
			expect(b.data).toEqual(a.data);
		},
	);
});

describe('imageBlend rotation', () => {
	it('turns clockwise at 90 degrees', async () => {
		// A B over C D becomes C A over D B.
		const overlay = image(
			2,
			2,
			[1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255],
		);
		const under = flat(2, 2, [0, 0, 0, 255]);
		const reds = async (rotation: number) => {
			const result = await render(under, overlay, {rotation});
			return [0, 4, 8, 12].map((p) => result.data[p]);
		};

		expect(await reds(0)).toEqual([1, 2, 3, 4]);
		expect(await reds(90)).toEqual([3, 1, 4, 2]);
		expect(await reds(180)).toEqual([4, 3, 2, 1]);
		expect(await reds(270)).toEqual([2, 4, 1, 3]);
	});

	it('agrees with the geometry rotation at every quarter turn and size', async () => {
		const side = fc.integer({min: 1, max: 24});
		await fc.assert(
			fc.asyncProperty(
				side,
				side,
				fc.constantFrom(0 as const, 90 as const, 180 as const, 270 as const),
				fc.integer({min: 0, max: 1_000_000}),
				async (width, height, rotation, seed) => {
					const overlay = opaque(noiseImage(width, height, seed));
					const turned = applyTransform(overlay, {
						rotation,
						flipX: false,
						flipY: false,
						crop: null,
						resize: null,
					});
					const under = flat(turned.width, turned.height, [0, 0, 0, 255]);
					const result = await render(under, overlay, {
						fit: 'none',
						rotation,
					});
					expect(result.data).toEqual(turned.data);
				},
			),
			{numRuns: 200},
		);
	});

	it('uses the direction table and no approximated trigonometry', async () => {
		const under = noiseImage(40, 30, 12);
		const overlay = noiseImage(23, 31, 13);
		const expected = await render(under, overlay, {rotation: 33.3});
		const {cos, sin} = Math;
		const forbidden = () => {
			throw new Error('trigonometry at render time');
		};

		Math.cos = forbidden;
		Math.sin = forbidden;
		try {
			const again = await render(under, overlay, {rotation: 33.3});
			expect(again.data).toEqual(expected.data);
		} finally {
			Math.cos = cos;
			Math.sin = sin;
		}
	});

	it('reads angles in tenths of a degree, modulo 360', async () => {
		const under = noiseImage(40, 30, 14);
		const overlay = noiseImage(23, 31, 15);
		const at = async (rotation: number) =>
			(await render(under, overlay, {rotation})).data;
		expect(await at(405)).toEqual(await at(45));
		expect(await at(-315)).toEqual(await at(45));
		expect(await at(45.04)).toEqual(await at(45));
		expect(await at(45.1)).not.toEqual(await at(45));
	});
});

describe('imageBlend missing source', () => {
	const base = noiseImage(11, 6, 16);

	it.each<[string, string]>([
		['no image', ''],
		['an image that was not supplied', SHA_B],
	])('copies the input with %s', async (_name, sha256) => {
		const result = await render(base, noiseImage(4, 4, 17), {
			image: sha256,
			blendMode: 'difference',
			fit: 'tile',
			rotation: 45,
		});
		expect(result.data).toEqual(base.data);
	});

	it('warns once per instance that names an absent image', async () => {
		const saved = stack(
			instance('imageBlend', {
				id: 'present1',
				params: {...DEFAULTS, image: SHA_A},
			}),
			instance('imageBlend', {
				id: 'absent01',
				params: {...DEFAULTS, image: SHA_B},
			}),
			instance('imageBlend', {id: 'empty001', params: {...DEFAULTS}}),
			instance('imageBlend', {
				id: 'disabled',
				enabled: false,
				params: {...DEFAULTS, image: SHA_B},
			}),
		);
		const overlay = opaque(noiseImage(11, 6, 18));
		const result = await renderStack(base, saved, runtimeEffectRegistry, {
			...options(base),
			extraSources: new Map([[SHA_A, extra(overlay)]]),
		});
		expect(result.warnings).toEqual([
			{instanceId: 'absent01', code: 'missing-source'},
		]);
		expect(result.image.data).toEqual(overlay.data);
	});

	it('warns when no extra sources are passed at all', async () => {
		const saved = stack(
			instance('imageBlend', {
				id: 'absent01',
				params: {...DEFAULTS, image: SHA_A},
				mix: 0.5,
				blend: 'difference',
			}),
		);
		const result = await renderStack(
			base,
			saved,
			effectRegistry,
			options(base),
		);
		expect(result.warnings).toEqual([
			{instanceId: 'absent01', code: 'missing-source'},
		]);
		// The copy still goes through the instance's own mix and blend.
		const expected = await renderStack(
			base,
			stack(instance('imageBlend', {mix: 0.5, blend: 'difference'})),
			effectRegistry,
			options(base),
		);
		expect(result.image.data).toEqual(expected.image.data);
	});

	it('never reuses a cached stage across a missing source', async () => {
		const cache = createStageCache();
		const saved = stack(
			instance('channelShift', {
				params: defaultParams(channelShiftEffect.params),
			}),
			instance('imageBlend', {
				id: 'blend001',
				params: {...DEFAULTS, image: SHA_A},
			}),
			instance('channelShift', {
				params: defaultParams(channelShiftEffect.params),
			}),
		);
		const sources = new Map([[SHA_A, extra(opaque(noiseImage(11, 6, 19)))]]);
		const run = async (extraSources?: ReadonlyMap<string, ExtraSource>) =>
			renderStack(base, saved, runtimeEffectRegistry, {
				...options(base),
				cache,
				extraSources,
			});

		const before = await run();
		// Only the stage before the missing source was stored.
		expect(cache.size).toBe(1);
		const loaded = await run(sources);
		expect(loaded.warnings).toEqual([]);
		expect(loaded.image.data).not.toEqual(before.image.data);
		expect(cache.size).toBe(3);
		const unloaded = await run();
		expect(unloaded.warnings).toEqual([
			{instanceId: 'blend001', code: 'missing-source'},
		]);
		expect(unloaded.image.data).toEqual(before.image.data);
	});
});

describe('imageBlend in a stack', () => {
	it('blends over the earlier effects and feeds the later ones (AC-F26.2)', async () => {
		const base = noiseImage(48, 32, 20);
		const overlay = extra(noiseImage(20, 20, 21));
		const extraSources = new Map([[SHA_A, overlay]]);
		const sort = defaultParams(pixelSortEffect.params);
		const shift = defaultParams(channelShiftEffect.params);
		const blendParams = {...DEFAULTS, image: SHA_A, blendMode: 'overlay'};
		const whole = await renderStack(
			base,
			stack(
				instance('pixelSort', {params: sort}),
				instance('imageBlend', {params: blendParams}),
				instance('channelShift', {params: shift}),
			),
			runtimeEffectRegistry,
			{...options(base), extraSources},
		);

		let step = base;
		for (const [type, params] of [
			['pixelSort', sort],
			['imageBlend', blendParams],
			['channelShift', shift],
		] as const) {
			const result = await renderStack(
				step,
				stack(instance(type, {params})),
				runtimeEffectRegistry,
				{...options(step), extraSources},
			);
			step = result.image;
		}

		expect(whole.image.data).toEqual(step.data);
	});

	it('merges a third image with a second instance', async () => {
		const base = flat(4, 4, [0, 0, 0, 255]);
		const extraSources = new Map([
			[SHA_A, extra(flat(4, 4, [100, 0, 0, 255]))],
			[SHA_B, extra(flat(4, 4, [0, 50, 0, 255]))],
		]);
		const result = await renderStack(
			base,
			stack(
				instance('imageBlend', {
					params: {...DEFAULTS, image: SHA_A, blendMode: 'add'},
				}),
				instance('imageBlend', {
					params: {...DEFAULTS, image: SHA_B, blendMode: 'add'},
				}),
			),
			runtimeEffectRegistry,
			{...options(base), extraSources},
		);
		expect(pixelAt(result.image, 3, 3)).toEqual([100, 50, 0, 255]);
	});

	it('survives a saved-stack round trip and repairs bad values', async () => {
		const base = noiseImage(30, 20, 22);
		const params: ImageBlendParams = {
			image: SHA_A,
			blendMode: 'exclusion',
			opacity: 0.4,
			fit: 'contain',
			scale: 1.5,
			offsetX: 0.1,
			offsetY: -0.2,
			rotation: 12.5,
		};
		const saved = stack(instance('imageBlend', {params}));
		// eslint-disable-next-line unicorn/prefer-structured-clone -- saved projects are JSON
		const loaded = JSON.parse(JSON.stringify(saved)) as typeof saved;
		expect(loaded).toEqual(saved);
		const overlay = noiseImage(16, 12, 23);
		const result = await renderStack(base, loaded, runtimeEffectRegistry, {
			...options(base),
			extraSources: new Map([[SHA_A, extra(overlay)]]),
		});
		expect(result.warnings).toEqual([]);
		expect(result.image.data).toEqual(
			(await render(base, overlay, params)).data,
		);
		expect(
			validateParams(imageBlendEffect.params, {
				image: 'A'.repeat(64),
				blendMode: 'hue',
				opacity: 2,
				scale: 0,
				offsetX: -3,
				rotation: -90,
			}),
		).toEqual({...DEFAULTS, scale: 0.1, offsetX: -1, rotation: 270});
	});
});

describe('imageBlend cancellation', () => {
	it.each<[string, string]>([
		['while blending', SHA_A],
		['while copying a missing source', SHA_B],
	])('checks at least once per 16,384 pixels %s', async (_name, sha256) => {
		const base = createImage(256, 256);
		let calls = 0;
		const ctx = createRenderContext({
			level: 'full',
			sourceWidth: 256,
			sourceHeight: 256,
			renderWidth: 256,
			extraSources: new Map([[SHA_A, extra(noiseImage(8, 8))]]),
			checkpoint() {
				calls++;
				if (calls === 3) {
					throw new Cancelled();
				}
			},
		});
		await expect(
			Promise.resolve(
				imageBlendEffect.render(
					base,
					createImage(256, 256),
					{...DEFAULTS, image: sha256},
					ctx,
				),
			),
		).rejects.toThrow(Cancelled);
		expect(calls).toBe(3);
	});
});

describe('imageBlend properties', () => {
	const side = fc.integer({min: 1, max: 64});
	const hundredths = (min: number, max: number) =>
		fc.integer({min, max}).map((n) => n / 100);
	const arbParams: fc.Arbitrary<Omit<ImageBlendParams, 'image'>> = fc.record({
		blendMode: fc.constantFrom(...MODES),
		opacity: hundredths(0, 100),
		fit: fc.constantFrom(...FITS),
		scale: hundredths(10, 400),
		offsetX: hundredths(-100, 100),
		offsetY: hundredths(-100, 100),
		rotation: fc.integer({min: 0, max: 3599}).map((n) => n / 10),
	});

	it('keeps size, never writes its inputs, is deterministic and never lowers alpha', async () => {
		await fc.assert(
			fc.asyncProperty(
				side,
				side,
				side,
				side,
				fc.double({min: 1, max: 9, noNaN: true}),
				arbParams,
				fc.integer({min: 0, max: 1_000_000}),
				async (width, height, ow, oh, shrink, params, seed) => {
					const base = noiseImage(width, height, seed);
					const overlay = extra(
						noiseImage(ow, oh, seed + 1),
						Math.round(ow * shrink),
						Math.round(oh * shrink),
					);
					const baseBefore = base.data.slice();
					const overlayBefore = overlay.data.slice();
					const settings = {
						sourceWidth: Math.round(width * shrink),
						sourceHeight: Math.round(height * shrink),
					};
					const first = await render(base, overlay, params, settings);
					const second = await render(base, overlay, params, settings);
					expect([first.width, first.height]).toEqual([width, height]);
					expect(second.data).toEqual(first.data);
					expect(base.data).toEqual(baseBefore);
					expect(overlay.data).toEqual(overlayBefore);
					const lowered = first.data.some(
						(value, i) => i % 4 === 3 && value < base.data[i],
					);
					expect(lowered).toBe(false);
				},
			),
			{numRuns: 300},
		);
	});

	// Overlays that are opaque, clear or part-transparent pixel by pixel, over
	// bases that are mostly one of the three, so every shortcut is exercised.
	function patchy(width: number, height: number, seed: number): RgbaImage {
		const output = noiseImage(width, height, seed);
		for (let i = 3; i < output.data.length; i += 4) {
			output.data[i] = [255, 255, 255, 0, output.data[i]][
				output.data[i - 1] % 5
			];
		}

		return output;
	}

	it('matches the section 16.5 formulas written out in full', async () => {
		await fc.assert(
			fc.asyncProperty(
				side,
				side,
				side,
				side,
				fc.oneof(fc.constant(1), fc.double({min: 1, max: 9, noNaN: true})),
				arbParams,
				fc.boolean(),
				fc.integer({min: 0, max: 1_000_000}),
				async (width, height, ow, oh, shrink, params, solid, seed) => {
					const noise = patchy(width, height, seed);
					const base = solid ? opaque(noise) : noise;
					const under = patchy(ow, oh, seed + 1);
					const overlay = extra(
						solid ? opaque(under) : under,
						Math.round(ow * shrink),
						Math.round(oh * shrink),
					);
					const sourceWidth = Math.round(width * shrink);
					const result = await render(base, overlay, params, {
						sourceWidth,
						sourceHeight: Math.round(height * shrink),
					});
					expect(result.data).toEqual(
						modelImageBlend(
							base,
							overlay,
							params,
							sourceWidth,
							BLEND_CHANNEL[params.blendMode],
						).data,
					);
				},
			),
			{numRuns: 400},
		);
	});

	it('never changes a pixel under a fully transparent overlay', async () => {
		await fc.assert(
			fc.asyncProperty(side, side, arbParams, async (width, height, params) => {
				const base = noiseImage(width, height, 24);
				const result = await render(
					base,
					flat(7, 9, [255, 255, 255, 0]),
					params,
				);
				expect(result.data).toEqual(base.data);
			}),
			{numRuns: 200},
		);
	});
});
