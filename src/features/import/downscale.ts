import {
	GUARANTEED_MAX_PIXELS,
	isMemoryError,
	renderSizeForPixelCap,
	type CodecError,
	type CodecResult,
} from '@/codec/decode.ts';
import {DEFAULT_EXPORT_QUALITY} from '@/codec/encode.ts';

/**
 The source image stored for an image over the 50 MP guaranteed maximum when
 the user picks "Import at 50 MP" (product.md section 4, AC-F1.5).
 */
export type DownscaledSource = {
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
};

export type DownscaleBitmap = {
	readonly width: number;
	readonly height: number;
	close(): void;
};

export type DownscaleCanvasContext = {
	drawImage(bitmap: DownscaleBitmap, dx: number, dy: number): void;
};

export type DownscaleCanvas = {
	width: number;
	height: number;
	getContext(
		contextId: '2d',
		options?: CanvasRenderingContext2DSettings,
	): DownscaleCanvasContext | null;
	convertToBlob(options?: ImageEncodeOptions): Promise<Blob>;
};

export type DownscaleRuntime = {
	createImageBitmap(
		source: Blob,
		options?: ImageBitmapOptions,
	): Promise<DownscaleBitmap>;
	createCanvas(width: number, height: number): DownscaleCanvas;
};

let sharedCanvas: OffscreenCanvas | undefined;

function getDefaultRuntime(): DownscaleRuntime {
	return {
		createImageBitmap: (source, options) =>
			globalThis.createImageBitmap(source, options),
		createCanvas(width, height) {
			sharedCanvas ??= new OffscreenCanvas(width, height);
			return sharedCanvas;
		},
	};
}

function makeDownscaleError(error: unknown): CodecError {
	if (isMemoryError(error)) {
		return {
			code: 'out-of-memory',
			message: 'Not enough memory to make the downscaled copy.',
			cause: error,
		};
	}

	return {
		code: 'encode-failed',
		message: 'The browser could not make the downscaled copy.',
		cause: error,
	};
}

/**
 The large source JPEG/PNG is decoded and resized by the browser's image
 pipeline inside `createImageBitmap` (off the main thread), then drawn onto an
 `OffscreenCanvas` and encoded asynchronously by `convertToBlob`. No pixels are
 read back to the main thread, so the 50 MP copy never becomes a main-thread
 copy of 200 MB. The copy is stored as JPEG because a 50 MP PNG can exceed the
 200 MB file limit on its own.
 */
export async function downscaleToPixelCap(
	blob: Blob,
	width: number,
	height: number,
	runtime: DownscaleRuntime = getDefaultRuntime(),
): Promise<CodecResult<DownscaledSource>> {
	const target = renderSizeForPixelCap(width, height, GUARANTEED_MAX_PIXELS);
	let bitmap: DownscaleBitmap | undefined;
	let canvas: DownscaleCanvas | undefined;

	try {
		bitmap = await runtime.createImageBitmap(blob, {
			imageOrientation: 'from-image',
			colorSpaceConversion: 'default',
			resizeWidth: target.width,
			resizeHeight: target.height,
			resizeQuality: 'high',
		});

		canvas = runtime.createCanvas(bitmap.width, bitmap.height);
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d', {colorSpace: 'srgb'});
		if (!context) {
			return {
				ok: false,
				error: {
					code: 'out-of-memory',
					message: 'Failed to allocate a 2D canvas context for the downscale.',
				},
			};
		}

		context.drawImage(bitmap, 0, 0);
		const encoded = await canvas.convertToBlob({
			type: 'image/jpeg',
			quality: DEFAULT_EXPORT_QUALITY / 100,
		});
		if (encoded.type !== 'image/jpeg') {
			return {
				ok: false,
				error: {
					code: 'encode-failed',
					message: `Browser does not support encoding image/jpeg (returned ${encoded.type || 'unknown'}).`,
				},
			};
		}

		return {
			ok: true,
			value: {blob: encoded, width: bitmap.width, height: bitmap.height},
		};
	} catch (error) {
		return {ok: false, error: makeDownscaleError(error)};
	} finally {
		bitmap?.close();
		if (canvas) {
			canvas.width = 1;
			canvas.height = 1;
		}
	}
}
