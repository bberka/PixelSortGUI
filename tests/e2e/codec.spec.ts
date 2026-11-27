import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import path from 'node:path';
import {expect, test, type Page} from '@playwright/test';
import type * as DecodeModule from '../../src/codec/decode.ts';
import type * as EncodeModule from '../../src/codec/encode.ts';

const sourceDir = path.resolve(import.meta.dirname, '../../src');

// `decode.ts`, `encode.ts` and everything they import statically.
const CODEC_MODULES = [
	'codec/decode.ts',
	'codec/encode.ts',
	'codec/bmp-writer.ts',
	'codec/tiff.ts',
	'engine/math.ts',
	'engine/render-size.ts',
	'engine/resample.ts',
	'engine/types.ts',
];

async function mountCodecModules(page: Page): Promise<void> {
	for (const file of CODEC_MODULES) {
		const source = fs.readFileSync(path.join(sourceDir, file), 'utf8');
		// Every module is served from one folder.
		const body = stripTypeScriptTypes(source, {mode: 'strip'}).replaceAll(
			/'(?:\.|\.\.\/engine)\/([\w-]+)\.ts'/g,
			"'./$1.js'",
		);
		await page.route(
			`**/__codec-test/${path.basename(file, '.ts')}.js`,
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: 'application/javascript; charset=utf-8',
					body,
				});
			},
		);
	}
}

test.describe('native worker codec in real browsers', () => {
	test('PNG lossless round-trip, EXIF orientation 6, corrupt file, WebP probe, reduced-size decode, and EXIF stripping', async ({
		page,
	}, testInfo) => {
		await mountCodecModules(page);
		await page.goto('/');

		const results = await page.evaluate(async () => {
			const decodeUrl = '/__codec-test/decode.js';
			const encodeUrl = '/__codec-test/encode.js';
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- dynamic route module loaded in browser
			const decodeMod: typeof DecodeModule = await import(decodeUrl);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- dynamic route module loaded in browser
			const encodeMod: typeof EncodeModule = await import(encodeUrl);

			const {decodeImage, probeImageDimensions, renderSizeForExport} =
				decodeMod;
			const {encodeImage, probeSupportedEncodeFormats} = encodeMod;

			// 1. Opaque PNG lossless round-trip
			const w = 32;
			const h = 24;
			const opaquePixels = new Uint8ClampedArray(w * h * 4);
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					const i = (y * w + x) * 4;
					opaquePixels[i] = (x * 8) % 256;
					opaquePixels[i + 1] = (y * 10) % 256;
					opaquePixels[i + 2] = ((x + y) * 7) % 256;
					opaquePixels[i + 3] = 255;
				}
			}

			const encodedPng = await encodeImage(
				{width: w, height: h, data: opaquePixels},
				{format: 'png'},
			);
			if (!encodedPng.ok) {
				throw new Error(`PNG encode failed: ${encodedPng.error.message}`);
			}

			const decodedPng = await decodeImage(encodedPng.value.blob);
			if (!decodedPng.ok) {
				throw new Error(`PNG decode failed: ${decodedPng.error.message}`);
			}

			let opaqueDiffCount = 0;
			for (const [i, opaquePixel] of opaquePixels.entries()) {
				if (opaquePixel !== decodedPng.value.data[i]) {
					opaqueDiffCount++;
				}
			}

			// 1b. Semi-transparent PNG round-trip (measure premultiplied alpha behavior)
			const alphaPixels = new Uint8ClampedArray([
				200,
				100,
				50,
				255, // Opaque
				200,
				100,
				50,
				128, // Semi-transparent
				200,
				100,
				50,
				1, // Near-transparent
				200,
				100,
				50,
				0, // Fully transparent
			]);
			const encodedAlphaPng = await encodeImage(
				{width: 4, height: 1, data: alphaPixels},
				{format: 'png'},
			);
			if (!encodedAlphaPng.ok) {
				throw new Error('Alpha PNG encode failed');
			}

			const decodedAlphaPng = await decodeImage(encodedAlphaPng.value.blob);
			if (!decodedAlphaPng.ok) {
				throw new Error('Alpha PNG decode failed');
			}

			// 2. EXIF orientation 6 (90 deg CW) JPEG
			const exifW = 40;
			const exifH = 20;
			const exifSrc = new Uint8ClampedArray(exifW * exifH * 4);
			for (let y = 0; y < exifH; y++) {
				for (let x = 0; x < exifW; x++) {
					const i = (y * exifW + x) * 4;
					// Top-left half is bright red, rest is dark blue
					const isTopLeft = x < 20 && y < 10;
					exifSrc[i] = isTopLeft ? 240 : 10;
					exifSrc[i + 1] = 20;
					exifSrc[i + 2] = isTopLeft ? 10 : 240;
					exifSrc[i + 3] = 255;
				}
			}

			const baseJpeg = await encodeImage(
				{width: exifW, height: exifH, data: exifSrc},
				{format: 'jpeg', quality: 95},
			);
			if (!baseJpeg.ok) {
				throw new Error('Base JPEG encode failed');
			}

			const baseJpegBytes = new Uint8Array(
				await baseJpeg.value.blob.arrayBuffer(),
			);
			// Minimal APP1 EXIF segment with Orientation = 6 (little-endian TIFF)
			const exifApp1 = new Uint8Array([
				0xff,
				0xe1,
				0x00,
				0x22, // APP1 marker + length (34 bytes)
				0x45,
				0x78,
				0x69,
				0x66,
				0x00,
				0x00, // "Exif\0\0"
				0x49,
				0x49,
				0x2a,
				0x00, // Little-endian TIFF header
				0x08,
				0x00,
				0x00,
				0x00, // IFD0 offset = 8
				0x01,
				0x00, // 1 IFD entry
				0x12,
				0x01, // Tag 0x0112 (Orientation)
				0x03,
				0x00, // Type SHORT (3)
				0x01,
				0x00,
				0x00,
				0x00, // Count = 1
				0x06,
				0x00,
				0x00,
				0x00, // Value = 6 (Rotate 90 CW)
				0x00,
				0x00,
				0x00,
				0x00, // Next IFD = 0
			]);
			const jpegWithExif = new Uint8Array(
				baseJpegBytes.length + exifApp1.length,
			);
			jpegWithExif.set(baseJpegBytes.subarray(0, 2), 0);
			jpegWithExif.set(exifApp1, 2);
			jpegWithExif.set(baseJpegBytes.subarray(2), 2 + exifApp1.length);

			const exifBlob = new Blob([jpegWithExif], {type: 'image/jpeg'});
			const probedExif = await probeImageDimensions(exifBlob);
			const decodedExif = await decodeImage(exifBlob);

			// After rotating 40x20 by 90 deg CW -> 20x40; original top-left (red) moves to top-right
			let topRightRed = false;
			if (decodedExif.ok) {
				const px = (5 * decodedExif.value.width + 15) * 4;
				topRightRed =
					decodedExif.value.data[px] > 180 &&
					decodedExif.value.data[px + 2] < 80;
			}

			// 3. Re-encoded JPEG and PNG contain no EXIF segment
			const reencodedJpeg = decodedExif.ok
				? await encodeImage(decodedExif.value, {format: 'jpeg', quality: 92})
				: undefined;
			let exportedJpegHasExif = true;
			if (reencodedJpeg?.ok) {
				const bytes = new Uint8Array(
					await reencodedJpeg.value.blob.arrayBuffer(),
				);
				exportedJpegHasExif = false;
				for (let i = 0; i < bytes.length - 5; i++) {
					if (
						bytes[i] === 0xff &&
						bytes[i + 1] === 0xe1 &&
						bytes[i + 4] === 0x45 &&
						bytes[i + 5] === 0x78
					) {
						exportedJpegHasExif = true;
						break;
					}
				}
			}

			const pngBytes = new Uint8Array(
				await encodedPng.value.blob.arrayBuffer(),
			);
			let exportedPngHasExif = false;
			for (let i = 0; i < pngBytes.length - 3; i++) {
				if (
					pngBytes[i] === 0x65 &&
					pngBytes[i + 1] === 0x58 &&
					pngBytes[i + 2] === 0x49 &&
					pngBytes[i + 3] === 0x66
				) {
					exportedPngHasExif = true;
					break;
				}
			}

			// 4. Truncated file gives decode-failed
			const truncatedBlob = new Blob([pngBytes.subarray(0, 24)], {
				type: 'image/png',
			});
			const truncatedResult = await decodeImage(truncatedBlob);

			// 5. WebP probe agrees with encodeImage
			const formats = await probeSupportedEncodeFormats();
			const webpEncode = await encodeImage(
				{width: w, height: h, data: opaquePixels},
				{format: 'webp', quality: 90},
			);

			// 6. Reduced-size decode matches renderSizeForExport
			const bigW = 401;
			const bigH = 301;
			const bigPixels = new Uint8ClampedArray(bigW * bigH * 4).fill(128);
			const bigPng = await encodeImage(
				{width: bigW, height: bigH, data: bigPixels},
				{format: 'png'},
			);
			if (!bigPng.ok) {
				throw new Error('401x301 PNG encode failed');
			}

			const halfTarget = renderSizeForExport(bigW, bigH, {kind: 'half'});
			const decodedHalf = await decodeImage(bigPng.value.blob, {
				resizeWidth: halfTarget.width,
				resizeHeight: halfTarget.height,
			});

			return {
				opaqueDiffCount,
				alphaDecoded: Array.from(decodedAlphaPng.value.data),
				probedExif: probedExif.ok ? probedExif.value : probedExif.error,
				decodedExifSize: decodedExif.ok
					? {width: decodedExif.value.width, height: decodedExif.value.height}
					: decodedExif.error,
				topRightRed,
				exportedJpegHasExif,
				exportedPngHasExif,
				truncatedCode: truncatedResult.ok ? 'ok' : truncatedResult.error.code,
				formats,
				webpOk: webpEncode.ok,
				webpMime: webpEncode.ok ? webpEncode.value.mime : webpEncode.error.code,
				halfTarget,
				decodedHalfSize: decodedHalf.ok
					? {width: decodedHalf.value.width, height: decodedHalf.value.height}
					: decodedHalf.error,
			};
		});

		expect(results.opaqueDiffCount).toBe(0);
		expect(results.probedExif).toEqual({
			width: 20,
			height: 40,
			exceedsGuaranteedArea: false,
		});
		expect(results.decodedExifSize).toEqual({width: 20, height: 40});
		expect(results.topRightRed).toBe(true);
		expect(results.exportedJpegHasExif).toBe(false);
		expect(results.exportedPngHasExif).toBe(false);
		expect(results.truncatedCode).toBe('decode-failed');
		expect(results.formats.png).toBe(true);
		expect(results.formats.jpeg).toBe(true);
		expect(results.webpOk).toBe(results.formats.webp);
		if (results.formats.webp) {
			expect(results.webpMime).toBe('image/webp');
		}

		expect(results.halfTarget).toEqual({
			width: 200,
			height: 150,
			scale: 200 / 401,
		});
		expect(results.decodedHalfSize).toEqual({width: 200, height: 150});

		console.log(
			`[codec-findings:${testInfo.project.name}] opaqueDiff=${results.opaqueDiffCount} alphaDecoded=${JSON.stringify(results.alphaDecoded)} webpSupported=${results.formats.webp}`,
		);
	});

	test('measures 12 MP PNG and JPEG decode and encode times', async ({
		page,
	}, testInfo) => {
		await mountCodecModules(page);
		await page.goto('/');

		const timings = await page.evaluate(async () => {
			const decodeUrl = '/__codec-test/decode.js';
			const encodeUrl = '/__codec-test/encode.js';
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- dynamic route module loaded in browser
			const decodeMod: typeof DecodeModule = await import(decodeUrl);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- dynamic route module loaded in browser
			const encodeMod: typeof EncodeModule = await import(encodeUrl);

			const width = 4000;
			const height = 3000;
			const data = new Uint8ClampedArray(width * height * 4);
			for (let y = 0; y < height; y++) {
				const rowOffset = y * width * 4;
				for (let x = 0; x < width; x++) {
					const i = rowOffset + x * 4;
					data[i] = (x + y) % 256;
					data[i + 1] = (x * 3 + y) % 256;
					data[i + 2] = (x + y * 5) % 256;
					data[i + 3] = 255;
				}
			}

			const image = {width, height, data};

			const t0 = performance.now();
			const pngEncoded = await encodeMod.encodeImage(image, {format: 'png'});
			if (!pngEncoded.ok) {
				throw new Error(`12 MP PNG encode failed: ${pngEncoded.error.message}`);
			}

			const pngEncodeMs = performance.now() - t0;

			const t1 = performance.now();
			const pngDecoded = await decodeMod.decodeImage(pngEncoded.value.blob);
			if (!pngDecoded.ok) {
				throw new Error(`12 MP PNG decode failed: ${pngDecoded.error.message}`);
			}

			const pngDecodeMs = performance.now() - t1;

			const t2 = performance.now();
			const jpegEncoded = await encodeMod.encodeImage(image, {
				format: 'jpeg',
				quality: 92,
			});
			if (!jpegEncoded.ok) {
				throw new Error(
					`12 MP JPEG encode failed: ${jpegEncoded.error.message}`,
				);
			}

			const jpegEncodeMs = performance.now() - t2;

			const t3 = performance.now();
			const jpegDecoded = await decodeMod.decodeImage(jpegEncoded.value.blob);
			if (!jpegDecoded.ok) {
				throw new Error(
					`12 MP JPEG decode failed: ${jpegDecoded.error.message}`,
				);
			}

			const jpegDecodeMs = performance.now() - t3;

			return {
				pngEncodeMs: Math.round(pngEncodeMs * 10) / 10,
				pngDecodeMs: Math.round(pngDecodeMs * 10) / 10,
				pngBytes: pngEncoded.value.blob.size,
				jpegEncodeMs: Math.round(jpegEncodeMs * 10) / 10,
				jpegDecodeMs: Math.round(jpegDecodeMs * 10) / 10,
				jpegBytes: jpegEncoded.value.blob.size,
				decodedWidth: pngDecoded.value.width,
				decodedHeight: pngDecoded.value.height,
			};
		});

		expect(timings.decodedWidth).toBe(4000);
		expect(timings.decodedHeight).toBe(3000);

		console.log(
			`[codec-12mp:${testInfo.project.name}] PNG encode=${timings.pngEncodeMs}ms decode=${timings.pngDecodeMs}ms (${timings.pngBytes} B) | JPEG encode=${timings.jpegEncodeMs}ms decode=${timings.jpegDecodeMs}ms (${timings.jpegBytes} B)`,
		);
	});
});
