import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vite-plus/test';
import {
	renderSampleImage,
	SAMPLE_HEIGHT,
	SAMPLE_WIDTH,
} from './sample-image.ts';

const digest = (data: Uint8ClampedArray) =>
	createHash('sha256').update(data).digest('hex');

describe('renderSampleImage', () => {
	it('defaults to an opaque 1200 x 900 picture (AC-F2.10)', () => {
		const image = renderSampleImage();

		expect([image.width, image.height]).toEqual([SAMPLE_WIDTH, SAMPLE_HEIGHT]);
		expect([SAMPLE_WIDTH, SAMPLE_HEIGHT]).toEqual([1200, 900]);
		expect(image.data).toHaveLength(1200 * 900 * 4);
		expect(
			image.data.every((value, index) => index % 4 !== 3 || value === 255),
		).toBe(true);
	});

	it('is the same on every call, so a second sample reuses the stored source', () => {
		expect(digest(renderSampleImage(160, 120).data)).toBe(
			digest(renderSampleImage(160, 120).data),
		);
	});

	it('spans dark and bright areas for the pixel sort threshold to select', () => {
		const {data} = renderSampleImage(160, 120);
		let dark = 0;
		let bright = 0;
		for (let offset = 0; offset < data.length; offset += 4) {
			const luma =
				(data[offset] * 54 + data[offset + 1] * 183 + data[offset + 2] * 19) /
				256;
			dark += luma < 64 ? 1 : 0;
			bright += luma > 160 ? 1 : 0;
		}

		const pixels = data.length / 4;
		expect(dark / pixels).toBeGreaterThan(0.15);
		expect(bright / pixels).toBeGreaterThan(0.03);
	});
});
