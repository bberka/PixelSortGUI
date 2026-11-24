import {describe, expect, it, vi} from 'vite-plus/test';
import type {RgbaImage} from '../engine/types.ts';
import {
	encodeImage,
	flattenAlphaForJpeg,
	probeEncodeFormat,
	probeSupportedEncodeFormats,
	type EncodeCanvas,
	type EncodeRuntime,
} from './encode.ts';

function makeImage(width: number, height: number, pixels: number[]): RgbaImage {
	return {width, height, data: new Uint8ClampedArray(pixels)};
}

function makeFakeEncodeRuntime(options?: {
	returnMime?: string | ((requestedType: string | undefined) => string);
	nullContext?: boolean;
	throwOnConvert?: Error;
}): {
	runtime: EncodeRuntime;
	canvas: EncodeCanvas;
	putImageData: ReturnType<typeof vi.fn>;
	convertToBlob: ReturnType<typeof vi.fn>;
} {
	const putImageData = vi.fn();
	const convertToBlob = vi.fn(async (encodeOptions?: ImageEncodeOptions) => {
		if (options?.throwOnConvert) {
			throw options.throwOnConvert;
		}

		const mime =
			typeof options?.returnMime === 'function'
				? options.returnMime(encodeOptions?.type)
				: (options?.returnMime ?? encodeOptions?.type ?? 'image/png');
		return new Blob(['encoded'], {type: mime});
	});

	const canvas: EncodeCanvas = {
		width: 1,
		height: 1,
		getContext() {
			return options?.nullContext ? null : {putImageData};
		},
		convertToBlob,
	};

	const runtime: EncodeRuntime = {
		createCanvas: () => canvas,
		createImageData: (data, width, height) => ({
			data,
			width,
			height,
			colorSpace: 'srgb',
		}),
	};

	return {runtime, canvas, putImageData, convertToBlob};
}

describe('flattenAlphaForJpeg', () => {
	it('composites transparent and semi-transparent pixels over the background color', () => {
		const image = makeImage(
			3,
			1,
			[100, 150, 200, 255, 100, 150, 200, 0, 0, 0, 0, 128],
		);

		const flattened = flattenAlphaForJpeg(image, [255, 255, 255]);
		expect(Array.from(flattened)).toEqual([
			100, 150, 200, 255, 255, 255, 255, 255, 127, 127, 127, 255,
		]);
	});
});

describe('encodeImage', () => {
	it('encodes PNG without quality and shrinks the canvas to 1x1', async () => {
		const {runtime, canvas, convertToBlob} = makeFakeEncodeRuntime();
		const image = makeImage(2, 1, [1, 2, 3, 255, 4, 5, 6, 255]);

		const result = await encodeImage(image, {format: 'png'}, runtime);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.mime).toBe('image/png');
			expect(result.value.width).toBe(2);
			expect(result.value.height).toBe(1);
		}

		expect(convertToBlob).toHaveBeenCalledWith({type: 'image/png'});
		expect(canvas.width).toBe(1);
		expect(canvas.height).toBe(1);
	});

	it('normalizes JPEG quality from 0..100 to 0..1 with default 92', async () => {
		const {runtime, convertToBlob} = makeFakeEncodeRuntime();
		const image = makeImage(1, 1, [10, 20, 30, 255]);

		await encodeImage(image, {format: 'jpeg'}, runtime);
		expect(convertToBlob).toHaveBeenLastCalledWith({
			type: 'image/jpeg',
			quality: 0.92,
		});

		await encodeImage(image, {format: 'jpeg', quality: 80}, runtime);
		expect(convertToBlob).toHaveBeenLastCalledWith({
			type: 'image/jpeg',
			quality: 0.8,
		});
	});

	it('returns unsupported-format when the browser silently falls back to PNG', async () => {
		const {runtime, canvas} = makeFakeEncodeRuntime({
			returnMime: 'image/png',
		});
		const image = makeImage(1, 1, [10, 20, 30, 255]);

		const result = await encodeImage(image, {format: 'webp'}, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('unsupported-format');
		}

		expect(canvas.width).toBe(1);
		expect(canvas.height).toBe(1);
	});

	it('returns out-of-memory when context allocation fails or convertToBlob throws RangeError', async () => {
		const image = makeImage(1, 1, [10, 20, 30, 255]);

		const nullCtx = makeFakeEncodeRuntime({nullContext: true});
		const r1 = await encodeImage(image, {format: 'png'}, nullCtx.runtime);
		expect(r1.ok).toBe(false);
		if (!r1.ok) {
			expect(r1.error.code).toBe('out-of-memory');
		}

		const oom = makeFakeEncodeRuntime({
			throwOnConvert: new RangeError('Allocation failed'),
		});
		const r2 = await encodeImage(image, {format: 'png'}, oom.runtime);
		expect(r2.ok).toBe(false);
		if (!r2.ok) {
			expect(r2.error.code).toBe('out-of-memory');
		}
	});
});

describe('probeEncodeFormat & probeSupportedEncodeFormats', () => {
	it('detects when WebP falls back to PNG', async () => {
		const {runtime} = makeFakeEncodeRuntime({
			returnMime: (requested) =>
				requested === 'image/webp' ? 'image/png' : (requested ?? 'image/png'),
		});

		expect(await probeEncodeFormat('webp', runtime)).toBe(false);
		expect(await probeSupportedEncodeFormats(runtime)).toEqual({
			png: true,
			jpeg: true,
			webp: false,
		});
	});
});
