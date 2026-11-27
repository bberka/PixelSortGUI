import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {hash32} from '../../src/engine/random.ts';
import {
	contextFor,
	greys,
	greyValues,
	imageArb,
	model,
	paramsArb,
	run,
	sourceFactorArb,
	sourceWidthFor,
} from './pixel-sort-model.ts';

const whole = {intervalMode: 'whole'} as const;
const maskOf = (...values: number[]) => new Uint8Array(values);

describe('pixelSort with a mask (engine.md section 5.6)', () => {
	const row = greys(5, 1, [50, 40, 30, 20, 10]);

	it('breaks a run at a mask value of 0', async () => {
		const out = await run(row, whole, {mask: maskOf(255, 255, 0, 255, 255)});
		expect(greyValues(out)).toEqual([40, 50, 30, 10, 20]);
	});

	it('selects as usual for every mask value above 0', async () => {
		const out = await run(row, whole, {mask: maskOf(1, 2, 127, 128, 254)});
		expect(greyValues(out)).toEqual([10, 20, 30, 40, 50]);
	});

	it('clears the selection after invert', async () => {
		const out = await run(
			row,
			{threshold: [0, 0], invert: true},
			{mask: maskOf(255, 255, 0, 255, 255)},
		);
		expect(greyValues(out)).toEqual([40, 50, 30, 10, 20]);
	});

	it('clears edge selection too', async () => {
		const out = await run(
			row,
			{intervalMode: 'edges', edgeThreshold: 1, edgeBlur: 0},
			{mask: maskOf(255, 255, 0, 255, 255)},
		);
		expect(greyValues(out)).toEqual([40, 50, 30, 10, 20]);
	});

	it('reads the mask by image position at any angle', async () => {
		// Two columns sorted bottom to top; only the left column is cut.
		const grid = greys(2, 3, [1, 1, 2, 2, 3, 3]);
		const out = await run(
			grid,
			{...whole, angle: 90},
			{mask: maskOf(255, 255, 0, 255, 255, 255)},
		);
		expect(greyValues(out)).toEqual([1, 3, 2, 2, 3, 1]);
	});

	it('darkens masked-out pixels in the selection view', async () => {
		const out = await run(row, whole, {
			mask: maskOf(255, 0, 1, 0, 255),
			debugView: 'selection',
		});
		expect(greyValues(out)).toEqual([50, 10, 30, 5, 10]);
	});
});

describe('pixelSort mask properties', () => {
	// About a third zeros; the rest spread over 1 to 255.
	const maskedCaseArb = fc
		.record({
			input: imageArb,
			params: paramsArb,
			factor: sourceFactorArb,
			seed: fc.integer({min: 0, max: 0xff_ff_ff}),
		})
		.map(({input, params, factor, seed}) => ({
			input,
			params,
			sourceWidth: sourceWidthFor(input, factor),
			mask: Uint8Array.from({length: input.width * input.height}, (_, i) => {
				const draw = hash32(seed, i);
				return draw % 3 === 0 ? 0 : 1 + (draw % 255);
			}),
		}));

	it('matches the slow reference model with a mask', async () => {
		await fc.assert(
			fc.asyncProperty(
				maskedCaseArb,
				async ({input, params, sourceWidth, mask}) => {
					const expected = model(
						input,
						params,
						contextFor(input, {sourceWidth, mask}),
					);
					const actual = await run(input, params, {sourceWidth, mask});
					const view = await run(input, params, {
						sourceWidth,
						mask,
						debugView: 'selection',
					});
					expect(actual.data).toEqual(expected.output.data);
					expect(view.data).toEqual(expected.selectionView.data);
				},
			),
			{numRuns: 200},
		);
	});

	it('with fill sort never moves a pixel into or out of the zero area', async () => {
		await fc.assert(
			fc.asyncProperty(
				maskedCaseArb,
				async ({input, params, sourceWidth, mask}) => {
					const out = await run(
						input,
						{...params, fill: 'sort', channelMode: 'rgba'},
						{sourceWidth, mask},
					);
					const pixel = (data: Uint8ClampedArray, i: number) =>
						data.subarray(4 * i, 4 * i + 4).join(',');
					const inside: string[] = [];
					const moved: string[] = [];
					for (const [i, value] of mask.entries()) {
						if (value === 0) {
							// The zero area is untouched.
							expect(pixel(out.data, i)).toBe(pixel(input.data, i));
						} else {
							inside.push(pixel(input.data, i));
							moved.push(pixel(out.data, i));
						}
					}

					// The rest is a permutation of itself.
					expect(moved.toSorted()).toEqual(inside.toSorted());
				},
			),
			{numRuns: 200},
		);
	});
});
