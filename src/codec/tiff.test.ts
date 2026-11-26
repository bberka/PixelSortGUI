import {Buffer} from 'node:buffer';
import {deflateSync} from 'node:zlib';
import {describe, expect, it} from 'vite-plus/test';
import {tiffBytes, type TiffFixture} from '../../tests/fixtures/tiff.ts';
import {decodeImage, probeImageDimensions} from './decode.ts';
import {encodeImage} from './encode.ts';
import {applyOrientation, decodeTiff, encodeTiff, isTiff} from './tiff.ts';

const RGB_PIXELS = [10, 20, 30, 40, 50, 60];
const RGBA = [10, 20, 30, 255, 40, 50, 60, 255];

function tiffBlob(fixture: Partial<TiffFixture> = {}): Blob {
	return new Blob([
		tiffBytes({width: 2, height: 1, pixels: RGB_PIXELS, ...fixture}),
	]);
}

async function pixels(blob: Blob): Promise<number[]> {
	const decoded = await decodeImage(blob);
	if (!decoded.ok) {
		throw new Error(decoded.error.message);
	}

	return [...decoded.value.data];
}

describe('TIFF decode', () => {
	it.each([true, false])(
		'reads 8-bit RGB (little endian: %s) without a browser decoder',
		async (littleEndian) => {
			const blob = tiffBlob({littleEndian});
			expect(await isTiff(blob)).toBe(true);
			expect(await probeImageDimensions(blob)).toMatchObject({
				ok: true,
				value: {width: 2, height: 1},
			});
			expect(await pixels(blob)).toEqual(RGBA);
		},
	);

	it.each([true, false])(
		'keeps the high byte of 16-bit samples (little endian: %s)',
		async (littleEndian) => {
			const blob = tiffBlob({
				bits: 16,
				littleEndian,
				pixels: [0x0a_ff, 0x14_00, 0x1e_80, 0x28_01, 0x32_fe, 0x3c_7f],
			});
			expect(await pixels(blob)).toEqual(RGBA);
		},
	);

	it('reads 16-bit grayscale', async () => {
		const blob = tiffBlob({
			bits: 16,
			samples: 1,
			photometric: 1,
			pixels: [0x11_ff, 0xee_00],
		});
		expect(await pixels(blob)).toEqual([
			0x11, 0x11, 0x11, 255, 0xee, 0xee, 0xee, 255,
		]);
	});

	it('inflates a Deflate strip', async () => {
		const blob = tiffBlob({
			compression: 8,
			strip: deflateSync(Buffer.from(RGB_PIXELS)),
		});
		expect(await pixels(blob)).toEqual(RGBA);
	});

	it('turns associated alpha into straight alpha', async () => {
		const blob = tiffBlob({
			width: 1,
			samples: 4,
			pixels: [64, 32, 0, 128],
			extraTags: [[338, [1]]],
		});
		expect(await pixels(blob)).toEqual([128, 64, 0, 128]);
	});

	it('reports upright dimensions for a quarter-turned page', async () => {
		const blob = tiffBlob({orientation: 6});
		expect(await probeImageDimensions(blob)).toMatchObject({
			ok: true,
			value: {width: 1, height: 2},
		});
		const decoded = await decodeTiff(blob);
		expect(decoded).toMatchObject({width: 1, height: 2});
		expect([...decoded.data]).toEqual(RGBA);
	});

	it.each([
		['CCITT compression', {compression: 4}],
		['CMYK', {samples: 4, photometric: 5, pixels: [0, 0, 0, 0, 0, 0, 0, 0]}],
		['planar samples', {extraTags: [[284, [2]]]}],
		['float samples', {extraTags: [[339, [3]]]}],
		['a zero width', {width: 0}],
	] as const)('refuses %s as unsupported', async (_, fixture) => {
		const blob = tiffBlob(fixture);
		for (const result of [
			await probeImageDimensions(blob),
			await decodeImage(blob),
		]) {
			expect(result).toMatchObject({
				ok: false,
				error: {code: 'unsupported-format'},
			});
		}
	});

	it('refuses a truncated file and a bare header', async () => {
		const whole = tiffBytes({width: 2, height: 1, pixels: RGB_PIXELS});
		const strip = new Uint8Array(whole);
		// Point the single strip past the end of the file.
		new DataView(strip.buffer).setUint32(8 + 6 + 2 + 5 * 12 + 8, 5000, true);
		for (const bytes of [strip, whole.subarray(0, 8)]) {
			const result = await probeImageDimensions(new Blob([bytes]));
			expect(result.ok).toBe(false);
		}
	});

	it('stops at a directory chain that points back at itself', async () => {
		const bytes = tiffBytes({width: 2, height: 1, pixels: RGB_PIXELS});
		const view = new DataView(bytes.buffer);
		const directory = view.getUint32(4, true);
		const next = directory + 2 + view.getUint16(directory, true) * 12;
		view.setUint32(next, directory, true);

		expect(await pixels(new Blob([bytes]))).toEqual(RGBA);
	});

	it('applies the size limit before decoding pixels', async () => {
		const result = await decodeImage(tiffBlob({width: 20_000}));
		expect(result).toMatchObject({ok: false, error: {code: 'too-large'}});
	});
});

describe('applyOrientation', () => {
	// A 3 x 2 image whose red channel numbers the stored pixels:
	// 0 1 2
	// 3 4 5
	const stored = {
		width: 3,
		height: 2,
		data: new Uint8ClampedArray(
			[0, 1, 2, 3, 4, 5].flatMap((value) => [value, 0, 0, 255]),
		),
	};

	it.each([
		[1, 3, [0, 1, 2, 3, 4, 5]],
		[2, 3, [2, 1, 0, 5, 4, 3]],
		[3, 3, [5, 4, 3, 2, 1, 0]],
		[4, 3, [3, 4, 5, 0, 1, 2]],
		[5, 2, [0, 3, 1, 4, 2, 5]],
		[6, 2, [3, 0, 4, 1, 5, 2]],
		[7, 2, [5, 2, 4, 1, 3, 0]],
		[8, 2, [2, 5, 1, 4, 0, 3]],
	])('turns orientation %i upright', (orientation, width, expected) => {
		const result = applyOrientation(stored, orientation);
		expect(result.width).toBe(width);
		expect([...result.data].filter((_, index) => index % 4 === 0)).toEqual(
			expected,
		);
	});
});

describe('uncompressed export', () => {
	const image = {
		width: 200,
		height: 100,
		data: new Uint8ClampedArray(200 * 100 * 4).fill(255),
	};

	it('writes an RGBA TIFF that decodes to the same pixels, with no EXIF or GPS', async () => {
		const data = new Uint8ClampedArray([9, 8, 7, 6, 5, 4, 3, 255]);
		const buffer = await encodeTiff({width: 2, height: 1, data});

		expect([...new Uint8Array(buffer, 0, 4)]).toEqual([0x4d, 0x4d, 0, 42]);
		const view = new DataView(buffer);
		const directory = view.getUint32(4);
		const tags = Array.from({length: view.getUint16(directory)}, (_, index) =>
			view.getUint16(directory + 2 + index * 12),
		);
		// EXIF, GPS, XMP, IPTC, Photoshop and ICC profile tags.
		for (const metadata of [34_665, 34_853, 700, 33_723, 34_377, 34_675]) {
			expect(tags).not.toContain(metadata);
		}

		expect([...(await decodeTiff(new Blob([buffer]))).data]).toEqual([...data]);
	});

	it.each([
		['bmp', 'image/bmp', 54 + 200 * 100 * 3],
		['tiff', 'image/tiff', 1000 + 200 * 100 * 4],
	] as const)(
		'encodes %s at the exact size without a canvas',
		async (format, mime, size) => {
			const result = await encodeImage(image, {format});
			expect(result).toMatchObject({
				ok: true,
				value: {width: 200, height: 100, mime, targetMet: true},
			});
			if (!result.ok) {
				return;
			}

			expect(result.value.blob.size).toBe(size);
			expect(result.value.effectiveQuality).toBeUndefined();
		},
	);

	it.each(['bmp', 'tiff'] as const)(
		'scales %s down to fit a size limit',
		async (format) => {
			const maxBytes = 40_000;
			const result = await encodeImage(image, {format, maxBytes});
			if (!result.ok) {
				throw new Error(result.error.message);
			}

			const {blob, width, height, targetMet} = result.value;
			expect(targetMet).toBe(true);
			expect(blob.size).toBeLessThanOrEqual(maxBytes);
			expect(blob.size).toBeGreaterThan(maxBytes * 0.9);
			expect(width / height).toBeCloseTo(2, 0);
		},
	);

	it('stops at a 64 px shortest side and reports the missed target', async () => {
		const result = await encodeImage(image, {format: 'bmp', maxBytes: 100});
		expect(result).toMatchObject({
			ok: true,
			value: {height: 64, targetMet: false},
		});
	});
});
