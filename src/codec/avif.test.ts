import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {describe, expect, it} from 'vite-plus/test';
import {createAvifEncoder} from './avif.ts';
import {encodeImage, type AvifEncoder} from './encode.ts';

function gradient(width: number, height: number) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data.set([i % 251, (i * 7) % 253, 90, 255], i);
	}

	return {width, height, data};
}

// An encoder whose output shrinks with quality and pixel count, so a size limit
// has something to search.
function fakeEncoder() {
	const calls: Array<{width: number; height: number; quality: number}> = [];
	const encodeAvif: AvifEncoder = async ({width, height}, quality) => {
		calls.push({width, height, quality});
		return new Uint8Array(width * height * quality);
	};

	return {calls, encodeAvif};
}

describe('AVIF encoding through encodeImage', () => {
	it('passes the pixels and quality to the encoder without touching a canvas', async () => {
		const {calls, encodeAvif} = fakeEncoder();
		const result = await encodeImage(gradient(4, 3), {
			format: 'avif',
			quality: 80,
			encodeAvif,
		});
		expect(calls).toEqual([{width: 4, height: 3, quality: 80}]);
		expect(result.ok && result.value).toMatchObject({
			mime: 'image/avif',
			width: 4,
			height: 3,
			effectiveQuality: 80,
			targetMet: true,
		});
		expect(result.ok && result.value.blob.type).toBe('image/avif');
	});

	it('searches quality for the highest one under the size limit', async () => {
		const {encodeAvif} = fakeEncoder();
		const result = await encodeImage(gradient(10, 10), {
			format: 'avif',
			quality: 80,
			maxBytes: 4250,
			encodeAvif,
		});
		expect(result.ok && result.value).toMatchObject({
			width: 10,
			height: 10,
			effectiveQuality: 42,
			targetMet: true,
		});
	});

	it('scales the image down when the quality floor is still too large', async () => {
		const {calls, encodeAvif} = fakeEncoder();
		const result = await encodeImage(gradient(200, 100), {
			format: 'avif',
			quality: 80,
			maxBytes: 100_000,
			encodeAvif,
		});
		if (!result.ok) {
			throw new Error(result.error.message);
		}

		expect(result.value.width).toBeLessThan(200);
		expect(result.value.height).toBeGreaterThanOrEqual(64);
		expect(result.value.blob.size).toBeLessThanOrEqual(100_000);
		expect(calls.at(-1)?.width).toBeLessThan(200);
	});

	it('refuses AVIF when no encoder is provided', async () => {
		const result = await encodeImage(gradient(1, 1), {format: 'avif'});
		expect(!result.ok && result.error.code).toBe('unsupported-format');
	});

	it.each([
		[new Error('The AVIF encoder produced no output.'), 'encode-failed'],
		[new RangeError('Array buffer allocation failed'), 'out-of-memory'],
	])('reports an encoder failure (%s)', async (failure, code) => {
		const result = await encodeImage(gradient(1, 1), {
			format: 'avif',
			async encodeAvif() {
				throw failure;
			},
		});
		expect(!result.ok && result.error.code).toBe(code);
	});
});

describe('createAvifEncoder', () => {
	it('writes an AVIF file with the Wasm encoder, smaller at lower quality', async () => {
		const wasm = createRequire(import.meta.url).resolve(
			'@jsquash/avif/codec/enc/avif_enc.wasm',
		);
		const encode = createAvifEncoder({wasmBinary: await readFile(wasm)});
		const image = gradient(33, 17);
		const high = await encode(image, 90);
		const low = await encode(image, 20);
		const text = new TextDecoder('latin1').decode(high);
		expect(text.slice(4, 12)).toBe('ftypavif');
		// The image size box holds the dimensions as two big-endian integers.
		const size = text.indexOf('ispe') + 8;
		const view = new DataView(high.buffer, high.byteOffset);
		expect([view.getUint32(size), view.getUint32(size + 4)]).toEqual([33, 17]);
		expect(text).not.toContain('Exif');
		expect(low.length).toBeLessThan(high.length);
	});
});
