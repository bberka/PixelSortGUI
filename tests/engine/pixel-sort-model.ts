/* eslint-disable no-bitwise -- hash bits are split into channels, and line ids are uint32 (engine.md section 5.2) */
import fc from 'fast-check';
import {
	pixelSortEffect,
	renderPixelSort,
	type PixelSortParams,
} from '../../src/engine/effects/pixel-sort/index.ts';
import type {Sorter} from '../../src/engine/effects/pixel-sort/fill.ts';
import {computeKey16, SORT_KEYS} from '../../src/engine/keys.ts';
import {createLinePartition} from '../../src/engine/lines.ts';
import {clamp, floorDiv} from '../../src/engine/math.ts';
import {defaultParams} from '../../src/engine/params.ts';
import {createRenderContext} from '../../src/engine/pipeline.ts';
import {hash32, intIn, unit} from '../../src/engine/random.ts';
import {
	createImage,
	type DebugView,
	type RenderContext,
	type RgbaImage,
} from '../../src/engine/types.ts';

export const defaults = defaultParams(pixelSortEffect.params);

export function withParams(
	overrides: Partial<PixelSortParams> = {},
): PixelSortParams {
	return {...defaults, ...overrides};
}

export type ContextOptions = {
	// Defaults to the image width, so the scale is 1.
	sourceWidth?: number;
	debugView?: DebugView;
	checkpoint?: () => void | Promise<void>;
	progress?: (fraction: number) => void;
};

export function contextFor(
	input: RgbaImage,
	options: ContextOptions = {},
): RenderContext {
	const sourceWidth = options.sourceWidth ?? input.width;
	return createRenderContext({
		level: 'full',
		sourceWidth,
		sourceHeight: Math.round((input.height * sourceWidth) / input.width),
		renderWidth: input.width,
		debugView: options.debugView,
		checkpoint: options.checkpoint,
		progress: options.progress,
	});
}

// Output starts as 0xAB so a byte the effect failed to write shows up.
export async function run(
	input: RgbaImage,
	overrides: Partial<PixelSortParams> = {},
	options: ContextOptions & {sorter?: Sorter} = {},
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	output.data.fill(0xab);
	await renderPixelSort(
		input,
		output,
		withParams(overrides),
		contextFor(input, options),
		options.sorter,
	);
	return output;
}

// A row or grid of opaque greys. Grey `g` has luma key16 `g * 257`.
export function greys(
	width: number,
	height: number,
	values: readonly number[],
): RgbaImage {
	return {
		width,
		height,
		data: new Uint8ClampedArray(values.flatMap((g) => [g, g, g, 255])),
	};
}

export function greyValues(img: RgbaImage): number[] {
	const out: number[] = [];
	for (let p = 0; p < img.data.length; p += 4) {
		out.push(img.data[p]);
	}

	return out;
}

export function rgba(
	width: number,
	height: number,
	pixels: ReadonlyArray<readonly [number, number, number, number]>,
): RgbaImage {
	return {width, height, data: new Uint8ClampedArray(pixels.flat())};
}

export function pixelsOf(img: RgbaImage): number[][] {
	const out: number[][] = [];
	for (let p = 0; p < img.data.length; p += 4) {
		out.push([...img.data.subarray(p, p + 4)]);
	}

	return out;
}

export type ModelInterval = {
	// Pixel indices (`y * width + x`) in line order.
	offsets: number[];
	skipped: boolean;
	descending: boolean;
};

export type Model = {
	selected: Uint8Array;
	lines: number[][];
	intervals: ModelInterval[];
	output: RgbaImage;
	selectionView: RgbaImage;
};

function modelEdgeSelection(
	input: RgbaImage,
	params: PixelSortParams,
	ctx: RenderContext,
): Uint8Array {
	const {width, height, data} = input;
	let map: number[] = [];
	for (let i = 0; i < width * height; i++) {
		map.push(
			floorDiv(
				2126 * data[4 * i] +
					7152 * data[4 * i + 1] +
					722 * data[4 * i + 2] +
					5000,
				10_000,
			),
		);
	}

	const at = (source: number[], x: number, y: number) =>
		source[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
	const r = ctx.px(params.edgeBlur);
	if (r > 0) {
		for (const [dx, dy] of [
			[1, 0],
			[0, 1],
		]) {
			const source = map;
			map = source.map((_, i) => {
				const x = i % width;
				const y = Math.floor(i / width);
				let sum = 0;
				for (let d = -r; d <= r; d++) {
					sum += at(source, x + d * dx, y + d * dy);
				}

				return floorDiv(2 * sum + (2 * r + 1), 2 * (2 * r + 1));
			});
		}
	}

	const t = Math.round(params.edgeThreshold * 1000);
	const selected = new Uint8Array(width * height);
	for (let i = 0; i < width * height; i++) {
		const x = i % width;
		const y = Math.floor(i / width);
		const gx =
			at(map, x + 1, y - 1) +
			2 * at(map, x + 1, y) +
			at(map, x + 1, y + 1) -
			(at(map, x - 1, y - 1) + 2 * at(map, x - 1, y) + at(map, x - 1, y + 1));
		const gy =
			at(map, x - 1, y + 1) +
			2 * at(map, x, y + 1) +
			at(map, x + 1, y + 1) -
			(at(map, x - 1, y - 1) + 2 * at(map, x, y - 1) + at(map, x + 1, y - 1));
		const isEdge = 1_000_000 * (gx * gx + gy * gy) >= (1020 * t) ** 2;
		const wanted = params.invert ? isEdge : !isEdge;
		selected[i] = data[4 * i + 3] !== 0 && wanted ? 1 : 0;
	}

	return selected;
}

/**
 Engine.md section 5 written the slow, obvious way: whole-image selection
 first, `Array.prototype.sort` for order, `unit` and `intIn` from random.ts.
 It shares only the line partition and the key functions with the effect.
 */
export function model(
	input: RgbaImage,
	params: PixelSortParams,
	ctx: RenderContext,
): Model {
	const {width, height, data} = input;
	const count = width * height;
	const key = (name: PixelSortParams['sortKey'], i: number) =>
		computeKey16(name, data[4 * i], data[4 * i + 1], data[4 * i + 2]);

	let selected: Uint8Array;
	if (params.intervalMode === 'edges') {
		selected = modelEdgeSelection(input, params, ctx);
	} else {
		selected = new Uint8Array(count);
		const lo16 = Math.floor(params.threshold[0] * 65_535 + 0.5);
		const hi16 = Math.floor(params.threshold[1] * 65_535 + 0.5);
		for (let i = 0; i < count; i++) {
			if (data[4 * i + 3] === 0) {
				continue;
			}

			if (params.intervalMode === 'whole') {
				selected[i] = 1;
			} else {
				const k = key(params.selectKey, i);
				selected[i] = (lo16 <= k && k <= hi16) === params.invert ? 0 : 1;
			}
		}
	}

	const output = createImage(width, height);
	output.data.set(data);
	const selectionView = createImage(width, height);
	for (let i = 0; i < count; i++) {
		for (let c = 0; c < 3; c++) {
			selectionView.data[4 * i + c] =
				selected[i] === 1 ? data[4 * i + c] : Math.floor(data[4 * i + c] / 4);
		}

		selectionView.data[4 * i + 3] = data[4 * i + 3];
	}

	const partition = createLinePartition(width, height, params.angle, {
		disableFastPath: true,
	});
	const walker = partition.createWalker();
	const buffer = new Int32Array(partition.maxLineLength);
	const lines: number[][] = [];
	const intervals: ModelInterval[] = [];
	const scaledMax = ctx.pxLength(params.maxLength);

	while (walker.next()) {
		const length = walker.fillOffsets(buffer);
		const line = [...buffer.subarray(0, length)];
		lines.push(line);
		const lineId = ctx.toSource(walker.k) >>> 0;
		const sourceAt = (j: number) =>
			ctx.toSource(walker.posStart + walker.posStep * j);

		let j = 0;
		while (j < length) {
			if (selected[line[j]] === 0) {
				j++;
				continue;
			}

			let runEnd = j;
			while (runEnd < length && selected[line[runEnd]] === 1) {
				runEnd++;
			}

			while (j < runEnd) {
				let size = runEnd - j;
				if (params.maxLength !== 0) {
					const u = unit(params.seed, 1, lineId, sourceAt(j));
					const cap = Math.max(
						1,
						Math.floor(scaledMax * (1 + params.lengthJitter * (2 * u - 1))),
					);
					size = Math.min(cap, size);
				}

				const first = sourceAt(j);
				const offsets = line.slice(j, j + size);
				j += size;
				if (size < 2) {
					continue;
				}

				const skipped = unit(params.seed, 2, lineId, first) < params.skipChance;
				const descending =
					params.order === 'descending' ||
					(params.order === 'random' &&
						unit(params.seed, 3, lineId, first) >= 0.5);
				intervals.push({offsets, skipped, descending});
				if (skipped) {
					continue;
				}

				const pixels = offsets.map((offset) => [
					...data.subarray(4 * offset, 4 * offset + 4),
				]);
				let ordered: number[][];
				if (params.order === 'shuffle') {
					ordered = [...pixels];
					for (let s = size - 1; s >= 1; s--) {
						const t = intIn(0, s, params.seed, 4, lineId, first, s);
						[ordered[s], ordered[t]] = [ordered[t], ordered[s]];
					}
				} else {
					const comparison = offsets.map((offset) => {
						let c = key(params.sortKey, offset);
						if (params.discretize > 0) {
							c = Math.floor(c / (params.discretize * 257));
						}

						return descending ? 65_535 - c : c;
					});
					ordered = pixels
						.map((pixel, index) => ({pixel, c: comparison[index]}))
						.toSorted((a, b) => a.c - b.c)
						.map((entry) => entry.pixel);
				}

				for (let s = 0; s < size; s++) {
					for (let c = 0; c < 4; c++) {
						let value: number;
						if (params.fill === 'sort') {
							value = ordered[s][c];
						} else if (params.fill === 'average') {
							let sum = 0;
							for (const pixel of pixels) {
								sum += pixel[c];
							}

							value = floorDiv(2 * sum + size, 2 * size);
						} else {
							value = floorDiv(
								2 *
									(ordered[0][c] * (size - 1 - s) + ordered[size - 1][c] * s) +
									(size - 1),
								2 * (size - 1),
							);
						}

						output.data[4 * offsets[s] + c] = value;
					}
				}
			}
		}
	}

	return {selected, lines, intervals, output, selectionView};
}

export function comparisonKey(
	img: RgbaImage,
	offset: number,
	params: PixelSortParams,
): number {
	const c = computeKey16(
		params.sortKey,
		img.data[4 * offset],
		img.data[4 * offset + 1],
		img.data[4 * offset + 2],
	);
	return params.discretize > 0 ? Math.floor(c / (params.discretize * 257)) : c;
}

export type ImageStyle = 'noise' | 'palette' | 'smooth' | 'flat';

/**
 Seeded test images. `palette` has few colours (many key ties), `smooth` has
 long runs inside any threshold band, `flat` is one colour. About one pixel
 in eight is fully transparent when `holes` is set.
 */
export function makeImage(
	width: number,
	height: number,
	seed: number,
	style: ImageStyle,
	holes: boolean,
): RgbaImage {
	const img = createImage(width, height);
	const {data} = img;
	for (let i = 0; i < width * height; i++) {
		const x = i % width;
		const y = Math.floor(i / width);
		const h = hash32(seed, i);
		let r: number;
		let g: number;
		let b: number;
		switch (style) {
			case 'noise': {
				r = h & 255;
				g = (h >>> 8) & 255;
				b = (h >>> 16) & 255;
				break;
			}

			case 'palette': {
				const entry = hash32(seed, 1000, h % 5);
				r = entry & 255;
				g = (entry >>> 8) & 255;
				b = (entry >>> 16) & 255;
				break;
			}

			case 'smooth': {
				r = clamp(60 + x * 3 + (h & 7), 0, 255);
				g = clamp(90 + y * 2 + ((h >>> 3) & 7), 0, 255);
				b = clamp(200 - x - y + ((h >>> 6) & 7), 0, 255);
				break;
			}

			default: {
				r = seed & 255;
				g = (seed >>> 8) & 255;
				b = (seed >>> 16) & 255;
			}
		}

		data[4 * i] = r;
		data[4 * i + 1] = g;
		data[4 * i + 2] = b;
		data[4 * i + 3] = holes && h >>> 29 === 0 ? 0 : 128 + (h >>> 25);
	}

	return img;
}

// An opaque image in which every pixel has a different key16 for `keyName`.
export function distinctKeyImage(
	width: number,
	height: number,
	seed: number,
	keyName: 'luma' | 'hue',
): RgbaImage {
	const img = createImage(width, height);
	const seen = new Set<number>();
	let attempt = 0;
	for (let i = 0; i < width * height; i++) {
		for (;;) {
			const h = hash32(seed, attempt++);
			const r = h & 255;
			const g = (h >>> 8) & 255;
			const b = (h >>> 16) & 255;
			const k = computeKey16(keyName, r, g, b);
			if (!seen.has(k)) {
				seen.add(k);
				img.data.set([r, g, b, 255], 4 * i);
				break;
			}
		}
	}

	return img;
}

const dimension = fc.oneof(
	fc.integer({min: 1, max: 64}),
	fc.integer({min: 1, max: 9}),
);

export const imageArb: fc.Arbitrary<RgbaImage> = fc
	.record({
		width: dimension,
		height: dimension,
		seed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
		style: fc.constantFrom<ImageStyle>('noise', 'palette', 'smooth', 'flat'),
		holes: fc.boolean(),
	})
	.map(({width, height, seed, style, holes}) =>
		makeImage(width, height, seed, style, holes),
	);

const ratio = (steps: number) =>
	fc.integer({min: 0, max: steps}).map((n) => n / steps);

export const angleArb = fc.oneof(
	fc.constantFrom(0, 30, 45, 90, 135, 180, 225, 270, 315, 333.3),
	fc.integer({min: 0, max: 3599}).map((tenths) => tenths / 10),
);

const keyArb = fc.constantFrom(...SORT_KEYS);

// Random valid parameters, as `validateParams` would store them.
export const paramsArb: fc.Arbitrary<PixelSortParams> = fc.record({
	angle: angleArb,
	intervalMode: fc.constantFrom('threshold', 'edges', 'whole'),
	selectKey: keyArb,
	threshold: fc
		.tuple(ratio(1000), ratio(1000))
		.map(([a, b]): readonly [number, number] => [
			Math.min(a, b),
			Math.max(a, b),
		]),
	edgeThreshold: ratio(100),
	edgeBlur: fc.integer({min: 0, max: 8}),
	invert: fc.boolean(),
	maxLength: fc.oneof(
		fc.constant(0),
		fc.integer({min: 1, max: 40}),
		fc.integer({min: 0, max: 16_384}),
	),
	lengthJitter: fc.oneof(fc.constant(0), ratio(100)),
	skipChance: fc.oneof(fc.constant(0), ratio(100)),
	sortKey: keyArb,
	order: fc.constantFrom('ascending', 'descending', 'shuffle', 'random'),
	discretize: fc.oneof(fc.constant(0), fc.integer({min: 0, max: 64})),
	fill: fc.constantFrom('sort', 'average', 'gradient'),
	seed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
});

// 1 renders at source size; larger values make the image a proxy of a bigger source.
export const sourceFactorArb = fc.constantFrom(1, 1, 2, 3, 2.5);

export function sourceWidthFor(img: RgbaImage, factor: number): number {
	return Math.ceil(img.width * factor);
}
