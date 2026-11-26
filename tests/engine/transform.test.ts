import fc from 'fast-check';
import {describe, expect, it, vi} from 'vite-plus/test';
import {boxDownscale} from '../../src/engine/resample.ts';
import {
	applyTransform,
	dragCrop,
	effectiveDimensions,
	IDENTITY_TRANSFORM,
	initialCrop,
	isResizeWithinLimits,
	normalizeCrop,
	orientedDimensions,
	percentSize,
	type CropDrag,
	type CropRect,
	type ResizeFilter,
	type RotationDegrees,
	type Size,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import type {RgbaImage} from '../../src/engine/types.ts';
import {bytes, image, noiseImage} from './sample-effects.ts';
import {idealLanczos, modelBilinear, modelLanczos} from './transform-model.ts';

const FILTERS: ResizeFilter[] = ['lanczos3', 'bilinear', 'nearest'];

function transform(overrides: Partial<SourceTransform>): SourceTransform {
	return {...IDENTITY_TRANSFORM, ...overrides};
}

function resize(
	source: RgbaImage,
	width: number,
	height: number,
	filter: ResizeFilter,
): RgbaImage {
	return applyTransform(source, transform({resize: {width, height, filter}}));
}

// Opaque grey pixels; `greys` reads the red channel back.
function grey(width: number, height: number, values: number[]): RgbaImage {
	return image(
		width,
		height,
		values.flatMap((v) => [v, v, v, 255]),
	);
}

function greys(img: RgbaImage): number[] {
	return bytes(img).filter((_, index) => index % 4 === 0);
}

function flat(width: number, height: number, rgba: number[]): number[] {
	return Array.from({length: width * height}, () => rgba).flat();
}

function opaque(img: RgbaImage): RgbaImage {
	for (let i = 3; i < img.data.length; i += 4) {
		img.data[i] = 255;
	}

	return img;
}

const side = fc.integer({min: 1, max: 24});
const imageArbitrary = fc
	.tuple(side, side, fc.integer({min: 0, max: 1000}))
	.map(([w, h, seed]) => noiseImage(w, h, seed));
const rotationArbitrary = fc.constantFrom<RotationDegrees>(0, 90, 180, 270);

function cropArbitrary({width, height}: Size): fc.Arbitrary<CropRect> {
	return fc.tuple(fc.nat(width - 1), fc.nat(height - 1)).chain(([x, y]) =>
		fc.record({
			x: fc.constant(x),
			y: fc.constant(y),
			width: fc.integer({min: 1, max: width - x}),
			height: fc.integer({min: 1, max: height - y}),
		}),
	);
}

// A source image with a transform that is valid for it.
const caseArbitrary = fc
	.tuple(imageArbitrary, rotationArbitrary, fc.boolean(), fc.boolean())
	.chain(([source, rotation, flipX, flipY]) => {
		const oriented = orientedDimensions(source.width, source.height, rotation);
		return fc.record({
			source: fc.constant(source),
			transform: fc.record({
				rotation: fc.constant(rotation),
				flipX: fc.constant(flipX),
				flipY: fc.constant(flipY),
				crop: fc.option(cropArbitrary(oriented)),
				resize: fc.option(
					fc.record({
						width: side,
						height: side,
						filter: fc.constantFrom(...FILTERS),
					}),
				),
			}),
		});
	});

describe('orientation', () => {
	// 0 1 2
	// 3 4 5
	const source = grey(3, 2, [0, 1, 2, 3, 4, 5]);

	it.each<[Partial<SourceTransform>, number, number[]]>([
		[{}, 3, [0, 1, 2, 3, 4, 5]],
		[{rotation: 90}, 2, [3, 0, 4, 1, 5, 2]],
		[{rotation: 180}, 3, [5, 4, 3, 2, 1, 0]],
		[{rotation: 270}, 2, [2, 5, 1, 4, 0, 3]],
		[{flipX: true}, 3, [2, 1, 0, 5, 4, 3]],
		[{flipY: true}, 3, [3, 4, 5, 0, 1, 2]],
		// Rotation first, then the flip of the rotated image.
		[{rotation: 90, flipX: true}, 2, [0, 3, 1, 4, 2, 5]],
		[{rotation: 90, flipY: true}, 2, [5, 2, 4, 1, 3, 0]],
		[{rotation: 270, flipX: true, flipY: true}, 2, [3, 0, 4, 1, 5, 2]],
	])('maps %o exactly', (overrides, width, expected) => {
		const result = applyTransform(source, transform(overrides));
		expect(result.width).toBe(width);
		expect(greys(result)).toEqual(expected);
	});

	it('returns the original after four 90 degree rotations (AC-F20.2)', () => {
		fc.assert(
			fc.property(imageArbitrary, (original) => {
				let result = original;
				for (let i = 0; i < 4; i++) {
					result = applyTransform(result, transform({rotation: 90}));
				}

				expect(result).toEqual(original);
			}),
			{numRuns: 200},
		);
	});

	it('returns the original after flipping twice (AC-F20.2)', () => {
		fc.assert(
			fc.property(
				imageArbitrary,
				fc.constantFrom<Partial<SourceTransform>>({flipX: true}, {flipY: true}),
				(original, flip) => {
					const once = applyTransform(original, transform(flip));
					expect(applyTransform(once, transform(flip))).toEqual(original);
				},
			),
			{numRuns: 200},
		);
	});

	it('equals repeated single steps for every rotation and flip', () => {
		fc.assert(
			fc.property(
				imageArbitrary,
				rotationArbitrary,
				fc.boolean(),
				fc.boolean(),
				(original, rotation, flipX, flipY) => {
					let expected = original;
					for (let turned = 0; turned < rotation; turned += 90) {
						expected = applyTransform(expected, transform({rotation: 90}));
					}

					if (flipX) {
						expected = applyTransform(expected, transform({flipX}));
					}

					if (flipY) {
						expected = applyTransform(expected, transform({flipY}));
					}

					expect(
						applyTransform(original, transform({rotation, flipX, flipY})),
					).toEqual(expected);
				},
			),
			{numRuns: 200},
		);
	});
});

describe('crop', () => {
	it('extracts the rectangle in oriented coordinates', () => {
		const source = grey(3, 2, [0, 1, 2, 3, 4, 5]);
		// Rotated 90: rows (3 0), (4 1), (5 2).
		const result = applyTransform(
			source,
			transform({rotation: 90, crop: {x: 1, y: 1, width: 1, height: 2}}),
		);
		expect([result.width, result.height]).toEqual([1, 2]);
		expect(greys(result)).toEqual([1, 2]);
	});

	it('equals cutting the rows out of the oriented image', () => {
		fc.assert(
			fc.property(caseArbitrary, ({source, transform: full}) => {
				const oriented = applyTransform(source, {
					...full,
					crop: null,
					resize: null,
				});
				const rect = full.crop ?? {
					x: 0,
					y: 0,
					width: oriented.width,
					height: oriented.height,
				};
				const expected: number[] = [];
				for (let {y} = rect; y < rect.y + rect.height; y++) {
					const start = (y * oriented.width + rect.x) * 4;
					expected.push(
						...oriented.data.subarray(start, start + rect.width * 4),
					);
				}

				const result = applyTransform(source, {...full, resize: null});
				expect(bytes(result)).toEqual(expected);
			}),
			{numRuns: 200},
		);
	});
});

describe('effectiveDimensions', () => {
	it('swaps the sides of a rotated 4000x3000 source (AC-F20.1)', () => {
		expect(effectiveDimensions(4000, 3000, transform({rotation: 90}))).toEqual({
			width: 3000,
			height: 4000,
		});
		expect(effectiveDimensions(4000, 3000, IDENTITY_TRANSFORM)).toEqual({
			width: 4000,
			height: 3000,
		});
	});

	it('agrees with the size and buffer length applyTransform returns', () => {
		fc.assert(
			fc.property(caseArbitrary, ({source, transform: t}) => {
				const size = effectiveDimensions(source.width, source.height, t);
				const result = applyTransform(source, t);
				expect({width: result.width, height: result.height}).toEqual(size);
				expect(result.data).toHaveLength(size.width * size.height * 4);
			}),
			{numRuns: 500},
		);
	});

	it.each<[string, Partial<SourceTransform>]>([
		['rotation 45', {rotation: 45 as RotationDegrees}],
		['negative crop x', {crop: {x: -1, y: 0, width: 2, height: 2}}],
		['fractional crop', {crop: {x: 0, y: 0, width: 1.5, height: 2}}],
		['empty crop', {crop: {x: 0, y: 0, width: 0, height: 2}}],
		['crop past the right edge', {crop: {x: 7, y: 0, width: 2, height: 2}}],
		['crop past the bottom edge', {crop: {x: 0, y: 5, width: 2, height: 2}}],
		[
			'crop that ignores the rotation',
			{rotation: 90, crop: {x: 0, y: 0, width: 8, height: 6}},
		],
		['zero resize', {resize: {width: 0, height: 2, filter: 'nearest'}}],
		['fractional resize', {resize: {width: 2.5, height: 2, filter: 'nearest'}}],
		['too wide', {resize: {width: 16_385, height: 1, filter: 'nearest'}}],
		['over 50 MP', {resize: {width: 10_000, height: 5001, filter: 'nearest'}}],
		[
			'unknown filter',
			{resize: {width: 2, height: 2, filter: 'cubic' as ResizeFilter}},
		],
	])('rejects %s in both functions', (_, overrides) => {
		const t = transform(overrides);
		expect(() => effectiveDimensions(8, 6, t)).toThrow(RangeError);
		expect(() => applyTransform(noiseImage(8, 6), t)).toThrow(RangeError);
	});
});

describe('resize limits', () => {
	it('halves 2000x1000 to 1000x500 (AC-F20.4)', () => {
		expect(percentSize({width: 2000, height: 1000}, 50)).toEqual({
			width: 1000,
			height: 500,
		});
	});

	it('rounds percent sizes half away from zero and never below 1', () => {
		expect(percentSize({width: 5, height: 3}, 50)).toEqual({
			width: 3,
			height: 2,
		});
		expect(percentSize({width: 10, height: 1000}, 1)).toEqual({
			width: 1,
			height: 10,
		});
		expect(percentSize({width: 7, height: 9}, 1000)).toEqual({
			width: 70,
			height: 90,
		});
	});

	it('caps each side at 16,384 and the area at 50 MP', () => {
		const cropped = {width: 2000, height: 1000};
		const allowed = (width: number, height: number) =>
			isResizeWithinLimits(cropped, {width, height});
		expect(allowed(16_384, 1)).toBe(true);
		expect(allowed(20_000, 10_000)).toBe(false);
		expect(allowed(1, 16_385)).toBe(false);
		expect(allowed(10_000, 5000)).toBe(true);
		expect(allowed(10_000, 5001)).toBe(false);
		expect(allowed(NaN, 5)).toBe(false);
	});

	it('lets a crop above 50 MP keep or reduce its pixel count only', () => {
		const cropped = {width: 10_000, height: 8000};
		expect(isResizeWithinLimits(cropped, cropped)).toBe(true);
		expect(isResizeWithinLimits(cropped, {width: 9000, height: 8000})).toBe(
			true,
		);
		expect(isResizeWithinLimits(cropped, {width: 10_000, height: 8001})).toBe(
			false,
		);
	});
});

describe('initialCrop', () => {
	it.each<[Size, number, number, CropRect]>([
		// AC-F20.3
		[
			{width: 4000, height: 3000},
			1,
			1,
			{x: 500, y: 0, width: 3000, height: 3000},
		],
		[
			{width: 4000, height: 3000},
			16,
			9,
			{x: 0, y: 375, width: 4000, height: 2250},
		],
		// Portrait source.
		[
			{width: 3000, height: 4000},
			1,
			1,
			{x: 0, y: 500, width: 3000, height: 3000},
		],
		[
			{width: 3000, height: 4000},
			16,
			9,
			{x: 0, y: 1156, width: 3000, height: 1688},
		],
		// 1000 * 9 / 16 = 562.5 rounds up; the odd margin 437 floors to 218.
		[
			{width: 1000, height: 1000},
			16,
			9,
			{x: 0, y: 218, width: 1000, height: 563},
		],
		[
			{width: 1000, height: 1000},
			9,
			16,
			{x: 218, y: 0, width: 563, height: 1000},
		],
		// 1366 * 9 / 16 = 768.375 rounds down.
		[
			{width: 1366, height: 800},
			16,
			9,
			{x: 0, y: 16, width: 1366, height: 768},
		],
		[{width: 101, height: 50}, 1, 1, {x: 25, y: 0, width: 50, height: 50}],
		[
			{width: 1920, height: 1080},
			16,
			9,
			{x: 0, y: 0, width: 1920, height: 1080},
		],
		// The short side never rounds to 0.
		[{width: 1, height: 1}, 16, 1, {x: 0, y: 0, width: 1, height: 1}],
	])('centres %o at %i:%i', (bounds, a, b, expected) => {
		expect(initialCrop(bounds, {a, b})).toEqual(expected);
	});

	it('fills one side and stays within half a pixel of the ratio', () => {
		const dimension = fc.integer({min: 1, max: 16_384});
		const term = fc.integer({min: 1, max: 32});
		fc.assert(
			fc.property(dimension, dimension, term, term, (width, height, a, b) => {
				const crop = initialCrop({width, height}, {a, b});
				expect(normalizeCrop(crop, {width, height})).toEqual(crop);
				const wide = width * b <= height * a;
				expect(wide ? crop.width : crop.height).toBe(wide ? width : height);
				const exact = wide ? (width * b) / a : (height * a) / b;
				const short = wide ? crop.height : crop.width;
				expect(short === 1 || Math.abs(short - exact) <= 0.5).toBe(true);
			}),
			{numRuns: 500},
		);
	});

	it('rejects a ratio that is not two positive integers', () => {
		const bounds = {width: 4, height: 4};
		expect(() => initialCrop(bounds, {a: 0, b: 1})).toThrow(RangeError);
		expect(() => initialCrop(bounds, {a: 1.5, b: 1})).toThrow(RangeError);
	});
});

describe('dragCrop', () => {
	const bounds = {width: 1000, height: 800};
	const start = {x: 100, y: 200, width: 400, height: 300};
	const ratio = {a: 4, b: 3};
	const drag = (input: CropDrag) => dragCrop(start, input, ratio, bounds);

	it('anchors the opposite corner', () => {
		const axis = 'width';
		expect(drag({handle: 'se', axis, length: 200})).toEqual({
			x: 100,
			y: 200,
			width: 200,
			height: 150,
		});
		expect(drag({handle: 'nw', axis, length: 200})).toEqual({
			x: 300,
			y: 350,
			width: 200,
			height: 150,
		});
		expect(drag({handle: 'ne', axis, length: 200})).toEqual({
			x: 100,
			y: 350,
			width: 200,
			height: 150,
		});
		expect(drag({handle: 'sw', axis, length: 200})).toEqual({
			x: 300,
			y: 200,
			width: 200,
			height: 150,
		});
	});

	it('derives the width when a corner drags the height', () => {
		// 101 * 4 / 3 = 134.67
		expect(drag({handle: 'se', axis: 'height', length: 101})).toEqual({
			x: 100,
			y: 200,
			width: 135,
			height: 101,
		});
	});

	it('anchors the opposite edge and keeps the other axis centred', () => {
		expect(drag({handle: 'e', length: 200})).toEqual({
			x: 100,
			y: 275,
			width: 200,
			height: 150,
		});
		expect(drag({handle: 'w', length: 200})).toEqual({
			x: 300,
			y: 275,
			width: 200,
			height: 150,
		});
		// Width 200 centred on x = 300.
		expect(drag({handle: 's', length: 150})).toEqual({
			x: 200,
			y: 200,
			width: 200,
			height: 150,
		});
		expect(drag({handle: 'n', length: 150})).toEqual({
			x: 200,
			y: 350,
			width: 200,
			height: 150,
		});
	});

	it('ignores a named axis on an edge handle', () => {
		const stray = {handle: 'e' as const, axis: 'height', length: 200};
		expect(drag(stray)).toEqual(drag({handle: 'e', length: 200}));
	});

	it('shifts a centred axis to stay inside the image', () => {
		// Height 675 centred on y = 350 starts at floor(12.5).
		expect(drag({handle: 'e', length: 900})).toEqual({
			x: 100,
			y: 12,
			width: 900,
			height: 675,
		});
		// Height 300 centred on y = 750 would end below the image.
		expect(
			dragCrop(
				{x: 0, y: 700, width: 100, height: 100},
				{handle: 'e', length: 400},
				ratio,
				bounds,
			),
		).toEqual({x: 0, y: 500, width: 400, height: 300});
	});

	it('shrinks the dragged axis when the paired axis runs out of room', () => {
		// Room below y = 200 is 600, so the width stops at 800 of the 900 available.
		expect(drag({handle: 'se', axis: 'width', length: 5000})).toEqual({
			x: 100,
			y: 200,
			width: 800,
			height: 600,
		});
		// Room above y = 500 is 500; 500 * 4 / 3 = 666.67.
		expect(drag({handle: 'ne', axis: 'width', length: 5000})).toEqual({
			x: 100,
			y: 0,
			width: 667,
			height: 500,
		});
	});

	it('stays at least 1x1 when dragged past the anchor', () => {
		expect(drag({handle: 'se', axis: 'width', length: -40})).toEqual({
			x: 100,
			y: 200,
			width: 1,
			height: 1,
		});
		expect(
			dragCrop(start, {handle: 'e', length: 1}, {a: 100, b: 1}, bounds),
		).toEqual({x: 100, y: 349, width: 1, height: 1});
	});

	it('rejects a length that is not finite', () => {
		expect(() => drag({handle: 'e', length: NaN})).toThrow(RangeError);
	});

	it('stays inside, keeps its anchors and keeps the ratio', () => {
		const caseOf = fc
			.record({
				width: fc.integer({min: 1, max: 500}),
				height: fc.integer({min: 1, max: 500}),
			})
			.chain((size) =>
				fc.record({
					size: fc.constant(size),
					from: cropArbitrary(size),
					handle: fc.constantFrom('n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'),
					axis: fc.constantFrom('width' as const, 'height' as const),
					length: fc.double({min: -100, max: 1000, noNaN: true}),
					a: fc.integer({min: 1, max: 20}),
					b: fc.integer({min: 1, max: 20}),
				}),
			);
		fc.assert(
			fc.property(caseOf, ({size, from, handle, axis, length, a, b}) => {
				const result = dragCrop(from, {handle, axis, length}, {a, b}, size);
				expect(normalizeCrop(result, size)).toEqual(result);
				if (handle.includes('w')) {
					expect(result.x + result.width).toBe(from.x + from.width);
				}

				if (handle.includes('e')) {
					expect(result.x).toBe(from.x);
				}

				if (handle.includes('n')) {
					expect(result.y + result.height).toBe(from.y + from.height);
				}

				if (handle.includes('s')) {
					expect(result.y).toBe(from.y);
				}

				// One side is the exact ratio of the other, rounded, unless it is 1.
				const error = Math.abs(result.width * b - result.height * a);
				expect(
					result.width === 1 ||
						result.height === 1 ||
						error <= Math.max(a, b) / 2,
				).toBe(true);
			}),
			{numRuns: 1000},
		);
	});
});

describe('normalizeCrop', () => {
	const bounds = {width: 100, height: 50};

	it('rounds half away from zero, then clamps size before position', () => {
		expect(
			normalizeCrop({x: 2.5, y: 3.4, width: 10.5, height: 9.4}, bounds),
		).toEqual({x: 3, y: 3, width: 11, height: 9});
		expect(
			normalizeCrop({x: 90, y: -8, width: 40, height: 400}, bounds),
		).toEqual({x: 60, y: 0, width: 40, height: 50});
		expect(
			normalizeCrop({x: -0.2, y: 49.6, width: 0, height: -3}, bounds),
		).toEqual({x: 0, y: 49, width: 1, height: 1});
	});

	it('rejects a field that is not finite', () => {
		expect(() =>
			normalizeCrop({x: NaN, y: 0, width: 1, height: 1}, bounds),
		).toThrow(RangeError);
	});
});

describe('resampling', () => {
	it('never writes the source and never returns its buffer', () => {
		fc.assert(
			fc.property(caseArbitrary, ({source, transform: t}) => {
				const before = bytes(source);
				const result = applyTransform(source, t);
				expect(bytes(source)).toEqual(before);
				expect(result.data.buffer).not.toBe(source.data.buffer);
			}),
			{numRuns: 200},
		);
	});

	it.each(FILTERS)(
		'%s copies every channel when the size does not change',
		(filter) => {
			const source = image(2, 1, [10, 20, 30, 0, 40, 50, 60, 7]);
			expect(resize(source, 2, 1, filter)).toEqual(source);
		},
	);

	it.each(FILTERS)('%s keeps a flat image flat at any size', (filter) => {
		fc.assert(
			fc.property(
				fc.tuple(side, side, side, side),
				fc.tuple(
					fc.nat(255),
					fc.nat(255),
					fc.nat(255),
					fc.integer({min: 1, max: 255}),
				),
				([sw, sh, dw, dh], rgba) => {
					const source = image(sw, sh, flat(sw, sh, rgba));
					expect(bytes(resize(source, dw, dh, filter))).toEqual(
						flat(dw, dh, rgba),
					);
				},
			),
			{numRuns: 200},
		);
	});

	it.each(FILTERS)('%s stays exact over a 16,384 px axis', (filter) => {
		const rgba = [255, 1, 128, 255];
		const long = image(16_384, 1, flat(16_384, 1, rgba));
		expect(bytes(resize(long, 1, 1, filter))).toEqual(rgba);
		expect(bytes(resize(image(1, 1, rgba), 16_384, 1, filter))).toEqual(
			bytes(long),
		);
	});

	it.each<ResizeFilter>(['lanczos3', 'bilinear'])(
		'%s takes no colour from transparent pixels',
		(filter) => {
			const source = image(2, 1, [200, 0, 0, 255, 0, 255, 0, 0]);
			for (const width of [1, 7]) {
				const result = bytes(resize(source, width, 1, filter));
				for (let o = 0; o < result.length; o += 4) {
					if (result[o + 3] === 0) {
						expect(result.slice(o, o + 3)).toEqual([0, 0, 0]);
					} else {
						expect(result.slice(o, o + 3)).toEqual([200, 0, 0]);
					}
				}
			}
		},
	);
});

describe('nearest', () => {
	it('picks the source pixel under each destination centre', () => {
		const source = grey(2, 1, [10, 20]);
		expect(greys(resize(source, 5, 1, 'nearest'))).toEqual([
			10, 10, 20, 20, 20,
		]);
		const five = grey(5, 1, [1, 2, 3, 4, 5]);
		expect(greys(resize(five, 2, 1, 'nearest'))).toEqual([2, 4]);
	});

	it('copies all four channels, even of transparent pixels', () => {
		const source = image(1, 1, [9, 8, 7, 0]);
		expect(bytes(resize(source, 2, 2, 'nearest'))).toEqual(
			flat(2, 2, [9, 8, 7, 0]),
		);
	});

	it('matches the formula of the spec for random sizes', () => {
		fc.assert(
			fc.property(imageArbitrary, side, side, (source, width, height) => {
				const at = (d: number, from: number, to: number) =>
					Math.min(from - 1, Math.floor(((d + 0.5) * from) / to));
				const expected: number[] = [];
				for (let y = 0; y < height; y++) {
					for (let x = 0; x < width; x++) {
						const p =
							(at(y, source.height, height) * source.width +
								at(x, source.width, width)) *
							4;
						expected.push(...source.data.subarray(p, p + 4));
					}
				}

				expect(bytes(resize(source, width, height, 'nearest'))).toEqual(
					expected,
				);
			}),
			{numRuns: 200},
		);
	});
});

describe('bilinear', () => {
	it('interpolates between pixel centres and holds the edges', () => {
		// Centres at -0.25, 0.25, 0.75 and 1.25.
		expect(greys(resize(grey(2, 1, [0, 100]), 4, 1, 'bilinear'))).toEqual([
			0, 25, 75, 100,
		]);
	});

	it('weights colour by alpha', () => {
		const source = image(2, 1, [255, 0, 0, 100, 0, 255, 0, 200]);
		// Pixel 1 of 4 mixes 3:1: alpha 125, red 255*300/500, green 255*200/500.
		expect(bytes(resize(source, 4, 1, 'bilinear')).slice(4, 8)).toEqual([
			153, 102, 0, 125,
		]);
	});

	it('is the box downscale when neither axis grows', () => {
		fc.assert(
			fc.property(imageArbitrary, side, side, (source, a, b) => {
				const width = Math.min(a, source.width);
				const height = Math.min(b, source.height);
				expect(resize(source, width, height, 'bilinear')).toEqual(
					boxDownscale(source, width, height),
				);
			}),
			{numRuns: 200},
		);
	});

	it('matches an exact model when an axis grows', () => {
		fc.assert(
			fc.property(imageArbitrary, side, side, (source, width, height) => {
				fc.pre(width > source.width || height > source.height);
				expect(bytes(resize(source, width, height, 'bilinear'))).toEqual(
					modelBilinear(source, width, height),
				);
			}),
			{numRuns: 200},
		);
	});
});

describe('lanczos3', () => {
	it('overshoots a hard edge and clamps to 0..255', () => {
		const result = greys(
			resize(grey(6, 1, [0, 0, 0, 255, 255, 255]), 12, 1, 'lanczos3'),
		);
		// The same values come out of table-free Lanczos-3 in doubles.
		expect(result).toEqual([0, 2, 7, 0, 0, 54, 201, 255, 255, 248, 253, 255]);
	});

	it('matches an exact model of the spec for random sizes', () => {
		fc.assert(
			fc.property(imageArbitrary, side, side, (source, width, height) => {
				fc.pre(width !== source.width || height !== source.height);
				expect(bytes(resize(source, width, height, 'lanczos3'))).toEqual(
					modelLanczos(source, width, height),
				);
			}),
			{numRuns: 200},
		);
	});

	it('stays within 1 level of table-free Lanczos-3 on opaque images', () => {
		const small = fc.integer({min: 1, max: 12});
		fc.assert(
			fc.property(
				fc.tuple(small, small, small, small),
				fc.nat(1000),
				([sw, sh, dw, dh], seed) => {
					const source = opaque(noiseImage(sw, sh, seed));
					const result = bytes(resize(source, dw, dh, 'lanczos3'));
					const ideal = idealLanczos(source, dw, dh);
					for (const [i, value] of result.entries()) {
						expect(Math.abs(value - ideal[i])).toBeLessThanOrEqual(1);
					}
				},
			),
			{numRuns: 200},
		);
	});
});

// Bytes of every typed array `run` allocates, which is an upper bound on its peak.
function allocatedBytes(run: () => void): number {
	let total = 0;
	const counted = <T extends Int32ArrayConstructor | Float64ArrayConstructor>(
		Type: T,
	): T =>
		new Proxy(Type, {
			construct(Target, args: [number]) {
				const array = new Target(...args);
				total += array.byteLength;
				return array;
			},
		});
	vi.stubGlobal('Int32Array', counted(Int32Array));
	vi.stubGlobal('Float64Array', counted(Float64Array));
	try {
		run();
	} finally {
		vi.unstubAllGlobals();
	}

	return total;
}

describe('lanczos3 working memory', () => {
	// Engine.md section 16.3.
	const LIMIT = 8 * 1024 * 1024;

	// The widest output from the tallest source: a ring of every source row
	// under one window would take 4 GiB here. A 1 px wide source keeps it fast.
	it('stays under 8 MiB when 16,384 rows shrink onto a 16,384 px wide row', () => {
		const rgba = [255, 1, 128, 255];
		const source = image(1, 16_384, flat(1, 16_384, rgba));
		let result: RgbaImage | undefined;
		const used = allocatedBytes(() => {
			result = resize(source, 16_384, 1, 'lanczos3');
		});
		// Two sum rows of 16,384 * 4 doubles prove the counter saw the resize.
		expect(used).toBeGreaterThan(16_384 * 4 * 8);
		expect(used).toBeLessThan(LIMIT);
		expect(bytes(result!)).toEqual(flat(16_384, 1, rgba));
	}, 60_000);

	// Shrinking to 4 rows keeps several windows open at once.
	it.each([
		['shrinking', 64, 63],
		['shrinking to few rows', 64, 4],
		['growing', 3, 8],
		['keeping', 8, 8],
	])('stays under 8 MiB at the widest output, height %s', (_, from, to) => {
		const used = allocatedBytes(() => {
			resize(
				image(2, from, flat(2, from, [9, 9, 9, 255])),
				16_384,
				to,
				'lanczos3',
			);
		});
		expect(used).toBeLessThan(LIMIT);
	});
});
