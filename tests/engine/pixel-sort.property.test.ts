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

function sortedChannel(
	img: RgbaImage,
	offsets: readonly number[],
	channel: number,
): number[] {
	return offsets
		.map((offset) => img.data[4 * offset + channel])
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

	it('with fill sort keeps the multiset of pixels in rgba and per-channel multisets in every channelMode', async () => {
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
				const all = lines.flat();
				expect(all).toHaveLength(input.width * input.height);

				if (sortParams.channelMode === 'rgba') {
					for (const {offsets} of intervals) {
						expect(sortedWords(output, offsets)).toEqual(
							sortedWords(input, offsets),
						);
					}

					for (const line of lines) {
						expect(sortedWords(output, line)).toEqual(sortedWords(input, line));
					}

					expect(sortedWords(output, all)).toEqual(sortedWords(input, all));
					return;
				}

				for (let channel = 0; channel < 4; channel++) {
					for (const {offsets} of intervals) {
						expect(sortedChannel(output, offsets, channel)).toEqual(
							sortedChannel(input, offsets, channel),
						);
					}

					for (const line of lines) {
						expect(sortedChannel(output, line, channel)).toEqual(
							sortedChannel(input, line, channel),
						);
					}

					expect(sortedChannel(output, all, channel)).toEqual(
						sortedChannel(input, all, channel),
					);
				}

				// Unselected channels and alpha stay bit-identical at every pixel.
				const active = new Set(
					sortParams.channelMode === 'rgb'
						? [0, 1, 2]
						: [
								sortParams.channelMode === 'r'
									? 0
									: sortParams.channelMode === 'g'
										? 1
										: 2,
							],
				);
				for (let i = 0; i < input.width * input.height; i++) {
					for (let c = 0; c < 4; c++) {
						if (!active.has(c)) {
							expect(output.data[4 * i + c]).toBe(input.data[4 * i + c]);
						}
					}
				}
			}),
			RUNS,
		);
	});

	it('rgb channelMode equals the channel-wise composition of r, g and b with input alpha', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async ({input, params, factor}) => {
				const sourceWidth = sourceWidthFor(input, factor);
				const [rgb, r, g, b] = await Promise.all([
					render(input, {...params, channelMode: 'rgb'}, sourceWidth),
					render(input, {...params, channelMode: 'r'}, sourceWidth),
					render(input, {...params, channelMode: 'g'}, sourceWidth),
					render(input, {...params, channelMode: 'b'}, sourceWidth),
				]);
				for (let i = 0; i < input.data.length; i += 4) {
					expect(rgb.data[i]).toBe(r.data[i]);
					expect(rgb.data[i + 1]).toBe(g.data[i + 1]);
					expect(rgb.data[i + 2]).toBe(b.data[i + 2]);
					expect(rgb.data[i + 3]).toBe(input.data[i + 3]);
				}
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

	it('orders comparison keys monotonically in every non-skipped interval (rgba, no transform)', async () => {
		await fc.assert(
			fc.asyncProperty(
				caseArb,
				fc.constantFrom('ascending', 'descending', 'random'),
				async ({input, params, factor}, order) => {
					const sortParams = {
						...params,
						channelMode: 'rgba' as const,
						intervalTransform: 'none' as const,
						fill: 'sort' as const,
						order,
					};
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
					// Interval splitting, skipping, discretize ties, per-channel sorting and
					// asymmetric transforms depend on which end a run starts from.
					const base = {
						...params,
						channelMode: 'rgba' as const,
						intervalTransform: 'none' as const,
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

	it('with fill sort and rgba channelMode every output colour exists in the input (no blurred pixels)', async () => {
		await fc.assert(
			fc.asyncProperty(caseArb, async ({input, params, factor}) => {
				const sortParams = {
					...params,
					channelMode: 'rgba' as const,
					fill: 'sort' as const,
				};
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
