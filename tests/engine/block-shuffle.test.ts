import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	blockShuffleEffect,
	type BlockShuffleParams,
} from '../../src/engine/effects/block-shuffle.ts';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {runtimeEffectRegistry} from '../../src/engine/effects/runtime.ts';
import {defaultParams, validateParams} from '../../src/engine/params.ts';
import {createRenderContext, renderStack} from '../../src/engine/pipeline.ts';
import {intIn, unit} from '../../src/engine/random.ts';
import {createImage, type RgbaImage} from '../../src/engine/types.ts';
import {getBuiltinPreset} from '../../src/presets/builtin.ts';
import {
	bytes,
	image,
	instance,
	noiseImage,
	options,
	stack,
} from './sample-effects.ts';

const FULL: BlockShuffleParams = {tileSize: 4, amount: 1, seed: 0};

const arbParams: fc.Arbitrary<BlockShuffleParams> = fc.record({
	// Mostly small tiles, so small images get a grid of several tiles.
	tileSize: fc.oneof(
		fc.integer({min: 4, max: 16}),
		fc.integer({min: 4, max: 1024}),
	),
	amount: fc.integer({min: 0, max: 100}).map((n) => n / 100),
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
	params: BlockShuffleParams,
	source: {width: number; height: number} = input,
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	const ctx = createRenderContext({
		level: 'full',
		sourceWidth: source.width,
		sourceHeight: source.height,
		renderWidth: input.width,
	});
	await blockShuffleEffect.render(input, output, params, ctx);
	return output;
}

// The permutation exactly as engine.md section 16.1 words it.
function referenceTiles(count: number, params: BlockShuffleParams): number[] {
	const {amount, seed} = params;
	const tiles = Array.from({length: count}, (_, t) => t);
	for (let t = 0; t < count; t++) {
		if (!(unit(seed, 1, t) < amount)) {
			continue;
		}

		const other = intIn(0, count - 1, seed, 2, t);
		[tiles[t], tiles[other]] = [tiles[other], tiles[t]];
	}

	return tiles;
}

// Reference render, one pixel at a time.
function expected(
	input: RgbaImage,
	params: BlockShuffleParams,
	source: {width: number; height: number} = input,
): number[] {
	const {width, height} = input;
	const size = params.tileSize;
	const scale = width / source.width;
	const cols = Math.floor(source.width / size);
	const rows = Math.floor(source.height / size);
	const tiles = referenceTiles(cols * rows, params);
	const within = (value: number, max: number) =>
		Math.min(max, Math.max(0, value));
	const result: number[] = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const xs = (x + 0.5) / scale;
			const ys = (y + 0.5) / scale;
			const tx = Math.floor(xs / size);
			const ty = Math.floor(ys / size);
			let sx = x;
			let sy = y;
			if (cols * rows >= 2 && tx < cols && ty < rows) {
				const from = tiles[ty * cols + tx];
				const xs2 = xs + ((from % cols) - tx) * size;
				const ys2 = ys + (Math.floor(from / cols) - ty) * size;
				sx = within(Math.floor(xs2 * scale), width - 1);
				sy = within(Math.floor(ys2 * scale), height - 1);
			}

			const read = 4 * (sy * width + sx);
			result.push(...input.data.subarray(read, read + 4));
		}
	}

	return result;
}

describe('blockShuffleEffect', () => {
	it('is registered in both registries with the spec schema and defaults', () => {
		expect(effectRegistry.get('blockShuffle')?.params).toBe(
			blockShuffleEffect.params,
		);
		expect(runtimeEffectRegistry.get('blockShuffle')).toBe(blockShuffleEffect);
		expect(blockShuffleEffect.version).toBe(1);
		expect(blockShuffleEffect.category).toBe('glitch');
		expect(defaultParams(blockShuffleEffect.params)).toEqual({
			tileSize: 64,
			amount: 0.15,
			seed: 0,
		});
	});

	it('swaps two whole tiles and leaves the remainders in place', async () => {
		// 9x5 with 4 px tiles: two full tiles, one column and one row left over.
		const values = Array.from({length: 9 * 5 * 4}, (_, i) => i);
		const src = image(9, 5, values);
		// The first seed that exchanges the two tiles.
		const seed = Array.from({length: 100}, (_, i) => i).find(
			(n) => referenceTiles(2, {...FULL, seed: n})[0] === 1,
		)!;
		const out = await renderDirect(src, {...FULL, seed});

		const swapped: number[] = [];
		for (let y = 0; y < 5; y++) {
			for (let x = 0; x < 9; x++) {
				const from = y < 4 && x < 8 ? (x + 4) % 8 : x;
				swapped.push(
					...values.slice(4 * (y * 9 + from), 4 * (y * 9 + from + 1)),
				);
			}
		}

		expect(bytes(out)).toEqual(swapped);
	});

	it('is the identity with fewer than two full tiles', async () => {
		for (const [width, height] of [
			[7, 4],
			[3, 40],
			[40, 3],
		] as const) {
			const src = noiseImage(width, height, 2);
			expect((await renderDirect(src, FULL)).data).toEqual(src.data);
		}
	});

	it('gives a different result for a different seed', async () => {
		const src = noiseImage(32, 32, 5);
		const first = await renderDirect(src, FULL);
		const second = await renderDirect(src, {...FULL, seed: 8});
		expect(bytes(first)).not.toEqual(bytes(second));
	});

	it('keeps the tile grid in source space on a half-scale render', async () => {
		const src = noiseImage(32, 24, 11);
		const source = {width: 64, height: 48};
		const params = {...FULL, tileSize: 10, seed: 4};
		const out = await renderDirect(src, params, source);
		expect(bytes(out)).toEqual(expected(src, params, source));
		// Not the same picture as laying the grid over the render size.
		expect(bytes(out)).not.toEqual(expected(src, params));
	});

	it('renders both ends of every range on 1x1, 1xN, Nx1 and odd sizes', async () => {
		const sizes = [
			[1, 1],
			[1, 13],
			[13, 1],
			[17, 11],
		] as const;
		const ends: BlockShuffleParams[] = [
			{tileSize: 4, amount: 0, seed: 0},
			{tileSize: 4, amount: 1, seed: 0xff_ff_ff_ff},
			{tileSize: 1024, amount: 1, seed: 1},
		];

		for (const [width, height] of sizes) {
			const src = noiseImage(width, height, width * 31 + height);
			for (const params of ends) {
				const out = await renderDirect(src, params);
				expect(bytes(out)).toEqual(expected(src, params));
			}
		}
	});

	it('moves tiles when the tile-scramble preset runs on a photo-sized image', async () => {
		const src = noiseImage(480, 384, 9);
		const [shuffle] = getBuiltinPreset('builtin:tile-scramble')!.stack
			.instances;
		const result = await renderStack(
			src,
			stack(shuffle),
			effectRegistry,
			options(src),
		);
		expect(result.image.data).not.toEqual(src.data);
	});

	it('matches the per-pixel reference at any source scale (200 runs)', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbImage,
				arbParams,
				fc.integer({min: 1, max: 5}),
				fc.integer({min: 0, max: 4}),
				async (src, params, factor, extra) => {
					const source = {
						width: src.width * factor + extra,
						height: src.height * factor + extra,
					};
					const out = await renderDirect(src, params, source);
					expect(bytes(out)).toEqual(expected(src, params, source));
				},
			),
			{numRuns: 200},
		);
	});

	it('is the identity when amount is 0 (200 runs)', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (src, params) => {
				const out = await renderDirect(src, {...params, amount: 0});
				expect(out.data).toEqual(src.data);
			}),
			{numRuns: 200},
		);
	});

	it('only rearranges whole pixels at full scale (200 runs)', async () => {
		await fc.assert(
			fc.asyncProperty(arbImage, arbParams, async (src, params) => {
				const out = await renderDirect(src, params);
				const pixels = (img: RgbaImage) =>
					Array.from({length: img.width * img.height}, (_, i) =>
						img.data.subarray(i * 4, i * 4 + 4).join(','),
					).toSorted();

				expect(pixels(out)).toEqual(pixels(src));
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
				expect(validateParams(blockShuffleEffect.params, params)).toEqual(
					params,
				);

				const saved = stack(instance('blockShuffle', {params}));
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
					stack(instance('blockShuffle', {params, mix: 0})),
					effectRegistry,
					options(src),
				);
				expect(mixZero.image.data).toEqual(snapshot);
			}),
			{numRuns: 200},
		);
	});
});
