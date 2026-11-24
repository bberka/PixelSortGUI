import type {RgbaImage} from '../engine/types.ts';

export const MAX_LONGEST_SIDE = 16_384;
export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
export const GUARANTEED_MAX_PIXELS = 50_000_000;

export type CodecErrorCode =
	| 'decode-failed'
	| 'unsupported-format'
	| 'too-large'
	| 'out-of-memory'
	| 'encode-failed';

export type CodecError = {
	readonly code: CodecErrorCode;
	readonly message: string;
	readonly cause?: unknown;
};

export type CodecResult<T> =
	| {readonly ok: true; readonly value: T}
	| {readonly ok: false; readonly error: CodecError};

export type RenderSize = {
	readonly width: number;
	readonly height: number;
	readonly scale: number;
};

export type ExportSizeSpec =
	| {readonly kind: 'full'}
	| {readonly kind: 'half'}
	| {readonly kind: 'quarter'}
	| {readonly kind: 'longestSide'; readonly maxSide: number};

export type ImageDimensions = {
	readonly width: number;
	readonly height: number;
	readonly exceedsGuaranteedArea: boolean;
};

export type DecodeOptions = {
	readonly resizeWidth?: number;
	readonly resizeHeight?: number;
	readonly resizeQuality?: ResizeQuality;
	readonly canvas?: DecodeCanvas;
	readonly skipFileSizeLimit?: boolean;
	readonly skipDimensionLimits?: boolean;
};

export type DecodeBitmap = {
	readonly width: number;
	readonly height: number;
	close(): void;
};

export type DecodeCanvasContext = {
	drawImage(image: DecodeBitmap, dx: number, dy: number): void;
	getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
};

export type DecodeCanvas = {
	width: number;
	height: number;
	getContext(
		contextId: '2d',
		options?: CanvasRenderingContext2DSettings,
	): DecodeCanvasContext | null;
};

export type DecodeRuntime = {
	createImageBitmap(
		source: Blob,
		options?: ImageBitmapOptions,
	): Promise<DecodeBitmap>;
	createCanvas(width: number, height: number): DecodeCanvas;
};

let sharedDecodeCanvas: OffscreenCanvas | undefined;

function getDefaultRuntime(): DecodeRuntime {
	return {
		createImageBitmap: (source, options) =>
			globalThis.createImageBitmap(source, options),
		createCanvas(width, height) {
			sharedDecodeCanvas ??= new OffscreenCanvas(width, height);
			return sharedDecodeCanvas;
		},
	};
}

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive integer, got ${value}`);
	}
}

export function renderSize(
	sourceWidth: number,
	sourceHeight: number,
	scale: number,
): RenderSize {
	assertPositiveInteger(sourceWidth, 'sourceWidth');
	assertPositiveInteger(sourceHeight, 'sourceHeight');
	if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
		throw new RangeError(`scale must be in (0, 1], got ${scale}`);
	}

	const width = Math.max(1, Math.floor(sourceWidth * scale));
	const height = Math.max(1, Math.floor(sourceHeight * scale));
	return {width, height, scale: width / sourceWidth};
}

export function renderSizeForPixelCap(
	sourceWidth: number,
	sourceHeight: number,
	pixelCap: number,
): RenderSize {
	assertPositiveInteger(sourceWidth, 'sourceWidth');
	assertPositiveInteger(sourceHeight, 'sourceHeight');
	if (!Number.isFinite(pixelCap) || pixelCap <= 0) {
		throw new RangeError(`pixelCap must be positive, got ${pixelCap}`);
	}

	const scale = Math.min(1, Math.sqrt(pixelCap / (sourceWidth * sourceHeight)));
	return renderSize(sourceWidth, sourceHeight, scale);
}

export function renderSizeForExport(
	sourceWidth: number,
	sourceHeight: number,
	spec: ExportSizeSpec,
): RenderSize {
	assertPositiveInteger(sourceWidth, 'sourceWidth');
	assertPositiveInteger(sourceHeight, 'sourceHeight');

	switch (spec.kind) {
		case 'full': {
			return renderSize(sourceWidth, sourceHeight, 1);
		}

		case 'half': {
			return renderSize(sourceWidth, sourceHeight, 0.5);
		}

		case 'quarter': {
			return renderSize(sourceWidth, sourceHeight, 0.25);
		}

		case 'longestSide': {
			if (!Number.isFinite(spec.maxSide) || spec.maxSide < 1) {
				throw new RangeError(`maxSide must be at least 1, got ${spec.maxSide}`);
			}

			const longest = Math.max(sourceWidth, sourceHeight);
			const scale = Math.min(1, spec.maxSide / longest);
			return renderSize(sourceWidth, sourceHeight, scale);
		}
	}
}

export function checkFileSizeLimit(byteLength: number): CodecError | undefined {
	if (byteLength > MAX_FILE_SIZE_BYTES) {
		return {
			code: 'too-large',
			message: `File too large: ${byteLength.toLocaleString('en-US')} bytes exceeds the 200 MB limit.`,
		};
	}

	return undefined;
}

export function checkDimensionLimits(
	width: number,
	height: number,
): {
	readonly hardError?: CodecError;
	readonly exceedsGuaranteedArea: boolean;
} {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1
	) {
		return {
			hardError: {
				code: 'decode-failed',
				message: `Invalid image dimensions: ${width} × ${height}.`,
			},
			exceedsGuaranteedArea: false,
		};
	}

	const longest = Math.max(width, height);
	const exceedsGuaranteedArea = width * height > GUARANTEED_MAX_PIXELS;

	if (longest > MAX_LONGEST_SIDE) {
		return {
			hardError: {
				code: 'too-large',
				message: `Image too large: the longest side is ${longest.toLocaleString('en-US')} px; the limit is 16,384 px.`,
			},
			exceedsGuaranteedArea,
		};
	}

	return {exceedsGuaranteedArea};
}

export function isMemoryError(error: unknown): boolean {
	if (error instanceof RangeError) {
		return true;
	}

	if (error instanceof Error) {
		const text = `${error.name} ${error.message}`.toLowerCase();
		return (
			text.includes('out of memory') ||
			text.includes('allocation') ||
			text.includes('memory') ||
			text.includes('quotaexceeded')
		);
	}

	return false;
}

function makeDecodeError(error: unknown): CodecError {
	if (isMemoryError(error)) {
		return {
			code: 'out-of-memory',
			message: 'Not enough memory to decode this image.',
			cause: error,
		};
	}

	return {
		code: 'decode-failed',
		message: 'The browser could not decode this image file.',
		cause: error,
	};
}

export async function probeImageDimensions(
	blob: Blob,
	runtime: DecodeRuntime = getDefaultRuntime(),
): Promise<CodecResult<ImageDimensions>> {
	const fileSizeError = checkFileSizeLimit(blob.size);
	if (fileSizeError) {
		return {ok: false, error: fileSizeError};
	}

	let bitmap: DecodeBitmap | undefined;
	try {
		bitmap = await runtime.createImageBitmap(blob, {
			imageOrientation: 'from-image',
			colorSpaceConversion: 'default',
		});
		const {width, height} = bitmap;
		const limits = checkDimensionLimits(width, height);
		if (limits.hardError) {
			return {ok: false, error: limits.hardError};
		}

		return {
			ok: true,
			value: {
				width,
				height,
				exceedsGuaranteedArea: limits.exceedsGuaranteedArea,
			},
		};
	} catch (error) {
		return {ok: false, error: makeDecodeError(error)};
	} finally {
		bitmap?.close();
	}
}

export async function decodeImage(
	blob: Blob,
	options: DecodeOptions = {},
	runtime: DecodeRuntime = getDefaultRuntime(),
): Promise<CodecResult<RgbaImage>> {
	if (!options.skipFileSizeLimit) {
		const fileSizeError = checkFileSizeLimit(blob.size);
		if (fileSizeError) {
			return {ok: false, error: fileSizeError};
		}
	}

	const bitmapOptions: ImageBitmapOptions = {
		imageOrientation: 'from-image',
		colorSpaceConversion: 'default',
	};

	if (options.resizeWidth !== undefined || options.resizeHeight !== undefined) {
		if (
			options.resizeWidth !== undefined &&
			(!Number.isSafeInteger(options.resizeWidth) || options.resizeWidth < 1)
		) {
			return {
				ok: false,
				error: {
					code: 'decode-failed',
					message: `Invalid resizeWidth: ${options.resizeWidth}.`,
				},
			};
		}

		if (
			options.resizeHeight !== undefined &&
			(!Number.isSafeInteger(options.resizeHeight) || options.resizeHeight < 1)
		) {
			return {
				ok: false,
				error: {
					code: 'decode-failed',
					message: `Invalid resizeHeight: ${options.resizeHeight}.`,
				},
			};
		}

		bitmapOptions.resizeWidth = options.resizeWidth;
		bitmapOptions.resizeHeight = options.resizeHeight;
		bitmapOptions.resizeQuality = options.resizeQuality ?? 'high';
	}

	let bitmap: DecodeBitmap | undefined;
	let canvas: DecodeCanvas | undefined;
	try {
		bitmap = await runtime.createImageBitmap(blob, bitmapOptions);
		const {width, height} = bitmap;

		if (!options.skipDimensionLimits) {
			const limits = checkDimensionLimits(width, height);
			if (limits.hardError) {
				return {ok: false, error: limits.hardError};
			}
		}

		canvas = options.canvas ?? runtime.createCanvas(width, height);
		canvas.width = width;
		canvas.height = height;

		const context = canvas.getContext('2d', {
			willReadFrequently: true,
			colorSpace: 'srgb',
		});
		if (!context) {
			return {
				ok: false,
				error: {
					code: 'out-of-memory',
					message: 'Failed to allocate a 2D canvas context for decoding.',
				},
			};
		}

		context.drawImage(bitmap, 0, 0);
		const imageData = context.getImageData(0, 0, width, height);

		return {
			ok: true,
			value: {
				width,
				height,
				data: imageData.data,
			},
		};
	} catch (error) {
		return {ok: false, error: makeDecodeError(error)};
	} finally {
		bitmap?.close();
		if (canvas) {
			canvas.width = 1;
			canvas.height = 1;
		}
	}
}
