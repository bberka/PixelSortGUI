/* eslint-disable no-bitwise -- fixture generation extracts byte channels from uint32 hash32 values */
import {hash32} from '../../src/engine/random.ts';
import type {RgbaImage} from '../../src/engine/types.ts';

export type SyntheticFixtureName =
	'gradient-64x48' | 'noise-97x61' | 'bands-80x80' | 'alpha-32x32';

const SEED_GRADIENT = 0x10_01;
const SEED_NOISE = 0x20_02;
const SEED_BANDS = 0x30_03;
const SEED_ALPHA = 0x40_04;

export function createGradient64x48(): RgbaImage {
	const width = 64;
	const height = 48;
	const data = new Uint8ClampedArray(width * height * 4);
	const maxSum = width - 1 + (height - 1);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const h = hash32(SEED_GRADIENT, x, y);
			const jitter = (h & 7) - 3;
			const diag = Math.floor(((x + y) * 255) / maxSum);
			const p = (y * width + x) * 4;
			data[p] = Math.min(
				255,
				Math.max(0, Math.floor((x * 255) / (width - 1)) + jitter),
			);
			data[p + 1] = Math.min(
				255,
				Math.max(0, Math.floor((y * 255) / (height - 1)) + jitter),
			);
			data[p + 2] = Math.min(255, Math.max(0, 255 - diag + jitter));
			data[p + 3] = 255;
		}
	}

	return {width, height, data};
}

export function createNoise97x61(): RgbaImage {
	const width = 97;
	const height = 61;
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const h = hash32(SEED_NOISE, x, y);
			const p = (y * width + x) * 4;
			data[p] = h & 0xff;
			data[p + 1] = (h >>> 8) & 0xff;
			data[p + 2] = (h >>> 16) & 0xff;
			data[p + 3] = 255;
		}
	}

	return {width, height, data};
}

export function createBands80x80(): RgbaImage {
	const width = 80;
	const height = 80;
	const data = new Uint8ClampedArray(width * height * 4);
	const bandHeight = 10;

	for (let y = 0; y < height; y++) {
		const band = Math.floor(y / bandHeight);
		const isSeparator = y % bandHeight === bandHeight - 1;
		const baseGrey = Math.floor((band * 255) / 7);

		for (let x = 0; x < width; x++) {
			const p = (y * width + x) * 4;
			if (isSeparator) {
				data[p] = 0;
				data[p + 1] = 0;
				data[p + 2] = 0;
			} else {
				const h = hash32(SEED_BANDS, x, y);
				const delta = (h & 3) - 1;
				const grey = Math.min(255, Math.max(0, baseGrey + delta));
				data[p] = grey;
				data[p + 1] = grey;
				data[p + 2] = grey;
			}

			data[p + 3] = 255;
		}
	}

	return {width, height, data};
}

export function createAlpha32x32(): RgbaImage {
	const width = 32;
	const height = 32;
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const p = (y * width + x) * 4;
			const isTransparentQuarter = x >= width / 2 && y >= height / 2;
			if (isTransparentQuarter) {
				data[p] = 0;
				data[p + 1] = 0;
				data[p + 2] = 0;
				data[p + 3] = 0;
				continue;
			}

			const h = hash32(SEED_ALPHA, x, y);
			const jitter = (h & 3) - 1;
			data[p] = Math.min(
				255,
				Math.max(0, Math.floor((x * 255) / (width - 1)) + jitter),
			);
			data[p + 1] = Math.min(
				255,
				Math.max(0, Math.floor((y * 255) / (height - 1)) + jitter),
			);
			data[p + 2] = Math.min(
				255,
				Math.max(
					0,
					Math.floor(((x + y) * 255) / (width + height - 2)) + jitter,
				),
			);
			data[p + 3] = 255;
		}
	}

	return {width, height, data};
}

export const SYNTHETIC_FIXTURES: Readonly<
	Record<SyntheticFixtureName, () => RgbaImage>
> = {
	'gradient-64x48': createGradient64x48,
	'noise-97x61': createNoise97x61,
	'bands-80x80': createBands80x80,
	'alpha-32x32': createAlpha32x32,
};

export function getSyntheticFixture(name: SyntheticFixtureName): RgbaImage {
	return SYNTHETIC_FIXTURES[name]();
}
