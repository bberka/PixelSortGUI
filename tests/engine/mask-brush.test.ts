import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {renderSizeForPixelCap} from '../../src/codec/decode.ts';
import type {
	BrushSample,
	BrushStroke,
	MaskBitmap,
	MaskGeometry,
} from '../../src/engine/mask/brush-types.ts';
import {
	applyStroke,
	clearMask,
	createMask,
	fillMask,
	paintStroke,
	placeDabs,
	stampDab,
} from '../../src/engine/mask/brush.ts';
import {
	brushSample,
	effectiveToMask,
	MASK_PIXEL_CAP,
	maskGridSize,
	maskToEffective,
	pressureFactor,
} from '../../src/engine/mask/coords.ts';
import {
	applyTransform,
	IDENTITY_TRANSFORM,
	orientedDimensions,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import {createImage} from '../../src/engine/types.ts';

const SOURCE = {width: 13, height: 7};

// Every rotation, flip, crop and resize combination.
const COMBINATIONS: Array<{name: string; transform: SourceTransform}> = [];
for (const rotation of [0, 90, 180, 270] as const) {
	// Four bits: both flips, a crop and a resize.
	for (let bits = 0; bits < 16; bits++) {
		const [flipX, flipY, cropped, resized] = [1, 2, 4, 8].map(
			(bit) => Math.floor(bits / bit) % 2 === 1,
		);
		COMBINATIONS.push({
			name: `rotate ${rotation}, flipX ${flipX}, flipY ${flipY}, crop ${cropped}, resize ${resized}`,
			transform: {
				rotation,
				flipX,
				flipY,
				crop: cropped ? {x: 1, y: 2, width: 5, height: 4} : null,
				resize: resized ? {width: 17, height: 3, filter: 'nearest'} : null,
			},
		});
	}
}

function geometry(
	transform: Partial<SourceTransform> = {},
	{width, height} = SOURCE,
): MaskGeometry {
	return {
		sourceWidth: width,
		sourceHeight: height,
		transform: {...IDENTITY_TRANSFORM, ...transform},
	};
}

describe('maskGridSize', () => {
	it('keeps a source within the cap and shrinks a larger one', () => {
		expect(maskGridSize(2048, 2048)).toEqual({width: 2048, height: 2048});
		expect(maskGridSize(4000, 3000)).toEqual({width: 2364, height: 1773});
	});

	it('is the pixel-capped render size of the source', () => {
		const side = fc.integer({min: 1, max: 16_384});
		fc.assert(
			fc.property(side, side, (w, h) => {
				const {width, height} = renderSizeForPixelCap(w, h, MASK_PIXEL_CAP);
				expect(maskGridSize(w, h)).toEqual({width, height});
				expect(width * height).toBeLessThanOrEqual(MASK_PIXEL_CAP);
			}),
		);
	});
});

describe('mask coordinates', () => {
	it.each(COMBINATIONS)('round trips both ways: $name', ({transform}) => {
		// A 12 MP source, so the grid is smaller than the source too.
		for (const source of [SOURCE, {width: 4000, height: 3000}]) {
			const g = geometry(transform, source);
			for (const point of [
				{x: 0, y: 0},
				{x: 2.25, y: 1.5},
				{x: -3, y: 40},
			]) {
				const there = maskToEffective(g, effectiveToMask(g, point));
				expect(there.x).toBeCloseTo(point.x, 8);
				expect(there.y).toBeCloseTo(point.y, 8);
				const back = effectiveToMask(g, maskToEffective(g, point));
				expect(back.x).toBeCloseTo(point.x, 8);
				expect(back.y).toBeCloseTo(point.y, 8);
			}
		}
	});

	it.each(COMBINATIONS)(
		'points at the pixel applyTransform shows: $name',
		({transform}) => {
			const source = createImage(SOURCE.width, SOURCE.height);
			for (let i = 0; i < SOURCE.width * SOURCE.height; i++) {
				source.data.set([i, 0, 0, 255], i * 4);
			}

			const oriented = orientedDimensions(
				SOURCE.width,
				SOURCE.height,
				transform.rotation,
			);
			const crop = transform.crop ?? {x: 0, y: 0, ...oriented};
			const shown = applyTransform(source, {...transform, resize: null});
			const effective = transform.resize ?? crop;
			const g = geometry(transform);
			for (let v = 0; v < crop.height; v++) {
				for (let u = 0; u < crop.width; u++) {
					// The centre of cropped pixel (u, v), in effective pixels.
					const mask = effectiveToMask(g, {
						x: ((u + 0.5) * effective.width) / crop.width,
						y: ((v + 0.5) * effective.height) / crop.height,
					});
					expect(mask.x % 1).toBeCloseTo(0.5, 8);
					expect(mask.y % 1).toBeCloseTo(0.5, 8);
					const index = Math.floor(mask.y) * SOURCE.width + Math.floor(mask.x);
					expect(index).toBe(shown.data[(v * crop.width + u) * 4]);
				}
			}
		},
	);

	it('rejects a transform the geometry engine rejects', () => {
		const g = geometry({crop: {x: 0, y: 0, width: 99, height: 1}});
		expect(() => effectiveToMask(g, {x: 0, y: 0})).toThrow(RangeError);
	});
});

describe('brushSample', () => {
	it('stores the centre and radius in sixteenths of a mask pixel', () => {
		const g = geometry({}, {width: 4096, height: 4096});
		expect(brushSample(g, {x: 101, y: 50.1}, 40)).toEqual({
			x: 808,
			y: 401,
			rx: 160,
			ry: 160,
		});
		expect(brushSample(g, {x: 0, y: 0}, 40, 0.2)).toMatchObject({
			rx: 32,
			ry: 32,
		});
	});

	it('gives an elliptical dab under an unlocked resize', () => {
		const transform: Partial<SourceTransform> = {
			crop: {x: 0, y: 0, width: 40, height: 80},
			resize: {width: 80, height: 20, filter: 'nearest'},
		};
		const size = {width: 100, height: 100};
		// Radius 10: half of it across, four times it down.
		expect(
			brushSample(geometry(transform, size), {x: 0, y: 0}, 20),
		).toMatchObject({rx: 80, ry: 640});
		for (const rotation of [90, 270] as const) {
			const rotated = geometry({...transform, rotation}, size);
			expect(brushSample(rotated, {x: 0, y: 0}, 20)).toMatchObject({
				rx: 640,
				ry: 80,
			});
		}
	});

	it('never stores a radius below 8', () => {
		const g = geometry({}, {width: 16_000, height: 3000});
		expect(brushSample(g, {x: 0, y: 0}, 1, 0.2)).toMatchObject({
			rx: 8,
			ry: 8,
		});
	});

	it('rounds halves away from zero and never stores -0', () => {
		const g = geometry();
		expect(brushSample(g, {x: -1 / 32, y: -1 / 64}, 2)).toMatchObject({
			x: -1,
			y: 0,
		});
		expect(Object.is(brushSample(g, {x: 0, y: -0.01}, 2).y, 0)).toBe(true);
	});

	it('scales by pen pressure only when the setting is on', () => {
		expect(pressureFactor('pen', 0, true)).toBe(0.2);
		expect(pressureFactor('pen', 0.5, true)).toBeCloseTo(0.6, 12);
		expect(pressureFactor('pen', 2, true)).toBe(1);
		expect(pressureFactor('pen', 0.5, false)).toBe(1);
		expect(pressureFactor('mouse', 0.5, true)).toBe(1);
		expect(pressureFactor('touch', 0.5, true)).toBe(1);
	});
});

function sample(x: number, y: number, r: number): BrushSample {
	return {x, y, rx: r, ry: r};
}

describe('placeDabs', () => {
	it('stamps one dab for the first sample', () => {
		const first = sample(3, 4, 16);
		expect(placeDabs(undefined, first)).toEqual([first]);
	});

	it('spaces dabs by a quarter of the smaller radius, at least 1 px', () => {
		const dabs = placeDabs(sample(0, 0, 128), sample(100, 0, 64));
		// Spacing max(16, 64 / 4) = 16, so ceil(100 / 16) = 7 dabs.
		expect(dabs.map((dab) => dab.x)).toEqual([14, 29, 43, 57, 71, 86, 100]);
		expect(dabs.map((dab) => dab.rx)).toEqual([119, 110, 101, 91, 82, 73, 64]);
		// Spacing 400 / 4 = 100 across, so one dab.
		expect(placeDabs(sample(0, 0, 400), sample(100, -100, 400))).toHaveLength(
			1,
		);
		// The longer axis decides the count.
		expect(placeDabs(sample(0, 0, 400), sample(100, -301, 400))).toHaveLength(
			4,
		);
	});

	it('rounds halves away from zero', () => {
		const dabs = placeDabs(sample(0, 0, 20), sample(-32, 0, 19));
		expect(dabs).toEqual([sample(-16, 0, 19), sample(-32, 0, 19)]);
	});
});

// A 9 x 1 grid with a dab of radius 4 px centred on pixel 4.
function dabRow(hardness: number): number[] {
	const cover = createMask(9, 1);
	stampDab(cover, sample(72, 8, 64), hardness);
	return Array.from(cover.data);
}

describe('stampDab', () => {
	it('computes the hand-worked profiles', () => {
		expect(dabRow(0)).toEqual([0, 104, 215, 252, 255, 252, 215, 104, 0]);
		expect(dabRow(50)).toEqual([0, 159, 255, 255, 255, 255, 255, 159, 0]);
		// H2 is limited to 1 - 32 / 64, which keeps the soft edge.
		expect(dabRow(100)).toEqual([0, 244, 255, 255, 255, 255, 255, 244, 0]);
	});

	it('uses each radius on its own axis', () => {
		const cover = createMask(5, 5);
		stampDab(cover, {x: 40, y: 40, rx: 48, ry: 16}, 0);
		// Q = (d / 3)^2 along the row, and 1 or more on every other row.
		expect(Array.from(cover.data)).toEqual([
			...Array.from({length: 10}, () => 0),
			149,
			246,
			255,
			246,
			149,
			...Array.from({length: 10}, () => 0),
		]);
	});

	it('never lowers coverage', () => {
		const cover = createMask(9, 1, 200);
		stampDab(cover, sample(72, 8, 64), 0);
		expect(Array.from(cover.data)).toEqual([
			200, 200, 215, 252, 255, 252, 215, 200, 200,
		]);
	});

	it('clips to the grid and reports the pixels it visited', () => {
		const cover = createMask(4, 4);
		expect(stampDab(cover, sample(0, 0, 32), 100)).toEqual({
			x: 0,
			y: 0,
			width: 2,
			height: 2,
		});
		expect(cover.data[0]).toBeGreaterThan(0);
		expect(stampDab(cover, sample(-200, 8, 32), 100)).toBeUndefined();
		expect(stampDab(cover, sample(8, 900, 32), 100)).toBeUndefined();
	});
});

// One row through the middle of a horizontal stroke, from the centre down.
function edgeProfile(hardness: number): number[] {
	const base = createMask(64, 64);
	const radius = 20 * 16;
	const {bitmap} = paintStroke(base, {mode: 'paint', hardness, strength: 100}, [
		sample(8 * 16, 32 * 16 + 8, radius),
		sample(56 * 16, 32 * 16 + 8, radius),
	]);
	return Array.from({length: 32}, (_, i) => bitmap.data[(32 + i) * 64 + 32]);
}

describe('strokes', () => {
	it('has an edge of at most 2 px at hardness 100', () => {
		const profile = edgeProfile(100);
		const soft = profile.filter((value) => value > 0 && value < 255);
		expect(soft.length).toBeGreaterThan(0);
		expect(soft.length).toBeLessThanOrEqual(2);
		expect(profile.slice(0, 18)).toEqual(Array.from({length: 18}, () => 255));
		expect(profile.slice(20)).toEqual(Array.from({length: 12}, () => 0));
	});

	it('fades from the centre to the radius at hardness 0', () => {
		const profile = edgeProfile(0);
		expect(profile[0]).toBe(255);
		for (let i = 1; i < 20; i++) {
			expect(profile[i]).toBeLessThanOrEqual(profile[i - 1]);
		}

		// Half way out and at the rim of the 20 px radius.
		expect(profile[10]).toBeLessThan(220);
		expect(profile[10]).toBeGreaterThan(100);
		expect(profile[19]).toBeLessThan(10);
		expect(profile.slice(20)).toEqual(Array.from({length: 12}, () => 0));
	});

	it.each([
		['paint', 100, 50, 178],
		['erase', 100, 50, 50],
		['paint', 0, 50, 128],
		['paint', 0, 1, 3],
		['paint', 100, 100, 255],
		['erase', 100, 100, 0],
	] as const)(
		'%s over %i at strength %i gives %i at the core',
		(mode, from, strength, expected) => {
			const {bitmap} = paintStroke(
				createMask(9, 1, from),
				{mode, hardness: 0, strength},
				[sample(72, 8, 64)],
			);
			expect(bitmap.data[4]).toBe(expected);
		},
	);

	it('stays at 128 at half strength however often it crosses itself', () => {
		const stroke: BrushStroke = {mode: 'paint', hardness: 100, strength: 50};
		const left = sample(64, 136, 64);
		const right = sample(448, 136, 64);
		const {bitmap} = paintStroke(createMask(32, 16), stroke, [
			left,
			right,
			left,
			right,
			left,
		]);
		expect(Math.max(...bitmap.data)).toBe(128);
		expect(bitmap.data[8 * 32 + 16]).toBe(128);
	});

	it('does not write its base, and reports whether anything changed', () => {
		const base = createMask(9, 1);
		const stroke: BrushStroke = {mode: 'erase', hardness: 0, strength: 100};
		const erased = paintStroke(base, stroke, [sample(72, 8, 64)]);
		expect(erased.changed).toBe(false);
		const painted = paintStroke(base, {...stroke, mode: 'paint'}, [
			sample(72, 8, 64),
		]);
		expect(painted.changed).toBe(true);
		expect(base.data.every((value) => value === 0)).toBe(true);
	});

	it('writes only the given rectangle', () => {
		const base = createMask(4, 3);
		const target = createMask(4, 3, 7);
		const changed = applyStroke(
			base,
			createMask(4, 3, 255),
			{mode: 'paint', hardness: 0, strength: 100},
			target,
			{x: 1, y: 1, width: 2, height: 1},
		);
		expect(changed).toBe(true);
		expect(Array.from(target.data)).toEqual([
			7, 7, 7, 7, 7, 255, 255, 7, 7, 7, 7, 7,
		]);
	});

	it('fills and clears', () => {
		const empty = createMask(3, 2);
		const filled = fillMask(empty);
		expect(filled.changed).toBe(true);
		expect(Array.from(filled.bitmap.data)).toEqual([
			255, 255, 255, 255, 255, 255,
		]);
		expect(fillMask(filled.bitmap).changed).toBe(false);
		expect(clearMask(filled.bitmap)).toEqual({bitmap: empty, changed: true});
		expect(clearMask(empty).changed).toBe(false);
	});
});

const WIDTH = 24;
const HEIGHT = 18;
const sampleArbitrary: fc.Arbitrary<BrushSample> = fc.record({
	x: fc.integer({min: -100, max: WIDTH * 16 + 100}),
	y: fc.integer({min: -100, max: HEIGHT * 16 + 100}),
	rx: fc.integer({min: 8, max: 160}),
	ry: fc.integer({min: 8, max: 160}),
});
const samplesArbitrary = fc.array(sampleArbitrary, {
	minLength: 1,
	maxLength: 6,
});
const strokeArbitrary: fc.Arbitrary<BrushStroke> = fc.record({
	mode: fc.constantFrom('paint' as const, 'erase' as const),
	hardness: fc.integer({min: 0, max: 100}),
	strength: fc.integer({min: 1, max: 100}),
});
const baseArbitrary: fc.Arbitrary<MaskBitmap> = fc
	.uint8Array({minLength: WIDTH * HEIGHT, maxLength: WIDTH * HEIGHT})
	.map((data) => ({width: WIDTH, height: HEIGHT, data}));

describe('stroke properties', () => {
	it('is deterministic and moves each byte one way, up to the strength', () => {
		fc.assert(
			fc.property(
				baseArbitrary,
				strokeArbitrary,
				samplesArbitrary,
				(base, stroke, samples) => {
					const first = paintStroke(base, stroke, samples);
					expect(paintStroke(base, stroke, samples)).toEqual(first);
					const full = Math.floor((510 * stroke.strength + 100) / 200);
					for (const [p, m] of first.bitmap.data.entries()) {
						const b = base.data[p];
						const moved = stroke.mode === 'paint' ? m - b : b - m;
						const room = stroke.mode === 'paint' ? 255 - b : b;
						expect(moved).toBeGreaterThanOrEqual(0);
						expect(moved).toBeLessThanOrEqual(
							Math.floor((2 * room * full + 255) / 510),
						);
					}

					expect(first.changed).toBe(
						first.bitmap.data.some((m, p) => m !== base.data[p]),
					);
				},
			),
		);
	});

	it('is unchanged by repeating a sample', () => {
		fc.assert(
			fc.property(
				baseArbitrary,
				strokeArbitrary,
				samplesArbitrary,
				fc.nat(),
				(base, stroke, samples, n) => {
					const i = n % samples.length;
					const repeated = samples.toSpliced(i, 0, samples[i]);
					expect(paintStroke(base, stroke, repeated)).toEqual(
						paintStroke(base, stroke, samples),
					);
				},
			),
		);
	});

	it('gives the same bytes when applied dab by dab over dirty rectangles', () => {
		fc.assert(
			fc.property(
				baseArbitrary,
				strokeArbitrary,
				samplesArbitrary,
				(base, stroke, samples) => {
					const cover = createMask(WIDTH, HEIGHT);
					const live = {...base, data: new Uint8Array(base.data)};
					for (const [i, next] of samples.entries()) {
						for (const dab of placeDabs(samples[i - 1], next)) {
							const rect = stampDab(cover, dab, stroke.hardness);
							if (rect !== undefined) {
								applyStroke(base, cover, stroke, live, rect);
							}
						}
					}

					expect(live).toEqual(paintStroke(base, stroke, samples).bitmap);
				},
			),
		);
	});

	it('erases a filled mask to 0 inside every hard dab core', () => {
		fc.assert(
			fc.property(samplesArbitrary, (samples) => {
				const {bitmap} = paintStroke(
					createMask(WIDTH, HEIGHT, 255),
					{mode: 'erase', hardness: 100, strength: 100},
					samples,
				);
				for (const [i, next] of samples.entries()) {
					for (const {x, y, rx, ry} of placeDabs(samples[i - 1], next)) {
						const core = Math.max(0, 1 - 32 / Math.max(rx, ry));
						for (const [p, value] of bitmap.data.entries()) {
							const du = (16 * (p % WIDTH) + 8 - x) / rx;
							const dv = (16 * Math.floor(p / WIDTH) + 8 - y) / ry;
							const q = du * du + dv * dv;
							if (q < 1 && q <= core) {
								expect(value).toBe(0);
							}
						}
					}
				}
			}),
		);
	});
});
