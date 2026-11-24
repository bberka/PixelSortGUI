import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {boxDownscale} from '../../src/engine/resample.ts';
import type {RgbaImage} from '../../src/engine/types.ts';
import {bytes, image, noiseImage} from './sample-effects.ts';

// An opaque grey image: R, G and B hold the same value, alpha is 255.
function grey(width: number, height: number, values: number[]): RgbaImage {
	return image(
		width,
		height,
		values.flatMap((v) => [v, v, v, 255]),
	);
}

function greyValues(img: RgbaImage): number[] {
	return bytes(img).filter((_, index) => index % 4 === 0);
}

function opaqueNoiseImage(
	width: number,
	height: number,
	seed: number,
): RgbaImage {
	const img = noiseImage(width, height, seed);
	for (let i = 3; i < img.data.length; i += 4) {
		img.data[i] = 255;
	}

	return img;
}

function straightReferenceDownscale(
	source: RgbaImage,
	width: number,
	height: number,
): number[] {
	const sw = BigInt(source.width);
	const sh = BigInt(source.height);
	const dw = BigInt(width);
	const dh = BigInt(height);
	const max = (a: bigint, b: bigint) => (a > b ? a : b);
	const min = (a: bigint, b: bigint) => (a < b ? a : b);
	const result: number[] = [];
	for (let dy = 0n; dy < dh; dy++) {
		for (let dx = 0n; dx < dw; dx++) {
			for (let c = 0; c < 4; c++) {
				let sum = 0n;
				for (let sy = 0n; sy < sh; sy++) {
					const wy =
						min((sy + 1n) * dh, (dy + 1n) * sh) - max(sy * dh, dy * sh);
					for (let sx = 0n; sx < sw; sx++) {
						const wx =
							min((sx + 1n) * dw, (dx + 1n) * sw) - max(sx * dw, dx * sw);
						if (wx > 0n && wy > 0n) {
							sum +=
								wx * wy * BigInt(source.data[Number(4n * (sy * sw + sx)) + c]);
						}
					}
				}

				result.push(Number((2n * sum + sw * sh) / (2n * sw * sh)));
			}
		}
	}

	return result;
}

function referenceDownscale(
	source: RgbaImage,
	width: number,
	height: number,
): number[] {
	if (width === source.width && height === source.height) {
		return bytes(source);
	}

	const sw = BigInt(source.width);
	const sh = BigInt(source.height);
	const dw = BigInt(width);
	const dh = BigInt(height);
	const max = (a: bigint, b: bigint) => (a > b ? a : b);
	const min = (a: bigint, b: bigint) => (a < b ? a : b);
	const result: number[] = [];
	for (let dy = 0n; dy < dh; dy++) {
		for (let dx = 0n; dx < dw; dx++) {
			let sumR = 0n;
			let sumG = 0n;
			let sumB = 0n;
			let sumA = 0n;
			for (let sy = 0n; sy < sh; sy++) {
				const wy = min((sy + 1n) * dh, (dy + 1n) * sh) - max(sy * dh, dy * sh);
				for (let sx = 0n; sx < sw; sx++) {
					const wx =
						min((sx + 1n) * dw, (dx + 1n) * sw) - max(sx * dw, dx * sw);
					if (wx <= 0n || wy <= 0n) {
						continue;
					}

					const p = Number(4n * (sy * sw + sx));
					const wa = wx * wy * BigInt(source.data[p + 3]);
					sumR += wa * BigInt(source.data[p]);
					sumG += wa * BigInt(source.data[p + 1]);
					sumB += wa * BigInt(source.data[p + 2]);
					sumA += wa;
				}
			}

			if (sumA === 0n) {
				result.push(0, 0, 0, 0);
			} else {
				result.push(
					Number((2n * sumR + sumA) / (2n * sumA)),
					Number((2n * sumG + sumA) / (2n * sumA)),
					Number((2n * sumB + sumA) / (2n * sumA)),
					Number((2n * sumA + sw * sh) / (2n * sw * sh)),
				);
			}
		}
	}

	return result;
}

describe('boxDownscale', () => {
	it('averages whole 2x2 blocks when the size divides evenly', () => {
		const source = grey(4, 2, [10, 20, 30, 40, 50, 60, 70, 81]);
		// (10+20+50+60)/4 = 35; (30+40+70+81)/4 = 55.25
		expect(greyValues(boxDownscale(source, 2, 1))).toEqual([35, 55]);
	});

	it('rounds an exact half up', () => {
		expect(greyValues(boxDownscale(grey(2, 2, [0, 0, 1, 1]), 1, 1))).toEqual([
			1,
		]);
		expect(greyValues(boxDownscale(grey(2, 2, [1, 2, 3, 4]), 1, 1))).toEqual([
			3,
		]);
	});

	it('weights a shared source pixel by its overlap: 3 wide to 2 wide', () => {
		// Each destination pixel covers 1.5 source pixels: weights 2:1 and 1:2.
		expect(greyValues(boxDownscale(grey(3, 1, [30, 60, 90]), 2, 1))).toEqual([
			40, 80,
		]);
		expect(greyValues(boxDownscale(grey(3, 1, [0, 0, 255]), 2, 1))).toEqual([
			0, 170,
		]);
		// (2*10+11)/3 = 10.33; (11+2*13)/3 = 12.33
		expect(greyValues(boxDownscale(grey(3, 1, [10, 11, 13]), 2, 1))).toEqual([
			10, 12,
		]);
		// (2*1+0)/3 = 0.67
		expect(greyValues(boxDownscale(grey(3, 1, [1, 0, 0]), 2, 1))).toEqual([
			1, 0,
		]);
	});

	it('weights 5 wide to 2 wide as 2:2:1 and 1:2:2', () => {
		expect(
			greyValues(boxDownscale(grey(5, 1, [10, 20, 30, 40, 50]), 2, 1)),
		).toEqual([18, 42]);
	});

	it('handles uneven sizes on both axes: 3x3 to 2x2', () => {
		const source = grey(3, 3, [0, 10, 20, 30, 40, 50, 60, 70, 80]);
		// Sums over 9: 120, 240, 480, 600 -> 13.33, 26.67, 53.33, 66.67
		expect(greyValues(boxDownscale(source, 2, 2))).toEqual([13, 27, 53, 67]);
	});

	it('scales the two axes independently: 2x3 to 2x2', () => {
		const source = grey(2, 3, [0, 100, 30, 130, 90, 190]);
		// Rows weighted 2:1 and 1:2 -> (0*2+30)/3, (100*2+130)/3, (30+180)/3, (130+380)/3
		expect(greyValues(boxDownscale(source, 2, 2))).toEqual([10, 110, 70, 170]);
	});

	it('does not bleed colour from a transparent pixel into an opaque neighbour', () => {
		const source = image(2, 1, [255, 0, 10, 255, 0, 100, 20, 0]);
		expect(bytes(boxDownscale(source, 1, 1))).toEqual([255, 0, 10, 128]);
	});

	it('outputs transparent black when all contributing pixels have zero alpha', () => {
		const source = image(2, 1, [100, 150, 200, 0, 50, 60, 70, 0]);
		expect(bytes(boxDownscale(source, 1, 1))).toEqual([0, 0, 0, 0]);
	});

	it('weights colour channels by partial alpha and rounds halves up', () => {
		// SumA = 50 + 150 = 200; R = (50*200)/200 = 50; G = (150*200)/200 = 150; A = 200/2 = 100
		const partial = image(2, 1, [200, 0, 0, 50, 0, 200, 0, 150]);
		expect(bytes(boxDownscale(partial, 1, 1))).toEqual([50, 150, 0, 100]);

		// Half-up rounding on colour channel: sumA = 2, sumR = 1 -> (2*1 + 2)/4 = 1
		const halfUp = image(2, 1, [1, 0, 0, 1, 0, 0, 0, 1]);
		expect(bytes(boxDownscale(halfUp, 1, 1))).toEqual([1, 0, 0, 1]);
	});

	it('is bit-identical to straight-alpha averaging on random opaque images', () => {
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 24}),
				fc.integer({min: 1, max: 24}),
				fc.integer({min: 1, max: 24}),
				fc.integer({min: 1, max: 24}),
				fc.integer({min: 0, max: 1000}),
				(a, b, c, d, seed) => {
					const sw = Math.max(a, b);
					const dw = Math.min(a, b);
					const sh = Math.max(c, d);
					const dh = Math.min(c, d);
					const source = opaqueNoiseImage(sw, sh, seed);
					expect(bytes(boxDownscale(source, dw, dh))).toEqual(
						straightReferenceDownscale(source, dw, dh),
					);
				},
			),
			{numRuns: 200},
		);
	});

	it('returns a copy when the size is unchanged', () => {
		const source = noiseImage(4, 3);
		const result = boxDownscale(source, 4, 3);
		expect(result).toEqual(source);
		expect(result.data).not.toBe(source.data);
	});

	it('does not modify its source', () => {
		const source = noiseImage(7, 5);
		const before = bytes(source);
		boxDownscale(source, 3, 2);
		expect(bytes(source)).toEqual(before);
	});

	it('rejects upscaling and sizes that are not positive integers', () => {
		const source = noiseImage(4, 4);
		expect(() => boxDownscale(source, 5, 4)).toThrow(RangeError);
		expect(() => boxDownscale(source, 4, 5)).toThrow(RangeError);
		expect(() => boxDownscale(source, 0, 2)).toThrow(RangeError);
		expect(() => boxDownscale(source, 2.5, 2)).toThrow(RangeError);
	});

	it('matches an exhaustive BigInt area average for random sizes', () => {
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 24}),
				fc.integer({min: 1, max: 24}),
				fc.integer({min: 1, max: 24}),
				fc.integer({min: 1, max: 24}),
				fc.integer({min: 0, max: 1000}),
				(a, b, c, d, seed) => {
					const sw = Math.max(a, b);
					const dw = Math.min(a, b);
					const sh = Math.max(c, d);
					const dh = Math.min(c, d);
					const source = noiseImage(sw, sh, seed);
					const result = boxDownscale(source, dw, dh);
					expect(result.width).toBe(dw);
					expect(result.height).toBe(dh);
					expect(bytes(result)).toEqual(referenceDownscale(source, dw, dh));
				},
			),
			{numRuns: 200},
		);
	});

	it('keeps a flat image flat at any size', () => {
		const flat = image(
			7,
			5,
			Array.from({length: 35}, () => [9, 200, 77, 255]).flat(),
		);
		const result = boxDownscale(flat, 3, 4);
		expect(bytes(result)).toEqual(
			Array.from({length: 12}, () => [9, 200, 77, 255]).flat(),
		);
	});
});
