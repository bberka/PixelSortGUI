import type {RgbaImage} from '../engine/types.ts';
import {isMemoryError, type CodecError, type CodecResult} from './decode.ts';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export const FORMAT_MIME_TYPES: Readonly<Record<ExportFormat, string>> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
};

export const DEFAULT_EXPORT_QUALITY = 92;
export const DEFAULT_JPEG_BACKGROUND: readonly [number, number, number] = [
	255, 255, 255,
];

export type EncodeOptions = {
	readonly format: ExportFormat;
	// 0..100 (spec UI range 50..100, default 92). Ignored for PNG.
	readonly quality?: number;
	// Straight RGB matte for transparent pixels when encoding JPEG. Default white.
	readonly jpegBackground?: readonly [number, number, number];
	readonly canvas?: EncodeCanvas;
};

export type EncodedImage = {
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
	readonly mime: string;
};

export type SupportedEncodeFormats = {
	readonly png: boolean;
	readonly jpeg: boolean;
	readonly webp: boolean;
};

export type EncodeCanvasContext = {
	putImageData(imageData: ImageData, dx: number, dy: number): void;
};

export type EncodeCanvas = {
	width: number;
	height: number;
	getContext(
		contextId: '2d',
		options?: CanvasRenderingContext2DSettings,
	): EncodeCanvasContext | null;
	convertToBlob(options?: ImageEncodeOptions): Promise<Blob>;
};

export type EncodeRuntime = {
	createCanvas(width: number, height: number): EncodeCanvas;
	createImageData(
		data: Uint8ClampedArray<ArrayBuffer>,
		width: number,
		height: number,
	): ImageData;
};

let sharedEncodeCanvas: OffscreenCanvas | undefined;

function getDefaultRuntime(): EncodeRuntime {
	return {
		createCanvas(width, height) {
			sharedEncodeCanvas ??= new OffscreenCanvas(width, height);
			return sharedEncodeCanvas;
		},
		createImageData(data, width, height) {
			return new ImageData(data, width, height);
		},
	};
}

function normalizeQuality(quality: number | undefined): number {
	const value = quality ?? DEFAULT_EXPORT_QUALITY;
	if (!Number.isFinite(value)) {
		return DEFAULT_EXPORT_QUALITY / 100;
	}

	const clamped = Math.min(100, Math.max(0, value));
	return clamped / 100;
}

function toArrayBufferPixels(
	data: Uint8ClampedArray,
): Uint8ClampedArray<ArrayBuffer> {
	return data.buffer instanceof ArrayBuffer
		? (data as Uint8ClampedArray<ArrayBuffer>)
		: new Uint8ClampedArray(data);
}

export function flattenAlphaForJpeg(
	image: RgbaImage,
	background: readonly [number, number, number] = DEFAULT_JPEG_BACKGROUND,
): Uint8ClampedArray<ArrayBuffer> {
	const {data} = image;
	let hasTransparency = false;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < 255) {
			hasTransparency = true;
			break;
		}
	}

	if (!hasTransparency) {
		return toArrayBufferPixels(data);
	}

	const [bgR, bgG, bgB] = background;
	const out = new Uint8ClampedArray(data.length);
	for (let i = 0; i < data.length; i += 4) {
		const a = data[i + 3];
		if (a === 255) {
			out[i] = data[i];
			out[i + 1] = data[i + 1];
			out[i + 2] = data[i + 2];
		} else if (a === 0) {
			out[i] = bgR;
			out[i + 1] = bgG;
			out[i + 2] = bgB;
		} else {
			const invA = 255 - a;
			out[i] = Math.floor((data[i] * a + bgR * invA + 127) / 255);
			out[i + 1] = Math.floor((data[i + 1] * a + bgG * invA + 127) / 255);
			out[i + 2] = Math.floor((data[i + 2] * a + bgB * invA + 127) / 255);
		}

		out[i + 3] = 255;
	}

	return out;
}

function makeEncodeError(error: unknown): CodecError {
	if (isMemoryError(error)) {
		return {
			code: 'out-of-memory',
			message: 'Not enough memory to encode this image.',
			cause: error,
		};
	}

	return {
		code: 'encode-failed',
		message: 'Failed to encode the image.',
		cause: error,
	};
}

export async function encodeImage(
	image: RgbaImage,
	options: EncodeOptions,
	runtime: EncodeRuntime = getDefaultRuntime(),
): Promise<CodecResult<EncodedImage>> {
	const {width, height} = image;
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1
	) {
		return {
			ok: false,
			error: {
				code: 'encode-failed',
				message: `Invalid image dimensions: ${width} × ${height}.`,
			},
		};
	}

	const expectedMime = FORMAT_MIME_TYPES[options.format];
	let canvas: EncodeCanvas | undefined;

	try {
		canvas = options.canvas ?? runtime.createCanvas(width, height);
		canvas.width = width;
		canvas.height = height;

		const context = canvas.getContext('2d', {colorSpace: 'srgb'});
		if (!context) {
			return {
				ok: false,
				error: {
					code: 'out-of-memory',
					message: 'Failed to allocate a 2D canvas context for encoding.',
				},
			};
		}

		const pixels =
			options.format === 'jpeg'
				? flattenAlphaForJpeg(image, options.jpegBackground)
				: toArrayBufferPixels(image.data);

		const imageData = runtime.createImageData(pixels, width, height);
		context.putImageData(imageData, 0, 0);

		const encodeOptions: ImageEncodeOptions =
			options.format === 'png'
				? {type: expectedMime}
				: {type: expectedMime, quality: normalizeQuality(options.quality)};

		const blob = await canvas.convertToBlob(encodeOptions);
		if (blob.type !== expectedMime) {
			return {
				ok: false,
				error: {
					code: 'unsupported-format',
					message: `Browser does not support encoding ${expectedMime} (returned ${blob.type || 'unknown'}).`,
				},
			};
		}

		return {
			ok: true,
			value: {
				blob,
				width,
				height,
				mime: blob.type,
			},
		};
	} catch (error) {
		return {ok: false, error: makeEncodeError(error)};
	} finally {
		if (canvas) {
			canvas.width = 1;
			canvas.height = 1;
		}
	}
}

export async function probeEncodeFormat(
	format: ExportFormat,
	runtime: EncodeRuntime = getDefaultRuntime(),
): Promise<boolean> {
	const expectedMime = FORMAT_MIME_TYPES[format];
	let canvas: EncodeCanvas | undefined;
	try {
		canvas = runtime.createCanvas(1, 1);
		canvas.width = 1;
		canvas.height = 1;
		const context = canvas.getContext('2d', {colorSpace: 'srgb'});
		if (!context) {
			return false;
		}

		const blob = await canvas.convertToBlob(
			format === 'png'
				? {type: expectedMime}
				: {type: expectedMime, quality: DEFAULT_EXPORT_QUALITY / 100},
		);
		return blob.type === expectedMime;
	} catch {
		return false;
	} finally {
		if (canvas) {
			canvas.width = 1;
			canvas.height = 1;
		}
	}
}

export async function probeSupportedEncodeFormats(
	runtime: EncodeRuntime = getDefaultRuntime(),
): Promise<SupportedEncodeFormats> {
	const [png, jpeg, webp] = await Promise.all([
		probeEncodeFormat('png', runtime),
		probeEncodeFormat('jpeg', runtime),
		probeEncodeFormat('webp', runtime),
	]);
	return {png, jpeg, webp};
}
