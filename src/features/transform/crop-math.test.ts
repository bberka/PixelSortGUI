import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	orientedDimensions,
	type SourceTransform,
} from '../../engine/transform.ts';
import {createImage, type RgbaImage} from '../../engine/types.ts';
import {ASPECT_IDS} from '../../state/geometry.ts';
import {
	aspectRatio,
	cropTransform,
	moveCrop,
	orientTransform,
	resizeCrop,
	turnAspect,
	CROP_HANDLES,
	type Orientation,
} from './crop-math.ts';

const SOURCE = {width: 7, height: 5};
const STEPS: readonly Orientation[] = ['cw', 'ccw', 'flipH', 'flipV'];

// Every pixel is different, so any wrong mapping shows.
function numbered(width: number, height: number): RgbaImage {
	const image = createImage(width, height);
	for (let index = 0; index < width * height; index++) {
		image.data.set([index, Math.floor(index / 256), 7, 255], index * 4);
	}

	return image;
}

const rotationArbitrary = fc.constantFrom(0, 90, 180, 270) as fc.Arbitrary<
	SourceTransform['rotation']
>;

const transformArbitrary = fc
	.record({
		rotation: rotationArbitrary,
		flipX: fc.boolean(),
		flipY: fc.boolean(),
		box: fc.option(fc.tuple(fc.nat(99), fc.nat(99), fc.nat(99), fc.nat(99)), {
			nil: null,
		}),
	})
	.map(({box, ...orientation}): SourceTransform => {
		const bounds = orientedDimensions(
			SOURCE.width,
			SOURCE.height,
			orientation.rotation,
		);
		if (!box) {
			return {...orientation, crop: null, resize: null};
		}

		const x = box[0] % bounds.width;
		const y = box[1] % bounds.height;
		return {
			...orientation,
			crop: {
				x,
				y,
				width: 1 + (box[2] % (bounds.width - x)),
				height: 1 + (box[3] % (bounds.height - y)),
			},
			resize: null,
		};
	});

describe('orientTransform', () => {
	it('turns exactly the pixels that are on screen, for any geometry', () => {
		const source = numbered(SOURCE.width, SOURCE.height);
		fc.assert(
			fc.property(
				transformArbitrary,
				fc.constantFrom(...STEPS),
				(transform, step) => {
					const seen = applyTransform(source, transform);
					const expected = applyTransform(
						seen,
						orientTransform(seen, IDENTITY_TRANSFORM, step),
					);
					const actual = applyTransform(
						source,
						orientTransform(SOURCE, transform, step),
					);
					expect(actual).toEqual(expected);
				},
			),
		);
	});

	it('turns clockwise as seen: the left column becomes the top row', () => {
		const source = numbered(2, 2);
		const turned = applyTransform(
			source,
			orientTransform(source, IDENTITY_TRANSFORM, 'cw'),
		);
		expect([0, 1, 2, 3].map((index) => turned.data[index * 4])).toEqual([
			2, 0, 3, 1,
		]);
	});

	it('exchanges the sides of a resize on a quarter turn only', () => {
		const transform: SourceTransform = {
			...IDENTITY_TRANSFORM,
			resize: {width: 30, height: 10, filter: 'nearest'},
		};
		expect(orientTransform(SOURCE, transform, 'ccw').resize).toEqual({
			width: 10,
			height: 30,
			filter: 'nearest',
		});
		expect(orientTransform(SOURCE, transform, 'flipV').resize).toEqual(
			transform.resize,
		);
	});
});

describe('cropTransform', () => {
	const bounds = {width: 100, height: 80};
	const resize = {width: 20, height: 20, filter: 'lanczos3'} as const;
	const transform: SourceTransform = {
		...IDENTITY_TRANSFORM,
		crop: {x: 0, y: 0, width: 40, height: 40},
		resize,
	};

	it('keeps the resize for a box of the same size and drops it otherwise', () => {
		expect(
			cropTransform(transform, {x: 10, y: 5, width: 40, height: 40}, bounds)
				.resize,
		).toEqual(resize);
		expect(
			cropTransform(transform, {x: 0, y: 0, width: 41, height: 40}, bounds)
				.resize,
		).toBeNull();
	});

	it('stores a box over the whole image as no crop', () => {
		expect(
			cropTransform(transform, {x: 0, y: 0, ...bounds}, bounds).crop,
		).toBeNull();
	});
});

describe('crop box edits', () => {
	const bounds = {width: 100, height: 80};
	const start = {x: 10, y: 10, width: 40, height: 20};

	it('moves inside the image', () => {
		expect(moveCrop(start, -50, 500, bounds)).toEqual({...start, x: 0, y: 60});
		expect(moveCrop(start, 1.4, 1.6, bounds)).toEqual({...start, x: 11, y: 12});
	});

	it('resizes only the sides the handle owns and never inverts the box', () => {
		expect(resizeCrop(start, 'w', {dx: 500, dy: 7}, null, bounds)).toEqual({
			x: 49,
			y: 10,
			width: 1,
			height: 20,
		});
		expect(resizeCrop(start, 'se', {dx: 500, dy: -500}, null, bounds)).toEqual({
			x: 10,
			y: 10,
			width: 90,
			height: 1,
		});
		expect(resizeCrop(start, 'n', {dx: 5, dy: 0}, null, bounds)).toBe(start);
	});

	it('follows the axis that moved further on a locked corner', () => {
		const ratio = {a: 2, b: 1};
		expect(resizeCrop(start, 'se', {dx: 10, dy: 0}, ratio, bounds)).toEqual({
			x: 10,
			y: 10,
			width: 50,
			height: 25,
		});
		expect(resizeCrop(start, 'se', {dx: 0, dy: 10}, ratio, bounds)).toEqual({
			x: 10,
			y: 10,
			width: 60,
			height: 30,
		});
	});

	it('stays inside the image for any handle, movement and ratio', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...CROP_HANDLES),
				fc.constantFrom(...ASPECT_IDS),
				fc.integer({min: -300, max: 300}),
				fc.integer({min: -300, max: 300}),
				(handle, id, dx, dy) => {
					const box = resizeCrop(
						start,
						handle,
						{dx, dy},
						aspectRatio(id, bounds),
						bounds,
					);
					expect(box.x).toBeGreaterThanOrEqual(0);
					expect(box.y).toBeGreaterThanOrEqual(0);
					expect(box.width).toBeGreaterThanOrEqual(1);
					expect(box.height).toBeGreaterThanOrEqual(1);
					expect(box.x + box.width).toBeLessThanOrEqual(bounds.width);
					expect(box.y + box.height).toBeLessThanOrEqual(bounds.height);
				},
			),
		);
	});

	it('turns a ratio with the image', () => {
		expect(turnAspect('16:9', 'cw')).toBe('9:16');
		expect(turnAspect('2:3', 'ccw')).toBe('3:2');
		expect(turnAspect('4:5', 'cw')).toBe('free');
		expect(turnAspect('4:3', 'flipH')).toBe('4:3');
	});
});
