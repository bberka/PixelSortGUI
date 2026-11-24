/* eslint-disable no-bitwise -- the selection view is defined as `c >> 2` (engine.md section 5.7) */
import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry, effects} from '../../src/engine/effects/index.ts';
import {
	pixelSortEffect,
	type PixelSortParams,
} from '../../src/engine/effects/pixel-sort/index.ts';
import {SORT_KEYS} from '../../src/engine/keys.ts';
import {validateParams} from '../../src/engine/params.ts';
import {renderStack} from '../../src/engine/pipeline.ts';
import {intIn, unit} from '../../src/engine/random.ts';
import {
	Cancelled,
	copyImage,
	type ParamSpec,
	type ParamValue,
	type RgbaImage,
} from '../../src/engine/types.ts';
import {
	contextFor,
	defaults,
	greys,
	greyValues,
	makeImage,
	model,
	pixelsOf,
	rgba,
	run,
	withParams,
} from './pixel-sort-model.ts';
import {instance, options, stack} from './sample-effects.ts';

const whole = {intervalMode: 'whole'} as const;

// Opaque pixels that differ only in red, tagged in blue so ties can be told apart.
function reds(values: ReadonlyArray<readonly [number, number]>): RgbaImage {
	return rgba(
		values.length,
		1,
		values.map(([red, tag]) => [red, 0, tag, 255]),
	);
}

function redTags(img: RgbaImage): number[][] {
	return pixelsOf(img).map(([red, , tag]) => [red, tag]);
}

describe('pixelSort definition (engine.md section 5.1)', () => {
	it('declares the type, version, label, description, category and debug view', () => {
		expect(pixelSortEffect.type).toBe('pixelSort');
		expect(pixelSortEffect.version).toBe(1);
		expect(pixelSortEffect.label).toBe('Pixel sort');
		expect(pixelSortEffect.description).toBe(
			'Sort runs of pixels along a direction by brightness, hue or a channel.',
		);
		expect(pixelSortEffect.category).toBe('sort');
		expect(pixelSortEffect.debugViews).toEqual(['selection']);
	});

	it('is in the registered list', () => {
		expect(effects).toContain(pixelSortEffect);
		expect(effectRegistry.get('pixelSort')).toBe(pixelSortEffect);
	});

	it('declares the 15 parameters in table order with their groups', () => {
		const groups = Object.entries(pixelSortEffect.params).map(
			([name, spec]) => [name, spec.kind, spec.group],
		);
		expect(groups).toEqual([
			['angle', 'angle', 'Direction'],
			['intervalMode', 'enum', 'Selection'],
			['selectKey', 'enum', 'Selection'],
			['threshold', 'range', 'Selection'],
			['edgeThreshold', 'number', 'Selection'],
			['edgeBlur', 'integer', 'Selection'],
			['invert', 'boolean', 'Selection'],
			['maxLength', 'integer', 'Length'],
			['lengthJitter', 'number', 'Length'],
			['skipChance', 'number', 'Length'],
			['sortKey', 'enum', 'Order'],
			['order', 'enum', 'Order'],
			['discretize', 'integer', 'Order'],
			['fill', 'enum', 'Output'],
			['seed', 'seed', 'Seed'],
		]);
	});

	it('declares every range, step, unit and default of the table', () => {
		const {params} = pixelSortEffect;
		expect(params.angle).toMatchObject({
			default: 0,
			snaps: [0, 45, 90, 135, 180, 225, 270, 315],
		});
		expect(params.threshold).toMatchObject({
			min: 0,
			max: 1,
			step: 0.001,
			default: [0.25, 0.8],
		});
		expect(params.edgeThreshold).toMatchObject({
			min: 0,
			max: 1,
			step: 0.01,
			default: 0.2,
			unit: 'ratio',
		});
		expect(params.edgeBlur).toMatchObject({
			min: 0,
			max: 8,
			default: 1,
			unit: 'px',
		});
		expect(params.invert).toMatchObject({default: false});
		expect(params.maxLength).toMatchObject({
			min: 0,
			max: 16_384,
			default: 0,
			unit: 'px',
		});
		expect(params.lengthJitter).toMatchObject({
			min: 0,
			max: 1,
			step: 0.01,
			default: 0,
			unit: 'ratio',
		});
		expect(params.skipChance).toMatchObject({
			min: 0,
			max: 1,
			step: 0.01,
			default: 0,
			unit: 'ratio',
		});
		expect(params.discretize).toMatchObject({min: 0, max: 64, default: 0});
		expect(params.discretize).not.toHaveProperty('unit');
	});

	it('declares the enum options and their labels', () => {
		const optionsOf = (spec: ParamSpec) =>
			spec.kind === 'enum'
				? spec.options.map((option) => [option.value, option.label])
				: [];
		const keys = [
			['luma', 'Luma'],
			['lightness', 'Lightness'],
			['value', 'Value'],
			['saturation', 'Saturation'],
			['hue', 'Hue'],
			['red', 'Red'],
			['green', 'Green'],
			['blue', 'Blue'],
		];
		const {params} = pixelSortEffect;
		expect(optionsOf(params.intervalMode)).toEqual([
			['threshold', 'Threshold'],
			['edges', 'Edges'],
			['whole', 'Whole line'],
		]);
		expect(optionsOf(params.selectKey)).toEqual(keys);
		expect(optionsOf(params.sortKey)).toEqual(keys);
		expect(optionsOf(params.order)).toEqual([
			['ascending', 'Ascending'],
			['descending', 'Descending'],
			['shuffle', 'Shuffle'],
			['random', 'Random direction'],
		]);
		expect(optionsOf(params.fill)).toEqual([
			['sort', 'Sort'],
			['average', 'Average'],
			['gradient', 'Gradient'],
		]);
		expect(defaults).toMatchObject({
			intervalMode: 'threshold',
			selectKey: 'luma',
			sortKey: 'luma',
			order: 'ascending',
			fill: 'sort',
			seed: 0,
		});
	});

	it('declares the visibility rules', () => {
		const visibility = Object.fromEntries(
			Object.entries(pixelSortEffect.params)
				.filter(([, spec]) => spec.visibleWhen)
				.map(([name, spec]) => [name, spec.visibleWhen]),
		);
		expect(visibility).toEqual({
			selectKey: {param: 'intervalMode', equals: ['threshold']},
			threshold: {param: 'intervalMode', equals: ['threshold']},
			edgeThreshold: {param: 'intervalMode', equals: ['edges']},
			edgeBlur: {param: 'intervalMode', equals: ['edges']},
			invert: {param: 'intervalMode', notEquals: ['whole']},
			lengthJitter: {param: 'maxLength', notEquals: [0]},
			discretize: {param: 'fill', notEquals: ['average']},
		});
	});

	it('gives every parameter a label and a help text', () => {
		for (const spec of Object.values(pixelSortEffect.params)) {
			expect(spec.label.length).toBeGreaterThan(0);
			expect(spec.help?.length).toBeGreaterThan(0);
		}
	});

	it('has defaults that validation leaves unchanged', () => {
		expect(validateParams(pixelSortEffect.params, defaults)).toEqual(defaults);
	});
});

describe('pixelSort threshold selection (engine.md section 5.4)', () => {
	// Grey g has luma key16 g * 257. The default band [0.25, 0.80] is
	// [16384, 52428], so greys 64..204 are selected and 63 and 205 are not.
	it('sorts each run of in-band pixels and leaves the rest in place', async () => {
		const input = greys(6, 1, [200, 100, 30, 204, 64, 150]);
		expect(greyValues(await run(input))).toEqual([100, 200, 30, 64, 150, 204]);
	});

	it('includes both ends of the band and excludes the keys just outside', async () => {
		const input = greys(6, 1, [205, 204, 64, 63, 100, 90]);
		expect(greyValues(await run(input))).toEqual([205, 64, 204, 63, 90, 100]);
		expect(greyValues(await run(input, {}, {debugView: 'selection'}))).toEqual([
			51, 204, 64, 15, 100, 90,
		]);
	});

	it('selects the out-of-band pixels with invert', async () => {
		const input = greys(6, 1, [200, 100, 30, 20, 64, 150]);
		expect(greyValues(await run(input, {invert: true}))).toEqual([
			200, 100, 20, 30, 64, 150,
		]);
	});

	it('selects on selectKey and sorts on sortKey independently', async () => {
		// Red keys 100*257 and 150*257 are in the band; red 20 is not. The run sorts by blue.
		const input = rgba(4, 1, [
			[100, 0, 9, 255],
			[150, 0, 3, 255],
			[20, 0, 0, 255],
			[120, 0, 1, 255],
		]);
		const output = await run(input, {selectKey: 'red', sortKey: 'blue'});
		expect(pixelsOf(output)).toEqual([
			[150, 0, 3, 255],
			[100, 0, 9, 255],
			[20, 0, 0, 255],
			[120, 0, 1, 255],
		]);
	});

	it('never selects a pixel with alpha 0, with or without invert', async () => {
		const pixels: Array<[number, number, number, number]> = [
			[200, 200, 200, 255],
			[100, 100, 100, 255],
			[150, 150, 150, 0],
			[180, 180, 180, 1],
			[90, 90, 90, 255],
		];
		const input = rgba(5, 1, pixels);
		expect(pixelsOf(await run(input))).toEqual([
			[100, 100, 100, 255],
			[200, 200, 200, 255],
			[150, 150, 150, 0],
			[90, 90, 90, 255],
			[180, 180, 180, 1],
		]);

		const dark = rgba(4, 1, [
			[20, 20, 20, 255],
			[10, 10, 10, 255],
			[5, 5, 5, 0],
			[0, 0, 0, 255],
		]);
		expect(pixelsOf(await run(dark, {invert: true}))).toEqual([
			[10, 10, 10, 255],
			[20, 20, 20, 255],
			[5, 5, 5, 0],
			[0, 0, 0, 255],
		]);
	});

	it('selects every pixel with alpha above 0 for the band 0 to 1 (AC-F6.3)', async () => {
		const input = makeImage(9, 7, 5, 'noise', true);
		const view = await run(
			input,
			{threshold: [0, 1]},
			{debugView: 'selection'},
		);
		for (let p = 0; p < input.data.length; p += 4) {
			const expected =
				input.data[p + 3] === 0
					? [input.data[p] >> 2, input.data[p + 1] >> 2, input.data[p + 2] >> 2]
					: [input.data[p], input.data[p + 1], input.data[p + 2]];
			expect([...view.data.subarray(p, p + 3)]).toEqual(expected);
		}
	});
});

describe('pixelSort whole-line selection', () => {
	it('sorts the whole line', async () => {
		const input = greys(6, 1, [5, 4, 3, 2, 1, 0]);
		expect(greyValues(await run(input, whole))).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('ignores invert and still breaks runs at alpha 0', async () => {
		const input = rgba(5, 1, [
			[9, 9, 9, 255],
			[3, 3, 3, 255],
			[1, 1, 1, 0],
			[8, 8, 8, 255],
			[2, 2, 2, 255],
		]);
		const expected = [
			[3, 3, 3, 255],
			[9, 9, 9, 255],
			[1, 1, 1, 0],
			[2, 2, 2, 255],
			[8, 8, 8, 255],
		];
		expect(pixelsOf(await run(input, whole))).toEqual(expected);
		expect(pixelsOf(await run(input, {...whole, invert: true}))).toEqual(
			expected,
		);
	});

	it('does not carry a run from one line into the next', async () => {
		const input = greys(3, 2, [9, 8, 7, 3, 2, 1]);
		expect(greyValues(await run(input, whole))).toEqual([7, 8, 9, 1, 2, 3]);
	});
});

describe('pixelSort edge selection (engine.md section 5.4)', () => {
	const edges = {intervalMode: 'edges', edgeBlur: 0} as const;

	// With one row the vertical neighbours clamp to the row itself, so
	// gx = 4 * (Y[x+1] - Y[x-1]) and gy = 0. At edgeThreshold 0.20 a pixel is
	// an edge when |gx| >= 204.
	it('selects the pixels that are not edges and sorts their runs', async () => {
		// Gx = -40, -80, 980, 960, -20, -40: pixels 2 and 3 are edges.
		const input = greys(6, 1, [20, 10, 0, 255, 250, 240]);
		expect(greyValues(await run(input, edges))).toEqual([
			10, 20, 0, 255, 240, 250,
		]);
		expect(
			greyValues(await run(input, edges, {debugView: 'selection'})),
		).toEqual([20, 10, 0, 63, 250, 240]);
	});

	it('selects the edges with invert', async () => {
		const input = greys(6, 1, [20, 10, 255, 0, 250, 240]);
		// Gx = -40, 940, -40, -20, 960, -40: pixels 1 and 4 are edges, no two adjacent.
		expect(
			greyValues(
				await run(input, {...edges, invert: true}, {debugView: 'selection'}),
			),
		).toEqual([5, 10, 63, 0, 250, 60]);
	});

	it('counts a gradient exactly at the threshold as an edge', async () => {
		// Pixel 1 has gx = 4 * 51 = 204: an edge. With 50 it is 200: not an edge.
		const at = greys(3, 1, [0, 8, 51]);
		expect(greyValues(await run(at, edges, {debugView: 'selection'}))).toEqual([
			0, 2, 51,
		]);
		const below = greys(3, 1, [0, 8, 50]);
		expect(
			greyValues(await run(below, edges, {debugView: 'selection'})),
		).toEqual([0, 8, 50]);
	});

	it('treats every pixel as an edge at edgeThreshold 0', async () => {
		const input = greys(4, 1, [80, 80, 80, 80]);
		expect(
			greyValues(
				await run(
					input,
					{...edges, edgeThreshold: 0},
					{debugView: 'selection'},
				),
			),
		).toEqual([20, 20, 20, 20]);
		expect(
			greyValues(
				await run(
					input,
					{...edges, edgeThreshold: 0, invert: true},
					{debugView: 'selection'},
				),
			),
		).toEqual([80, 80, 80, 80]);
	});

	it('uses both Sobel axes with coordinates clamped to the image', async () => {
		// A vertical step: gx is 0 in column 0 and 4 * 100 = 400 in columns 1 and 2.
		const vertical = greys(3, 3, [0, 0, 100, 0, 0, 100, 0, 0, 100]);
		expect(
			greyValues(await run(vertical, edges, {debugView: 'selection'})),
		).toEqual([0, 0, 25, 0, 0, 25, 0, 0, 25]);
		// The same step turned a quarter: gy is 0 in row 0 and 400 in rows 1 and 2.
		const horizontal = greys(3, 3, [0, 0, 0, 0, 0, 0, 100, 100, 100]);
		expect(
			greyValues(await run(horizontal, edges, {debugView: 'selection'})),
		).toEqual([0, 0, 0, 0, 0, 0, 25, 25, 25]);
		// A corner step of 60 at the bottom right pixel. There gx = gy = 180:
		// neither axis reaches 204 alone, but 180^2 + 180^2 >= 204^2, so it is an
		// edge at 0.20. Its left and upper neighbours have gradients (180, 60)
		// and the centre has (60, 60): 36000 and 7200, both below 204^2 = 41616
		// and both at or above the 0.08 limit of 81.6^2 = 6658.56.
		const corner = greys(3, 3, [40, 40, 40, 40, 40, 40, 40, 40, 100]);
		expect(
			greyValues(await run(corner, edges, {debugView: 'selection'})),
		).toEqual([40, 40, 40, 40, 40, 40, 40, 40, 25]);
		expect(
			greyValues(
				await run(
					corner,
					{...edges, edgeThreshold: 0.08},
					{debugView: 'selection'},
				),
			),
		).toEqual([40, 40, 40, 40, 10, 10, 40, 10, 25]);
	});

	it('box blurs the luma map before the Sobel operator', async () => {
		const input = greys(5, 1, [0, 0, 255, 0, 0]);
		// Unblurred gx = 0, 1020, 0, -1020, 0: pixels 1 and 3 are edges.
		expect(
			greyValues(await run(input, edges, {debugView: 'selection'})),
		).toEqual([0, 0, 255, 0, 0]);
		// Radius 1 blurs the map to 0, 85, 85, 85, 0 (floor((2 * 255 + 3) / 6) = 85),
		// so gx = 340, 340, 0, -340, -340 and only pixel 2 is not an edge.
		const blurred = rgba(5, 1, [
			[40, 40, 40, 255],
			[40, 40, 40, 255],
			[255, 255, 255, 255],
			[40, 40, 40, 255],
			[40, 40, 40, 255],
		]);
		// Map 40, 40, 255, 40, 40 blurs to 40, 112, 112, 112, 40
		// (floor((2 * 335 + 3) / 6) = 112): gx = 288, 288, 0, -288, -288.
		expect(
			greyValues(
				await run(
					blurred,
					{intervalMode: 'edges', edgeBlur: 1},
					{debugView: 'selection'},
				),
			),
		).toEqual([10, 10, 255, 10, 10]);
		expect(
			greyValues(
				await run(
					input,
					{intervalMode: 'edges', edgeBlur: 1},
					{debugView: 'selection'},
				),
			),
		).toEqual([0, 0, 255, 0, 0]);
	});

	it('never selects a pixel with alpha 0', async () => {
		const input = rgba(3, 1, [
			[80, 80, 80, 255],
			[80, 80, 80, 0],
			[80, 80, 80, 255],
		]);
		expect(pixelsOf(await run(input, edges, {debugView: 'selection'}))).toEqual(
			[
				[80, 80, 80, 255],
				[20, 20, 20, 0],
				[80, 80, 80, 255],
			],
		);
	});
});

describe('pixelSort direction (engine.md section 5.2)', () => {
	it('angle 0 puts the smallest key at the left and 180 at the right', async () => {
		const input = greys(3, 1, [3, 1, 2]);
		expect(greyValues(await run(input, {...whole, angle: 0}))).toEqual([
			1, 2, 3,
		]);
		expect(greyValues(await run(input, {...whole, angle: 180}))).toEqual([
			3, 2, 1,
		]);
	});

	it('angle 90 puts the smallest key at the bottom and 270 at the top', async () => {
		const input = greys(1, 3, [3, 1, 2]);
		expect(greyValues(await run(input, {...whole, angle: 90}))).toEqual([
			3, 2, 1,
		]);
		expect(greyValues(await run(input, {...whole, angle: 270}))).toEqual([
			1, 2, 3,
		]);
	});

	it('angle 45 sorts each anti-diagonal from lower left to upper right', async () => {
		// Lines are (x, k - x): {(0,0)}, {(0,1), (1,0)}, {(1,1)}.
		const input = greys(2, 2, [7, 9, 5, 1]);
		expect(greyValues(await run(input, {...whole, angle: 45}))).toEqual([
			7, 9, 5, 1,
		]);
		const swapped = greys(2, 2, [7, 5, 9, 1]);
		expect(greyValues(await run(swapped, {...whole, angle: 45}))).toEqual([
			7, 9, 5, 1,
		]);
		expect(greyValues(await run(input, {...whole, angle: 225}))).toEqual([
			7, 5, 9, 1,
		]);
	});
});

describe('pixelSort intervals (engine.md section 5.4)', () => {
	it('splits a run into intervals of maxLength from its first pixel', async () => {
		const input = greys(6, 1, [5, 4, 3, 2, 1, 0]);
		expect(greyValues(await run(input, {...whole, maxLength: 2}))).toEqual([
			4, 5, 2, 3, 0, 1,
		]);
		expect(greyValues(await run(input, {...whole, maxLength: 4}))).toEqual([
			2, 3, 4, 5, 0, 1,
		]);
		// At 180 the line runs right to left, so intervals count from the right end.
		const rising = greys(6, 1, [0, 1, 2, 3, 4, 5]);
		expect(
			greyValues(await run(rising, {...whole, maxLength: 4, angle: 180})),
		).toEqual([1, 0, 5, 4, 3, 2]);
	});

	it('leaves the image unchanged at maxLength 1 and sorts whole runs at 16384', async () => {
		const input = greys(6, 1, [5, 4, 3, 2, 1, 0]);
		expect(greyValues(await run(input, {...whole, maxLength: 1}))).toEqual([
			5, 4, 3, 2, 1, 0,
		]);
		expect(greyValues(await run(input, {...whole, maxLength: 16_384}))).toEqual(
			[0, 1, 2, 3, 4, 5],
		);
	});

	it('starts intervals again at each run', async () => {
		const input = greys(7, 1, [150, 100, 90, 0, 150, 100, 90]);
		expect(greyValues(await run(input, {maxLength: 2}))).toEqual([
			100, 150, 90, 0, 100, 150, 90,
		]);
	});

	it('draws each interval cap from the jitter hash of its first pixel', async () => {
		const input = greys(6, 1, [5, 4, 3, 2, 1, 0]);
		const jitter = {...whole, maxLength: 4, lengthJitter: 0.5};
		// Seed 1: u = 0.2928 at position 0, so L = floor(4 * (1 + 0.5 * (2u - 1))) = 3;
		// then u = 0.5446 at position 3 gives L = 4, cut to the 3 pixels left.
		expect(unit(1, 1, 0, 0)).toBeCloseTo(0.2928, 4);
		expect(unit(1, 1, 0, 3)).toBeCloseTo(0.5446, 4);
		expect(greyValues(await run(input, {...jitter, seed: 1}))).toEqual([
			3, 4, 5, 0, 1, 2,
		]);
		// Seed 3: u = 0.8919 gives L = floor(4 * 1.3919) = 5; the last pixel is alone.
		expect(unit(3, 1, 0, 0)).toBeCloseTo(0.8919, 4);
		expect(greyValues(await run(input, {...jitter, seed: 3}))).toEqual([
			1, 2, 3, 4, 5, 0,
		]);
	});

	it('skips an interval when its skip hash is below skipChance', async () => {
		const input = greys(6, 1, [200, 100, 30, 204, 64, 150]);
		// Seed 1: 0.2160 at position 0 (skipped), 0.5039 at position 3 (sorted).
		expect(unit(1, 2, 0, 0)).toBeCloseTo(0.216, 4);
		expect(unit(1, 2, 0, 3)).toBeCloseTo(0.5039, 4);
		expect(greyValues(await run(input, {skipChance: 0.5, seed: 1}))).toEqual([
			200, 100, 30, 64, 150, 204,
		]);
		// Seed 3: 0.5423 at position 0 (sorted), 0.0772 at position 3 (skipped).
		expect(unit(3, 2, 0, 0)).toBeCloseTo(0.5423, 4);
		expect(unit(3, 2, 0, 3)).toBeCloseTo(0.0772, 4);
		expect(greyValues(await run(input, {skipChance: 0.5, seed: 3}))).toEqual([
			100, 200, 30, 204, 64, 150,
		]);
		expect(greyValues(await run(input, {skipChance: 1, seed: 3}))).toEqual([
			200, 100, 30, 204, 64, 150,
		]);
		expect(greyValues(await run(input, {skipChance: 0, seed: 3}))).toEqual([
			100, 200, 30, 64, 150, 204,
		]);
	});
});

describe('pixelSort order (engine.md section 5.5)', () => {
	it('descending puts the largest key first', async () => {
		const input = greys(6, 1, [200, 100, 30, 204, 64, 150]);
		expect(greyValues(await run(input, {order: 'descending'}))).toEqual([
			200, 100, 30, 204, 150, 64,
		]);
	});

	it('keeps equal keys in their original order, ascending and descending', async () => {
		const input = reds([
			[5, 1],
			[3, 2],
			[5, 3],
			[3, 4],
		]);
		const byRed = {...whole, sortKey: 'red'} as const;
		expect(redTags(await run(input, byRed))).toEqual([
			[3, 2],
			[3, 4],
			[5, 1],
			[5, 3],
		]);
		expect(redTags(await run(input, {...byRed, order: 'descending'}))).toEqual([
			[5, 1],
			[5, 3],
			[3, 2],
			[3, 4],
		]);
	});

	it('discretize makes nearby keys compare equal', async () => {
		// With D = 2, c = floor(red * 257 / 514) = floor(red / 2): 2, 2, 1, 1.
		const input = reds([
			[5, 1],
			[4, 2],
			[3, 3],
			[2, 4],
		]);
		const byRed = {...whole, sortKey: 'red', discretize: 2} as const;
		expect(redTags(await run(input, byRed))).toEqual([
			[3, 3],
			[2, 4],
			[5, 1],
			[4, 2],
		]);
		expect(redTags(await run(input, {...byRed, order: 'descending'}))).toEqual([
			[5, 1],
			[4, 2],
			[3, 3],
			[2, 4],
		]);
	});

	it('random picks ascending below 0.5 and descending otherwise, per interval', async () => {
		const input = greys(3, 1, [3, 1, 2]);
		expect(unit(1, 3, 0, 0)).toBeCloseTo(0.0863, 4);
		expect(
			greyValues(await run(input, {...whole, order: 'random', seed: 1})),
		).toEqual([1, 2, 3]);
		expect(unit(2, 3, 0, 0)).toBeCloseTo(0.7718, 4);
		expect(
			greyValues(await run(input, {...whole, order: 'random', seed: 2})),
		).toEqual([3, 2, 1]);
	});

	it('shuffle is the Fisher–Yates of the spec', async () => {
		const input = greys(4, 1, [10, 20, 30, 40]);
		const shuffle = {...whole, order: 'shuffle'} as const;
		// Seed 1 draws t = 1, 0, 1 for j = 3, 2, 1: swap(3,1), swap(2,0), swap(1,1).
		expect([3, 2, 1].map((j) => intIn(0, j, 1, 4, 0, 0, j))).toEqual([1, 0, 1]);
		expect(greyValues(await run(input, {...shuffle, seed: 1}))).toEqual([
			30, 40, 10, 20,
		]);
		// Seed 2 draws t = 1, 2, 0: swap(3,1), swap(2,2), swap(1,0).
		expect([3, 2, 1].map((j) => intIn(0, j, 2, 4, 0, 0, j))).toEqual([1, 2, 0]);
		expect(greyValues(await run(input, {...shuffle, seed: 2}))).toEqual([
			40, 10, 30, 20,
		]);
		// Seed 3 draws t = 3, 2, 1: every swap is with itself.
		expect(greyValues(await run(input, {...shuffle, seed: 3}))).toEqual([
			10, 20, 30, 40,
		]);
	});
});

describe('pixelSort fill (engine.md section 5.5)', () => {
	it('sort moves all four channels together', async () => {
		const input = rgba(3, 1, [
			[90, 1, 2, 200],
			[30, 3, 4, 100],
			[60, 5, 6, 50],
		]);
		expect(pixelsOf(await run(input, {...whole, sortKey: 'red'}))).toEqual([
			[30, 3, 4, 100],
			[60, 5, 6, 50],
			[90, 1, 2, 200],
		]);
	});

	it('average paints the interval with the rounded channel mean', async () => {
		const input = rgba(4, 1, [
			[10, 0, 0, 255],
			[20, 3, 0, 255],
			[31, 0, 1, 254],
			[7, 7, 7, 0],
		]);
		// R: floor((2 * 61 + 3) / 6) = 20. G: floor(9 / 6) = 1. B: floor(5 / 6) = 0.
		// A: floor((2 * 764 + 3) / 6) = 255. The transparent pixel is not selected.
		const expected = [
			[20, 1, 0, 255],
			[20, 1, 0, 255],
			[20, 1, 0, 255],
			[7, 7, 7, 0],
		];
		expect(pixelsOf(await run(input, {...whole, fill: 'average'}))).toEqual(
			expected,
		);
		expect(
			pixelsOf(
				await run(input, {
					...whole,
					fill: 'average',
					order: 'shuffle',
					discretize: 9,
					seed: 4,
				}),
			),
		).toEqual(expected);
	});

	it('gradient interpolates from the first ordered pixel to the last', async () => {
		const input = reds([
			[30, 0],
			[0, 9],
			[100, 3],
			[10, 0],
		]);
		const gradient = {...whole, sortKey: 'red', fill: 'gradient'} as const;
		// Red from 0 to 100: floor((2 * 100 * j + 3) / 6) = 0, 33, 67, 100.
		// Tag from 9 to 3: floor((2 * (9 * (3 - j) + 3 * j) + 3) / 6) = 9, 7, 5, 3.
		expect(redTags(await run(input, gradient))).toEqual([
			[0, 9],
			[33, 7],
			[67, 5],
			[100, 3],
		]);
		expect(
			redTags(await run(input, {...gradient, order: 'descending'})),
		).toEqual([
			[100, 3],
			[67, 5],
			[33, 7],
			[0, 9],
		]);
	});

	it('gradient takes its ends from the stable order when keys tie', async () => {
		// Ascending by red: (5,1) is the first of the smallest, (9,4) the last of the largest.
		const input = reds([
			[9, 2],
			[5, 1],
			[5, 7],
			[9, 4],
		]);
		const output = await run(input, {
			...whole,
			sortKey: 'red',
			fill: 'gradient',
		});
		// Red 5 to 9: floor((2 * (5 * (3 - j) + 9 * j) + 3) / 6) = 5, 6, 8, 9. Tag 1 to 4: 1, 2, 3, 4.
		expect(redTags(output)).toEqual([
			[5, 1],
			[6, 2],
			[8, 3],
			[9, 4],
		]);
	});

	it('gradient with shuffle runs between the first and last shuffled pixels', async () => {
		// Seed 2 shuffles 10, 20, 30, 40 to 40, 10, 30, 20 (see the shuffle test).
		const input = greys(4, 1, [10, 20, 30, 40]);
		// Floor((2 * (40 * (3 - j) + 20 * j) + 3) / 6) = 40, 33, 27, 20.
		expect(
			greyValues(
				await run(input, {
					...whole,
					order: 'shuffle',
					fill: 'gradient',
					seed: 2,
				}),
			),
		).toEqual([40, 33, 27, 20]);
	});
});

describe('pixelSort selection view (engine.md section 5.7)', () => {
	it('darkens unselected pixels to a quarter and keeps alpha', async () => {
		const input = rgba(4, 1, [
			[200, 100, 30, 255],
			[255, 255, 255, 77],
			[7, 6, 5, 255],
			[120, 130, 140, 0],
		]);
		// Luma keys: (200,100,30) is 29305, in band. White and near-black are out; alpha 0 is never selected.
		expect(pixelsOf(await run(input, {}, {debugView: 'selection'}))).toEqual([
			[200, 100, 30, 255],
			[63, 63, 63, 77],
			[1, 1, 1, 255],
			[30, 32, 35, 0],
		]);
	});

	it('ignores intervals, skipping, order and fill', async () => {
		const input = makeImage(11, 6, 3, 'smooth', true);
		const plain = await run(input, {}, {debugView: 'selection'});
		const busy = await run(
			input,
			{
				maxLength: 3,
				lengthJitter: 1,
				skipChance: 1,
				order: 'shuffle',
				fill: 'average',
				seed: 99,
				angle: 30,
			},
			{debugView: 'selection'},
		);
		expect([...busy.data]).toEqual([...plain.data]);
	});
});

describe('pixelSort seed (AC-F6.4)', () => {
	const input = makeImage(40, 12, 8, 'smooth', false);

	it.each([
		['shuffle', {order: 'shuffle'}],
		['random order', {order: 'random'}],
		['length jitter', {maxLength: 6, lengthJitter: 0.8}],
		['skip chance', {skipChance: 0.5}],
	] as Array<[string, Partial<PixelSortParams>]>)(
		'changes the result with %s',
		async (_name, overrides) => {
			const a = await run(input, {...whole, ...overrides, seed: 1});
			const b = await run(input, {...whole, ...overrides, seed: 2});
			expect([...a.data]).not.toEqual([...b.data]);
		},
	);

	it('does not change the result when nothing random is on', async () => {
		for (const overrides of [
			{},
			{maxLength: 6},
			{fill: 'gradient'},
			{intervalMode: 'edges'},
			{order: 'descending', discretize: 4},
		] as Array<Partial<PixelSortParams>>) {
			const a = await run(input, {...overrides, seed: 1});
			const b = await run(input, {...overrides, seed: 0xff_ff_ff_ff});
			expect([...a.data]).toEqual([...b.data]);
		}
	});
});

describe('pixelSort resolution independence (engine.md section 10.3)', () => {
	it('scales maxLength with ctx.pxLength', async () => {
		const input = greys(8, 1, [7, 6, 5, 4, 3, 2, 1, 0]);
		const capped = {...whole, maxLength: 8};
		expect(greyValues(await run(input, capped))).toEqual([
			0, 1, 2, 3, 4, 5, 6, 7,
		]);
		// Half scale: 8 source pixels are 4 render pixels.
		expect(greyValues(await run(input, capped, {sourceWidth: 16}))).toEqual([
			4, 5, 6, 7, 0, 1, 2, 3,
		]);
		// Quarter scale: 2 render pixels.
		expect(greyValues(await run(input, capped, {sourceWidth: 32}))).toEqual([
			6, 7, 4, 5, 2, 3, 0, 1,
		]);
		// A positive length never scales to 0: 1 source pixel stays 1 render pixel.
		expect(
			greyValues(await run(input, {...whole, maxLength: 1}, {sourceWidth: 32})),
		).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
	});

	it('scales edgeBlur with ctx.px', async () => {
		const input = makeImage(24, 18, 21, 'noise', false);
		const blur = (edgeBlur: number, sourceWidth: number) =>
			run(
				input,
				{intervalMode: 'edges', edgeBlur, edgeThreshold: 0.1},
				{sourceWidth, debugView: 'selection'},
			);
		const radius0 = await blur(0, 24);
		const radius1 = await blur(1, 24);
		const radius2 = await blur(2, 24);
		expect([...radius1.data]).not.toEqual([...radius0.data]);
		expect([...radius2.data]).not.toEqual([...radius1.data]);
		// Quarter scale: px(1) = 0, px(4) = 1, px(8) = 2.
		expect([...(await blur(1, 96)).data]).toEqual([...radius0.data]);
		expect([...(await blur(4, 96)).data]).toEqual([...radius1.data]);
		expect([...(await blur(8, 96)).data]).toEqual([...radius2.data]);
	});

	it('makes the same random choice for a proxy interval as the export makes at its source coordinates', async () => {
		// Row k of the 16x8 proxy has one run starting at column starts[k]. At
		// half scale that is source line toSource(k) = 2k + 1 and source position
		// 2 * starts[k] + 1, where the 32x16 full-size image has its run.
		const starts = [3, 0, 5, 1, 7, 2, 6, 4];
		const run3 = [150, 100, 200];
		const proxy = Array.from({length: 16 * 8}, () => 0);
		const full = Array.from({length: 32 * 16}, () => 0);
		for (const [k, start] of starts.entries()) {
			for (const [j, grey] of run3.entries()) {
				proxy[k * 16 + start + j] = grey;
				full[(2 * k + 1) * 32 + 2 * start + 1 + j] = grey;
			}
		}

		const random = {order: 'random', seed: 2} as const;
		const proxyOut = greyValues(
			await run(greys(16, 8, proxy), random, {sourceWidth: 32}),
		);
		const fullOut = greyValues(await run(greys(32, 16, full), random));
		const directions: string[] = [];
		for (const [k, start] of starts.entries()) {
			const fromProxy = proxyOut.slice(k * 16 + start, k * 16 + start + 3);
			const at = (2 * k + 1) * 32 + 2 * start + 1;
			const fromFull = fullOut.slice(at, at + 3);
			expect(fromProxy).toEqual(fromFull);
			const ascending = unit(2, 3, 2 * k + 1, 2 * start + 1) < 0.5;
			expect(fromProxy).toEqual(ascending ? [100, 150, 200] : [200, 150, 100]);
			directions.push(ascending ? 'A' : 'D');
		}

		expect(directions.join('')).toBe('AADAADAD');
	});

	it('keys skip, jitter and shuffle to source coordinates as well', async () => {
		const input = makeImage(20, 10, 4, 'smooth', false);
		for (const overrides of [
			{skipChance: 0.5},
			{maxLength: 10, lengthJitter: 1},
			{order: 'shuffle'},
		] as Array<Partial<PixelSortParams>>) {
			const params = withParams({...whole, angle: 30, seed: 7, ...overrides});
			for (const sourceWidth of [20, 40, 50]) {
				const expected = model(input, params, contextFor(input, {sourceWidth}));
				const actual = await run(input, params, {sourceWidth});
				expect([...actual.data]).toEqual([...expected.output.data]);
			}

			const atHalf = await run(input, params, {sourceWidth: 40});
			const atFull = await run(input, params, {sourceWidth: 20});
			expect([...atHalf.data]).not.toEqual([...atFull.data]);
		}
	});
});

function valuesFor(spec: ParamSpec): ParamValue[] {
	switch (spec.kind) {
		case 'number':
		case 'integer': {
			return [spec.min, spec.max, spec.default];
		}

		case 'boolean': {
			return [false, true];
		}

		case 'enum': {
			return spec.options.map((option) => option.value);
		}

		case 'range': {
			return [
				[spec.min, spec.min],
				[spec.max, spec.max],
				[spec.min, spec.max],
				spec.default,
			];
		}

		case 'angle': {
			return [0, 359.9, 0.1, 44.9, 45.1, ...spec.snaps];
		}

		case 'seed': {
			return [0, 0xff_ff_ff_ff];
		}
	}
}

describe('pixelSort parameter extremes', () => {
	const sizes: Array<[number, number]> = [
		[1, 1],
		[1, 7],
		[7, 1],
		[5, 3],
		[7, 9],
	];
	const images = sizes.map(([width, height]) =>
		makeImage(width, height, 12, 'smooth', true),
	);

	async function renderThroughPipeline(
		input: RgbaImage,
		params: Record<string, ParamValue>,
	): Promise<void> {
		const before = copyImage(input);
		const result = await renderStack(
			input,
			stack(instance('pixelSort', {params})),
			effectRegistry,
			options(input),
		);
		expect(result.warnings).toEqual([]);
		expect(result.image.width).toBe(input.width);
		expect(result.image.height).toBe(input.height);
		expect([...input.data]).toEqual([...before.data]);
		const valid = validateParams(pixelSortEffect.params, params);
		const expected = model(input, valid, contextFor(input));
		expect([...result.image.data]).toEqual([...expected.output.data]);
	}

	it('renders every parameter at its minimum, maximum, default and each option, in every interval mode', async () => {
		for (const [name, spec] of Object.entries(pixelSortEffect.params)) {
			for (const value of valuesFor(spec)) {
				for (const intervalMode of ['threshold', 'edges', 'whole']) {
					for (const input of images) {
						await renderThroughPipeline(input, {
							...defaults,
							seed: 5,
							intervalMode,
							[name]: value,
						});
					}
				}
			}
		}
	});

	it('renders with every numeric parameter at its minimum and at its maximum together', async () => {
		for (const pick of ['min', 'max'] as const) {
			const params: Record<string, ParamValue> = {...defaults};
			for (const [name, spec] of Object.entries(pixelSortEffect.params)) {
				if (spec.kind === 'number' || spec.kind === 'integer') {
					params[name] = spec[pick];
				}
			}

			for (const fill of ['sort', 'average', 'gradient']) {
				for (const order of ['ascending', 'descending', 'shuffle', 'random']) {
					for (const input of images) {
						await renderThroughPipeline(input, {
							...params,
							fill,
							order,
							intervalMode: 'whole',
						});
					}
				}
			}
		}
	});

	it('sorts with every key on a line longer than the insertion sort cutoff', async () => {
		const input = makeImage(200, 3, 77, 'noise', false);
		for (const sortKey of SORT_KEYS) {
			for (const angle of [0, 180, 30]) {
				const params = withParams({...whole, sortKey, angle});
				const expected = model(input, params, contextFor(input));
				const actual = await run(input, params);
				expect([...actual.data]).toEqual([...expected.output.data]);
			}
		}
	});
});

describe('pixelSort in the pipeline', () => {
	const input = makeImage(31, 17, 2, 'smooth', true);

	it('renders the selection view when the pipeline asks for it', async () => {
		const sort = instance('pixelSort', {params: {...defaults}});
		const result = await renderStack(
			input,
			stack(sort),
			effectRegistry,
			options(input, {debug: {instanceId: sort.id, view: 'selection'}}),
		);
		const expected = model(input, defaults, contextFor(input));
		expect([...result.image.data]).toEqual([...expected.selectionView.data]);
	});

	it('returns the input exactly at mix 0', async () => {
		const result = await renderStack(
			input,
			stack(instance('pixelSort', {params: {...defaults}, mix: 0})),
			effectRegistry,
			options(input),
		);
		expect([...result.image.data]).toEqual([...input.data]);
	});

	it('renders the same after a saved-project round trip', async () => {
		const original = stack(
			instance('pixelSort', {
				params: {
					...defaults,
					angle: 333.3,
					threshold: [0.196, 0.627],
					maxLength: 12,
					lengthJitter: 0.37,
					order: 'random',
					seed: 4_000_000_000,
				},
			}),
		);
		// eslint-disable-next-line unicorn/prefer-structured-clone -- a saved project is stored as JSON
		const loaded = JSON.parse(JSON.stringify(original)) as typeof original;
		expect(loaded).toEqual(original);
		const a = await renderStack(
			input,
			original,
			effectRegistry,
			options(input),
		);
		const b = await renderStack(input, loaded, effectRegistry, options(input));
		expect(a.warnings).toEqual([]);
		expect([...b.image.data]).toEqual([...a.image.data]);
	});
});

describe('pixelSort cancellation and progress', () => {
	const input = makeImage(300, 200, 6, 'smooth', false);

	it.each(['threshold', 'edges', 'whole'] as const)(
		'calls the checkpoint at least once per 16,384 pixels in %s mode',
		async (intervalMode) => {
			for (const angle of [0, 90, 30]) {
				let calls = 0;
				const fractions: number[] = [];
				await run(
					input,
					{intervalMode, angle},
					{
						checkpoint() {
							calls++;
						},
						progress(fraction) {
							fractions.push(fraction);
						},
					},
				);
				expect(calls).toBeGreaterThanOrEqual(Math.floor((300 * 200) / 16_384));
				expect(calls).toBeLessThan(300 * 200);
				expect(fractions.at(-1)).toBe(1);
				expect(fractions).toEqual(fractions.toSorted((a, b) => a - b));
				expect(fractions[0]).toBeGreaterThanOrEqual(0);
			}
		},
	);

	it('checkpoints before every line of a 16,384 pixel wide image', async () => {
		const wide = makeImage(16_384, 3, 1, 'flat', false);
		let calls = 0;
		await run(
			wide,
			{},
			{
				checkpoint() {
					calls++;
				},
			},
		);
		expect(calls).toBe(2);
	});

	it('stops when the checkpoint throws and awaits one that returns a promise', async () => {
		let calls = 0;
		await expect(
			run(
				input,
				{},
				{
					checkpoint() {
						calls++;
						if (calls === 2) {
							throw new Cancelled();
						}
					},
				},
			),
		).rejects.toBeInstanceOf(Cancelled);
		expect(calls).toBe(2);

		let pending = 0;
		let overlapped = false;
		const output = await run(
			input,
			{},
			{
				async checkpoint() {
					overlapped ||= pending > 0;
					pending++;
					await Promise.resolve();
					pending--;
				},
			},
		);
		expect(overlapped).toBe(false);
		expect([...output.data]).toEqual([...(await run(input)).data]);
	});
});
