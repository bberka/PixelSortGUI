/* eslint-disable no-bitwise -- the selection view is defined as `c >> 2` (engine.md section 5.7) */
import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	renderPixelSort,
	type PixelSortParams,
} from '../../src/engine/effects/pixel-sort/index.ts';
import type {Sorter} from '../../src/engine/effects/pixel-sort/fill.ts';
import {wrap} from '../../src/engine/math.ts';
import {
	copyImage,
	createImage,
	type RgbaImage,
} from '../../src/engine/types.ts';
import {
	angleArb,
	comparisonKey,
	contextFor,
	distinctKeyImage,
	imageArb,
	makeImage,
	model,
	paramsArb,
	sourceFactorArb,
	sourceWidthFor,
} from './pixel-sort-model.ts';

const RUNS = {numRuns: 200};

async function render(
	input: RgbaImage,
	params: PixelSortParams,
	sourceWidth: number,
	sorter?: Sorter,
	debugView?: 'selection',
): Promise<RgbaImage> {
	const output = createImage(input.width, input.height);
	output.data.fill(0xab);
	await renderPixelSort(
		input,
		output,
		params,
		contextFor(input, {sourceWidth, debugView}),
		sorter,
	);
	return output;
}

function pixelWord(img: RgbaImage, offset: number): number {
	const {data} = img;
	return (
		data[4 * offset] * 16_777_216 +
		data[4 * offset + 1] * 65_536 +
		data[4 * offset + 2] * 256 +
		data[4 * offset + 3]
	);
}

function sortedWords(img: RgbaImage, offsets: readonly number[]): number[] {
	return offsets
		.map((offset) => pixelWord(img, offset))
		.toSorted((a, b) => a - b);
}

const caseArb = fc.record({
	input: imageArb,
	params: paramsArb,
	factor: sourceFactorArb,
});

describe('pixelSort properties (engine.md section 14.3)', () => {
	it('matches the slow reference model for any image, parameters and scale', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async ({input, params, factor}) => {
				const sourceWidth = sourceWidthFor(input, factor);
				const expected = model(input, params, contextFor(input, {sourceWidth}));
				const actual = await render(input, params, sourceWidth);
				expect([...actual.data]).toEqual([...expected.output.data]);
			}),
			RUNS,
		);
	});

	it('with fill sort keeps the multiset of pixels in every interval, line and the whole image', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async ({input, params, factor}) => {
				const sortParams = {...params, fill: 'sort' as const};
				const sourceWidth = sourceWidthFor(input, factor);
				const {lines, intervals} = model(
					input,
					sortParams,
					contextFor(input, {sourceWidth}),
				);
				const output = await render(input, sortParams, sourceWidth);
				for (const {offsets} of intervals) {
					expect(sortedWords(output, offsets)).toEqual(
						sortedWords(input, offsets),
					);
				}

				for (const line of lines) {
					expect(sortedWords(output, line)).toEqual(sortedWords(input, line));
				}

				const all = lines.flat();
				expect(all).toHaveLength(input.width * input.height);
				expect(sortedWords(output, all)).toEqual(sortedWords(input, all));
			}),
			RUNS,
		);
	});

	it('leaves every pixel outside an interval bit-identical, with every fill', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async ({input, params, factor}) => {
				const sourceWidth = sourceWidthFor(input, factor);
				const {selected, intervals} = model(
					input,
					params,
					contextFor(input, {sourceWidth}),
				);
				const output = await render(input, params, sourceWidth);
				const inInterval = new Uint8Array(input.width * input.height);
				for (const {offsets, skipped} of intervals) {
					if (!skipped) {
						for (const offset of offsets) {
							inInterval[offset] = 1;
						}
					}
				}

				for (const [i, element] of inInterval.entries()) {
					if (!element) {
						expect(pixelWord(output, i)).toBe(pixelWord(input, i));
					}

					if (element) {
						expect(selected[i]).toBe(1);
					}
				}
			}),
			RUNS,
		);
	});

	it('orders comparison keys monotonically in every non-skipped interval', async () => {
		await fc.assert(
			fc.asyncProperty(
				caseArb,
				fc.constantFrom('ascending', 'descending', 'random'),
				async ({input, params, factor}, order) => {
					const sortParams = {...params, fill: 'sort' as const, order};
					const sourceWidth = sourceWidthFor(input, factor);
					const {intervals} = model(
						input,
						sortParams,
						contextFor(input, {sourceWidth}),
					);
					const output = await render(input, sortParams, sourceWidth);
					for (const {offsets, skipped, descending} of intervals) {
						if (skipped) {
							continue;
						}

						for (let j = 1; j < offsets.length; j++) {
							const previous = comparisonKey(
								output,
								offsets[j - 1],
								sortParams,
							);
							const current = comparisonKey(output, offsets[j], sortParams);
							expect(
								descending ? previous >= current : previous <= current,
							).toBe(true);
						}
					}
				},
			),
			RUNS,
		);
	});

	it('angle θ ascending equals angle θ + 180 descending when all keys are distinct', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.record({
					width: fc.integer({min: 1, max: 64}),
					height: fc.integer({min: 1, max: 64}),
					seed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
					keyName: fc.constantFrom<'luma' | 'hue'>('luma', 'hue'),
					angle: angleArb,
					params: paramsArb,
				}),
				async ({width, height, seed, keyName, angle, params}) => {
					const input = distinctKeyImage(width, height, seed, keyName);
					// Interval splitting, skipping and discretize ties depend on which end a run starts from.
					const base = {
						...params,
						sortKey: keyName,
						maxLength: 0,
						skipChance: 0,
						discretize: 0,
					};
					const forward = await render(
						input,
						{...base, angle, order: 'ascending'},
						width,
					);
					const backward = await render(
						input,
						{
							...base,
							angle: wrap(Math.round(angle * 10) + 1800, 3600) / 10,
							order: 'descending',
						},
						width,
					);
					expect([...forward.data]).toEqual([...backward.data]);
				},
			),
			RUNS,
		);
	});

	it('never writes to its input and gives identical bytes twice', async () => {
		await fc.assert(
			fc.asyncProperty(
				caseArb,
				fc.constantFrom<'none' | 'selection'>('none', 'selection'),
				async ({input, params, factor}, view) => {
					const before = copyImage(input);
					const sourceWidth = sourceWidthFor(input, factor);
					const debugView = view === 'selection' ? view : undefined;
					const first = await render(
						input,
						params,
						sourceWidth,
						undefined,
						debugView,
					);
					expect([...input.data]).toEqual([...before.data]);
					const second = await render(
						input,
						params,
						sourceWidth,
						undefined,
						debugView,
					);
					expect([...second.data]).toEqual([...first.data]);
					expect(first.width).toBe(input.width);
					expect(first.height).toBe(input.height);
					expect(first.data).toHaveLength(input.data.length);
				},
			),
			RUNS,
		);
	});

	it('gives bit-identical output with the radix sort and the built-in sort', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async ({input, params, factor}) => {
				const sourceWidth = sourceWidthFor(input, factor);
				const radix = await render(input, params, sourceWidth, 'radix');
				const builtin = await render(input, params, sourceWidth, 'builtin');
				expect([...radix.data]).toEqual([...builtin.data]);
			}),
			RUNS,
		);
	});

	it('gives bit-identical output with both sorts on runs long enough for the radix passes', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.record({
					width: fc.integer({min: 33, max: 700}),
					height: fc.integer({min: 1, max: 4}),
					seed: fc.integer({min: 0, max: 0xff_ff_ff_ff}),
					style: fc.constantFrom('noise', 'palette', 'smooth', 'flat' as const),
					params: paramsArb,
				}),
				async ({width, height, seed, style, params}) => {
					const input = makeImage(width, height, seed, style, false);
					const wide = {
						...params,
						angle: 0,
						intervalMode: 'whole' as const,
						maxLength: 0,
						skipChance: 0,
						fill: 'sort' as const,
					};
					const radix = await render(input, wide, width, 'radix');
					const builtin = await render(input, wide, width, 'builtin');
					expect([...radix.data]).toEqual([...builtin.data]);
					const expected = model(input, wide, contextFor(input));
					expect([...radix.data]).toEqual([...expected.output.data]);
				},
			),
			RUNS,
		);
	});

	it('the selection view marks exactly the selected pixels', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async ({input, params, factor}) => {
				const sourceWidth = sourceWidthFor(input, factor);
				const {selected, selectionView} = model(
					input,
					params,
					contextFor(input, {sourceWidth}),
				);
				const view = await render(
					input,
					params,
					sourceWidth,
					undefined,
					'selection',
				);
				expect([...view.data]).toEqual([...selectionView.data]);
				for (const [i, element] of selected.entries()) {
					const p = 4 * i;
					expect(view.data[p + 3]).toBe(input.data[p + 3]);
					for (let c = 0; c < 3; c++) {
						expect(view.data[p + c]).toBe(
							element ? input.data[p + c] : input.data[p + c] >> 2,
						);
					}
				}
			}),
			RUNS,
		);
	});

	it('with fill sort every output colour exists in the input (no blurred pixels)', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async ({input, params, factor}) => {
				const sortParams = {...params, fill: 'sort' as const};
				const output = await render(
					input,
					sortParams,
					sourceWidthFor(input, factor),
				);
				const colours = new Set<number>();
				for (let i = 0; i < input.width * input.height; i++) {
					colours.add(pixelWord(input, i));
				}

				for (let i = 0; i < input.width * input.height; i++) {
					expect(colours.has(pixelWord(output, i))).toBe(true);
				}
			}),
			RUNS,
		);
	});
});
