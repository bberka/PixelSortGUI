import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vite-plus/test';
import type {RgbaImage} from '../../src/engine/types.ts';
import {getSyntheticFixture} from '../fixtures/synthetic.ts';
import {
	decodeRgbaPng,
	encodeRgbaPng,
	GOLDEN_ROOT,
	listGoldenCases,
	renderGoldenCase,
} from './helpers.ts';

const OUT_DIR = path.join(GOLDEN_ROOT, '.out');

type DiffSummary = {
	diffPixels: number;
	firstX: number;
	firstY: number;
	expectedRgba: [number, number, number, number];
	actualRgba: [number, number, number, number];
	diffImage: RgbaImage;
};

function compareImages(
	expected: RgbaImage,
	actual: RgbaImage,
): DiffSummary | undefined {
	if (expected.width !== actual.width || expected.height !== actual.height) {
		return undefined;
	}

	const {width, height} = expected;
	const diffData = new Uint8ClampedArray(width * height * 4);
	let diffPixels = 0;
	let firstX = -1;
	let firstY = -1;
	let expectedRgba: [number, number, number, number] = [0, 0, 0, 0];
	let actualRgba: [number, number, number, number] = [0, 0, 0, 0];

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const dr = Math.abs(expected.data[i] - actual.data[i]);
			const dg = Math.abs(expected.data[i + 1] - actual.data[i + 1]);
			const db = Math.abs(expected.data[i + 2] - actual.data[i + 2]);
			const da = Math.abs(expected.data[i + 3] - actual.data[i + 3]);

			if (dr !== 0 || dg !== 0 || db !== 0 || da !== 0) {
				diffPixels++;
				if (firstX === -1) {
					firstX = x;
					firstY = y;
					expectedRgba = [
						expected.data[i],
						expected.data[i + 1],
						expected.data[i + 2],
						expected.data[i + 3],
					];
					actualRgba = [
						actual.data[i],
						actual.data[i + 1],
						actual.data[i + 2],
						actual.data[i + 3],
					];
				}

				diffData[i] = 255;
				diffData[i + 1] = 0;
				diffData[i + 2] = 255;
			} else {
				diffData[i] = Math.floor(expected.data[i] / 4);
				diffData[i + 1] = Math.floor(expected.data[i + 1] / 4);
				diffData[i + 2] = Math.floor(expected.data[i + 2] / 4);
			}

			diffData[i + 3] = 255;
		}
	}

	if (diffPixels === 0) {
		return undefined;
	}

	return {
		diffPixels,
		firstX,
		firstY,
		expectedRgba,
		actualRgba,
		diffImage: {width, height, data: diffData},
	};
}

describe('fast-png lossless RGBA round-trip', () => {
	it('preserves exact RGBA bytes including transparency without premultiplying', () => {
		const alphaFixture = getSyntheticFixture('alpha-32x32');
		const roundTripped = decodeRgbaPng(encodeRgbaPng(alphaFixture));
		expect(roundTripped.width).toBe(alphaFixture.width);
		expect(roundTripped.height).toBe(alphaFixture.height);
		expect(roundTripped.data).toEqual(alphaFixture.data);

		const straightAlpha: RgbaImage = {
			width: 4,
			height: 1,
			data: new Uint8ClampedArray([
				200, 100, 50, 255, 200, 100, 50, 128, 200, 100, 50, 1, 200, 100, 50, 0,
			]),
		};
		const decodedStraight = decodeRgbaPng(encodeRgbaPng(straightAlpha));
		expect(decodedStraight.data).toEqual(straightAlpha.data);
	});
});

describe('golden images', () => {
	const cases = listGoldenCases();

	it('has golden cases on disk', () => {
		expect(cases.length).toBeGreaterThan(0);
	});

	for (const entry of cases) {
		it(entry.id, async () => {
			expect(
				fs.existsSync(entry.pngPath),
				`Missing golden PNG for ${entry.id}. Run "vp run golden:update" to generate it.`,
			).toBe(true);

			const expected = decodeRgbaPng(fs.readFileSync(entry.pngPath));
			const actual = await renderGoldenCase(entry.spec);

			if (
				expected.width !== actual.width ||
				expected.height !== actual.height
			) {
				throw new Error(
					`Golden mismatch in ${entry.id}: expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`,
				);
			}

			const diff = compareImages(expected, actual);
			if (!diff) {
				return;
			}

			fs.mkdirSync(OUT_DIR, {recursive: true});
			const safeName = entry.id.replaceAll('/', '__');
			fs.writeFileSync(
				path.join(OUT_DIR, `${safeName}.actual.png`),
				encodeRgbaPng(actual),
			);
			fs.writeFileSync(
				path.join(OUT_DIR, `${safeName}.diff.png`),
				encodeRgbaPng(diff.diffImage),
			);

			throw new Error(
				`Golden mismatch in ${entry.id}: ${diff.diffPixels} differing pixel(s); ` +
					`first difference at (${diff.firstX}, ${diff.firstY}) ` +
					`expected rgba(${diff.expectedRgba.join(',')}) vs actual rgba(${diff.actualRgba.join(',')})`,
			);
		});
	}
});
