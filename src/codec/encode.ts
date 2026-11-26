import {boxDownscale} from '../engine/resample.ts';
import type {RgbaImage} from '../engine/types.ts';
import {BMP_HEADER_BYTES, bmpBytesPerPixel, writeBmp} from './bmp-writer.ts';
import {
	isMemoryError,
	renderSizeForPixelCap,
	type CodecError,
	type CodecResult,
} from './decode.ts';
import {encodeTiff} from './tiff.ts';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff';
/**
The formats the browser's canvas encodes; BMP and TIFF are written here.
*/
export type CanvasFormat = 'png' | 'jpeg' | 'webp';

export function isLossyFormat(format: ExportFormat): format is 'jpeg' | 'webp' {
	return format === 'jpeg' || format === 'webp';
}

export const FORMAT_MIME_TYPES: Readonly<Record<ExportFormat, string>> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	bmp: 'image/bmp',
	tiff: 'image/tiff',
};

export const DEFAULT_EXPORT_QUALITY = 92;
export const MIN_SIZE_LIMITED_QUALITY = 10;
export const MIN_SIZE_LIMITED_SIDE = 64;
export const MAX_QUALITY_SEARCH_STEPS = 7;
export const MAX_SCALE_STEPS = 6;
export const DEFAULT_JPEG_BACKGROUND: readonly [number, number, number] = [
	255, 255, 255,
];

export type EncodeOptions = {
	readonly format: ExportFormat;
	// 0..100 (spec UI range 50..100, default 92). Ignored for PNG.
	readonly quality?: number;
	// Optional target maximum output size in bytes.
	readonly maxBytes?: number;
	// Straight RGB matte for transparent pixels when encoding JPEG. Default white.
	readonly jpegBackground?: readonly [number, number, number];
	readonly canvas?: EncodeCanvas;
	readonly isCancelled?: () => boolean;
	readonly onProgress?: (fraction: number) => void;
};

export type EncodedImage = {
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
	readonly mime: string;
	readonly effectiveQuality?: number;
	readonly targetMet?: boolean;
};

export type SupportedEncodeFormats = {
	readonly png: boolean;
	readonly jpeg: boolean;
	readonly webp: boolean;
};

export type EncodeCanvasContext = {
	putImageData(imageData: ImageData, dx: number, dy: number): void;
	drawImage?: (
		image: CanvasImageSource,
		dx: number,
		dy: number,
		dWidth: number,
		dHeight: number,
	) => void;
	imageSmoothingEnabled?: boolean;
	imageSmoothingQuality?: ImageSmoothingQuality;
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
	createScratchCanvas?: (width: number, height: number) => EncodeCanvas;
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
		createScratchCanvas(width, height) {
			return new OffscreenCanvas(width, height);
		},
		createImageData(data, width, height) {
			return new ImageData(data, width, height);
		},
	};
}

function normalizeQualityInt(quality: number | undefined): number {
	const value = quality ?? DEFAULT_EXPORT_QUALITY;
	return Number.isFinite(value)
		? Math.round(Math.min(100, Math.max(0, value)))
		: DEFAULT_EXPORT_QUALITY;
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

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
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

async function convertCanvasToBlob(
	targetCanvas: EncodeCanvas,
	format: CanvasFormat,
	expectedMime: string,
	qualityInt: number,
): Promise<CodecResult<Blob>> {
	const encodeOptions: ImageEncodeOptions =
		format === 'png'
			? {type: expectedMime}
			: {type: expectedMime, quality: qualityInt / 100};
	const blob = await targetCanvas.convertToBlob(encodeOptions);
	if (blob.type !== expectedMime) {
		return {
			ok: false,
			error: {
				code: 'unsupported-format',
				message: `Browser does not support encoding ${expectedMime} (returned ${blob.type || 'unknown'}).`,
			},
		};
	}

	return {ok: true, value: blob};
}

type QualitySearchResult =
	| {ok: false; error: CodecError}
	| {
			ok: true;
			bestFit: {blob: Blob; quality: number} | undefined;
			lowestBlob: Blob;
	  };

async function searchLossyQuality(
	targetCanvas: EncodeCanvas,
	format: CanvasFormat,
	expectedMime: string,
	maxBytes: number,
	highQuality: number,
	isCancelled?: () => boolean,
	onStep?: (stepFraction: number) => void,
): Promise<QualitySearchResult> {
	if (isCancelled?.()) {
		return {
			ok: false,
			error: {code: 'encode-failed', message: 'Export cancelled.'},
		};
	}

	const lowFloor = Math.min(MIN_SIZE_LIMITED_QUALITY, highQuality);

	const lowResult = await convertCanvasToBlob(
		targetCanvas,
		format,
		expectedMime,
		lowFloor,
	);
	if (!lowResult.ok) {
		return lowResult;
	}

	onStep?.(1 / (MAX_QUALITY_SEARCH_STEPS + 1));
	if (lowResult.value.size > maxBytes) {
		return {ok: true, bestFit: undefined, lowestBlob: lowResult.value};
	}

	let bestFit = {blob: lowResult.value, quality: lowFloor};
	let lo = lowFloor + 1;
	let hi = highQuality - 1;
	let steps = 0;

	while (lo <= hi && steps < MAX_QUALITY_SEARCH_STEPS) {
		if (isCancelled?.()) {
			return {
				ok: false,
				error: {code: 'encode-failed', message: 'Export cancelled.'},
			};
		}

		const mid = Math.floor((lo + hi) / 2);
		const attempt = await convertCanvasToBlob(
			targetCanvas,
			format,
			expectedMime,
			mid,
		);
		if (!attempt.ok) {
			return attempt;
		}

		steps++;
		onStep?.((steps + 1) / (MAX_QUALITY_SEARCH_STEPS + 1));

		if (attempt.value.size <= maxBytes) {
			bestFit = {blob: attempt.value, quality: mid};
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}

	return {ok: true, bestFit, lowestBlob: lowResult.value};
}

// The `utif2` encoder places the pixel data at this offset.
const TIFF_HEADER_BYTES = 1000;

/**
 BMP and TIFF are uncompressed, so the output size follows from the dimensions:
 a size limit scales the image once to the largest size that fits.
 */
async function encodeUncompressed(
	image: RgbaImage,
	format: 'bmp' | 'tiff',
	maxBytes: number | undefined,
): Promise<EncodedImage> {
	const header = format === 'bmp' ? BMP_HEADER_BYTES : TIFF_HEADER_BYTES;
	const bytesPerPixel = format === 'bmp' ? bmpBytesPerPixel(image) : 4;
	let output = image;
	if (
		maxBytes !== undefined &&
		header + image.width * image.height * bytesPerPixel > maxBytes
	) {
		const shortest = Math.min(image.width, image.height);
		const floor = Math.min(1, MIN_SIZE_LIMITED_SIDE / shortest);
		const size = renderSizeForPixelCap(
			image.width,
			image.height,
			Math.max(
				(maxBytes - header) / bytesPerPixel,
				image.width * image.height * floor ** 2,
				1,
			),
		);
		let {width, height} = size;
		// BMP rows are padded to four bytes, which can push a fit just over.
		const rowBytes = () => Math.ceil((width * bytesPerPixel) / 4) * 4;
		while (
			header + rowBytes() * height > maxBytes &&
			Math.min(width, height) > Math.min(shortest, MIN_SIZE_LIMITED_SIDE)
		) {
			if (width >= height) {
				width--;
			} else {
				height--;
			}
		}

		output = boxDownscale(image, width, height);
	}

	const mime = FORMAT_MIME_TYPES[format];
	const blob = new Blob(
		[format === 'bmp' ? writeBmp(output) : await encodeTiff(output)],
		{type: mime},
	);
	return {
		blob,
		width: output.width,
		height: output.height,
		mime,
		targetMet: maxBytes === undefined || blob.size <= maxBytes,
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

	const {format} = options;
	const expectedMime = FORMAT_MIME_TYPES[format];
	const requestedQuality = normalizeQualityInt(options.quality);
	const maxBytes =
		typeof options.maxBytes === 'number' &&
		Number.isFinite(options.maxBytes) &&
		options.maxBytes > 0
			? options.maxBytes
			: undefined;

	if (format === 'bmp' || format === 'tiff') {
		try {
			return {
				ok: true,
				value: await encodeUncompressed(image, format, maxBytes),
			};
		} catch (error) {
			return {ok: false, error: makeEncodeError(error)};
		}
	}

	let canvas: EncodeCanvas | undefined;
	let scratchCanvas: EncodeCanvas | undefined;

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
			format === 'jpeg'
				? flattenAlphaForJpeg(image, options.jpegBackground)
				: toArrayBufferPixels(image.data);

		const imageData = runtime.createImageData(pixels, width, height);
		context.putImageData(imageData, 0, 0);

		const initial = await convertCanvasToBlob(
			canvas,
			format,
			expectedMime,
			requestedQuality,
		);
		if (!initial.ok) {
			return initial;
		}

		if (maxBytes === undefined || initial.value.size <= maxBytes) {
			return {
				ok: true,
				value: {
					blob: initial.value,
					width,
					height,
					mime: initial.value.type,
					effectiveQuality: format === 'png' ? undefined : requestedQuality,
					targetMet: true,
				},
			};
		}

		let bestBlob = initial.value;
		let bestWidth = width;
		let bestHeight = height;
		let bestQuality: number | undefined =
			format === 'png' ? undefined : requestedQuality;

		if (format !== 'png') {
			const qualitySearch = await searchLossyQuality(
				canvas,
				format,
				expectedMime,
				maxBytes,
				requestedQuality,
				options.isCancelled,
				(fraction) => {
					options.onProgress?.(fraction * 0.45);
				},
			);
			if (!qualitySearch.ok) {
				return qualitySearch;
			}

			if (qualitySearch.bestFit) {
				return {
					ok: true,
					value: {
						blob: qualitySearch.bestFit.blob,
						width,
						height,
						mime: qualitySearch.bestFit.blob.type,
						effectiveQuality: qualitySearch.bestFit.quality,
						targetMet: true,
					},
				};
			}

			bestBlob = qualitySearch.lowestBlob;
			bestQuality = Math.min(MIN_SIZE_LIMITED_QUALITY, requestedQuality);
		}

		// Progressive dimension downscaling (PNG or lossy that still exceeds maxBytes at quality floor).
		const minScale = Math.min(
			1,
			MIN_SIZE_LIMITED_SIDE / Math.min(width, height),
		);
		let scale = 1;
		let currentW = width;
		let currentH = height;

		for (let step = 0; step < MAX_SCALE_STEPS; step++) {
			if (scale <= minScale) {
				break;
			}

			if (options.isCancelled?.()) {
				return {
					ok: false,
					error: {code: 'encode-failed', message: 'Export cancelled.'},
				};
			}

			const ratio = clampNumber(
				Math.sqrt(maxBytes / Math.max(1, bestBlob.size)) * 0.92,
				minScale / scale,
				0.9,
			);
			let nextScale = Math.max(minScale, scale * ratio);
			if (step === MAX_SCALE_STEPS - 1 && nextScale > minScale) {
				nextScale = minScale;
			}

			scale = nextScale;
			const nextW = Math.max(1, Math.round(width * scale));
			const nextH = Math.max(1, Math.round(height * scale));
			if (nextW === currentW && nextH === currentH) {
				break;
			}

			currentW = nextW;
			currentH = nextH;

			scratchCanvas ??= runtime.createScratchCanvas
				? runtime.createScratchCanvas(nextW, nextH)
				: new OffscreenCanvas(nextW, nextH);
			scratchCanvas.width = nextW;
			scratchCanvas.height = nextH;

			const scratchContext = scratchCanvas.getContext('2d', {
				colorSpace: 'srgb',
			});
			if (!scratchContext?.drawImage) {
				break;
			}

			scratchContext.imageSmoothingEnabled = true;
			scratchContext.imageSmoothingQuality = 'high';
			scratchContext.drawImage(
				canvas as unknown as CanvasImageSource,
				0,
				0,
				nextW,
				nextH,
			);

			const progressBase = 0.45 + (step / MAX_SCALE_STEPS) * 0.5;
			options.onProgress?.(progressBase);

			if (format === 'png') {
				const attempt = await convertCanvasToBlob(
					scratchCanvas,
					'png',
					expectedMime,
					requestedQuality,
				);
				if (!attempt.ok) {
					return attempt;
				}

				bestBlob = attempt.value;
				bestWidth = nextW;
				bestHeight = nextH;
				if (attempt.value.size <= maxBytes) {
					return {
						ok: true,
						value: {
							blob: attempt.value,
							width: nextW,
							height: nextH,
							mime: attempt.value.type,
							effectiveQuality: undefined,
							targetMet: true,
						},
					};
				}
			} else {
				const scaledSearch = await searchLossyQuality(
					scratchCanvas,
					format,
					expectedMime,
					maxBytes,
					requestedQuality,
					options.isCancelled,
				);
				if (!scaledSearch.ok) {
					return scaledSearch;
				}

				if (scaledSearch.bestFit) {
					return {
						ok: true,
						value: {
							blob: scaledSearch.bestFit.blob,
							width: nextW,
							height: nextH,
							mime: scaledSearch.bestFit.blob.type,
							effectiveQuality: scaledSearch.bestFit.quality,
							targetMet: true,
						},
					};
				}

				bestBlob = scaledSearch.lowestBlob;
				bestWidth = nextW;
				bestHeight = nextH;
				bestQuality = Math.min(MIN_SIZE_LIMITED_QUALITY, requestedQuality);
			}
		}

		return {
			ok: true,
			value: {
				blob: bestBlob,
				width: bestWidth,
				height: bestHeight,
				mime: bestBlob.type,
				effectiveQuality: bestQuality,
				targetMet: bestBlob.size <= maxBytes,
			},
		};
	} catch (error) {
		return {ok: false, error: makeEncodeError(error)};
	} finally {
		if (canvas) {
			canvas.width = 1;
			canvas.height = 1;
		}

		if (scratchCanvas) {
			scratchCanvas.width = 1;
			scratchCanvas.height = 1;
		}
	}
}

export async function probeEncodeFormat(
	format: CanvasFormat,
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
