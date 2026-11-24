import {describe, expect, it, vi} from 'vite-plus/test';
import {
	checkDimensionLimits,
	checkFileSizeLimit,
	decodeImage,
	GUARANTEED_MAX_PIXELS,
	MAX_FILE_SIZE_BYTES,
	MAX_LONGEST_SIDE,
	probeImageDimensions,
	renderSize,
	renderSizeForExport,
	renderSizeForPixelCap,
	type DecodeCanvas,
	type DecodeRuntime,
} from './decode.ts';

function makeFakeCanvas(
	pixels?: Uint8ClampedArray,
	options?: {nullContext?: boolean; throwOnGetImageData?: Error},
): {canvas: DecodeCanvas; drawImage: ReturnType<typeof vi.fn>} {
	const drawImage = vi.fn();
	const canvas: DecodeCanvas = {
		width: 1,
		height: 1,
		getContext() {
			if (options?.nullContext) {
				return null;
			}

			return {
				drawImage,
				getImageData(_sx, _sy, sw, sh) {
					if (options?.throwOnGetImageData) {
						throw options.throwOnGetImageData;
					}

					const data = pixels ?? new Uint8ClampedArray(sw * sh * 4);
					return {width: sw, height: sh, data, colorSpace: 'srgb'} as ImageData;
				},
			};
		},
	};
	return {canvas, drawImage};
}

describe('renderSize', () => {
	it('computes half of 4001x3001 as 2000x1500', () => {
		const size = renderSize(4001, 3001, 0.5);
		expect(size.width).toBe(2000);
		expect(size.height).toBe(1500);
		expect(size.scale).toBe(2000 / 4001);
	});

	it('clamps tiny scaled dimensions to at least 1x1', () => {
		const size = renderSize(10, 5, 0.01);
		expect(size.width).toBe(1);
		expect(size.height).toBe(1);
		expect(size.scale).toBe(0.1);
	});

	it('rejects invalid dimensions or scale', () => {
		expect(() => renderSize(0, 100, 1)).toThrow(RangeError);
		expect(() => renderSize(100, 100, 0)).toThrow(RangeError);
		expect(() => renderSize(100, 100, 1.5)).toThrow(RangeError);
	});
});

describe('renderSizeForPixelCap', () => {
	it('keeps images already under the cap at full size', () => {
		const size = renderSizeForPixelCap(1000, 1000, 4_194_304);
		expect(size).toEqual({width: 1000, height: 1000, scale: 1});
	});

	it('scales down images above the cap', () => {
		const size = renderSizeForPixelCap(4000, 3000, 4_194_304);
		expect(size.width * size.height).toBeLessThanOrEqual(4_194_304);
		expect(size.width).toBe(2364);
		expect(size.height).toBe(1773);
	});
});

describe('renderSizeForExport', () => {
	it('handles full, half, quarter, and custom longestSide', () => {
		expect(renderSizeForExport(4001, 3001, {kind: 'full'})).toEqual({
			width: 4001,
			height: 3001,
			scale: 1,
		});
		expect(renderSizeForExport(4001, 3001, {kind: 'half'})).toEqual({
			width: 2000,
			height: 1500,
			scale: 2000 / 4001,
		});
		expect(renderSizeForExport(4001, 3001, {kind: 'quarter'})).toEqual({
			width: 1000,
			height: 750,
			scale: 1000 / 4001,
		});
		expect(
			renderSizeForExport(4000, 3000, {kind: 'longestSide', maxSide: 2000}),
		).toEqual({
			width: 2000,
			height: 1500,
			scale: 0.5,
		});
		expect(
			renderSizeForExport(3000, 4000, {kind: 'longestSide', maxSide: 2000}),
		).toEqual({
			width: 1500,
			height: 2000,
			scale: 0.5,
		});
	});

	it('never upscales when maxSide exceeds the source longest side', () => {
		expect(
			renderSizeForExport(800, 600, {kind: 'longestSide', maxSide: 4000}),
		).toEqual({
			width: 800,
			height: 600,
			scale: 1,
		});
	});
});

describe('limit checks', () => {
	it('enforces the 200 MB file size limit', () => {
		expect(checkFileSizeLimit(MAX_FILE_SIZE_BYTES)).toBeUndefined();
		const error = checkFileSizeLimit(MAX_FILE_SIZE_BYTES + 1);
		expect(error?.code).toBe('too-large');
	});

	it('enforces the 16,384 px longest side limit and flags > 50 MP', () => {
		expect(checkDimensionLimits(MAX_LONGEST_SIDE, 1000)).toEqual({
			exceedsGuaranteedArea: false,
		});
		const overSide = checkDimensionLimits(20_000, 1000);
		expect(overSide.hardError?.code).toBe('too-large');
		expect(overSide.hardError?.message).toBe(
			'Image too large: the longest side is 20,000 px; the limit is 16,384 px.',
		);

		expect(checkDimensionLimits(10_000, 5000)).toEqual({
			exceedsGuaranteedArea: false,
		});
		expect(checkDimensionLimits(10_000, 5001)).toEqual({
			exceedsGuaranteedArea: true,
		});
		expect(10_000 * 5000).toBe(GUARANTEED_MAX_PIXELS);
	});
});

describe('probeImageDimensions', () => {
	it('rejects oversized blobs without calling createImageBitmap', async () => {
		const createImageBitmap = vi.fn();
		const fakeBlob = {size: MAX_FILE_SIZE_BYTES + 1} as Blob;
		const result = await probeImageDimensions(fakeBlob, {
			createImageBitmap,
			createCanvas: () => makeFakeCanvas().canvas,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('too-large');
		}

		expect(createImageBitmap).not.toHaveBeenCalled();
	});

	it('returns oriented dimensions and closes the bitmap', async () => {
		const close = vi.fn();
		const runtime: DecodeRuntime = {
			async createImageBitmap(_blob, options) {
				expect(options).toEqual({
					imageOrientation: 'from-image',
					colorSpaceConversion: 'default',
				});
				return {width: 8000, height: 7000, close};
			},
			createCanvas: () => makeFakeCanvas().canvas,
		};

		const result = await probeImageDimensions(new Blob(['x']), runtime);
		expect(result).toEqual({
			ok: true,
			value: {width: 8000, height: 7000, exceedsGuaranteedArea: true},
		});
		expect(close).toHaveBeenCalledOnce();
	});
});

describe('decodeImage', () => {
	it('decodes pixels, applies resize options, reuses canvas, and shrinks canvas to 1x1', async () => {
		const close = vi.fn();
		const pixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
		const {canvas, drawImage} = makeFakeCanvas(pixels);
		let receivedOptions: ImageBitmapOptions | undefined;

		const runtime: DecodeRuntime = {
			async createImageBitmap(_blob, options) {
				receivedOptions = options;
				return {width: 2, height: 1, close};
			},
			createCanvas: () => canvas,
		};

		const result = await decodeImage(
			new Blob(['img']),
			{resizeWidth: 2, resizeHeight: 1, canvas},
			runtime,
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.width).toBe(2);
			expect(result.value.height).toBe(1);
			expect(Array.from(result.value.data)).toEqual([
				10, 20, 30, 255, 40, 50, 60, 255,
			]);
		}

		expect(receivedOptions).toEqual({
			imageOrientation: 'from-image',
			colorSpaceConversion: 'default',
			resizeWidth: 2,
			resizeHeight: 1,
			resizeQuality: 'high',
		});
		expect(drawImage).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(canvas.width).toBe(1);
		expect(canvas.height).toBe(1);
	});

	it('returns out-of-memory when 2d context allocation fails', async () => {
		const close = vi.fn();
		const {canvas} = makeFakeCanvas(undefined, {nullContext: true});
		const runtime: DecodeRuntime = {
			async createImageBitmap() {
				return {width: 4, height: 4, close};
			},
			createCanvas: () => canvas,
		};

		const result = await decodeImage(new Blob(['img']), {}, runtime);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('out-of-memory');
		}

		expect(close).toHaveBeenCalledOnce();
		expect(canvas.width).toBe(1);
		expect(canvas.height).toBe(1);
	});

	it('maps RangeError to out-of-memory and other decode errors to decode-failed', async () => {
		const oomRuntime: DecodeRuntime = {
			async createImageBitmap() {
				throw new RangeError('Array buffer allocation failed');
			},
			createCanvas: () => makeFakeCanvas().canvas,
		};
		const oomResult = await decodeImage(new Blob(['img']), {}, oomRuntime);
		expect(oomResult.ok).toBe(false);
		if (!oomResult.ok) {
			expect(oomResult.error.code).toBe('out-of-memory');
		}

		const corruptRuntime: DecodeRuntime = {
			async createImageBitmap() {
				throw new Error('The source image could not be decoded.');
			},
			createCanvas: () => makeFakeCanvas().canvas,
		};
		const corruptResult = await decodeImage(
			new Blob(['corrupt']),
			{},
			corruptRuntime,
		);
		expect(corruptResult.ok).toBe(false);
		if (!corruptResult.ok) {
			expect(corruptResult.error.code).toBe('decode-failed');
		}
	});
});
