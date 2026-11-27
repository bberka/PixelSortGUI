import {
	assertPositiveInteger,
	renderSize,
	type RenderSize,
} from '../engine/render-size.ts';
import type {RgbaImage} from '../engine/types.ts';
import {
	decodeTiff,
	isTiff,
	readTiffInfo,
	UnsupportedTiffError,
} from './tiff.ts';

export {
	renderSize,
	renderSizeForPixelCap,
	type RenderSize,
} from '../engine/render-size.ts';

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
		source: Blob | ImageData,
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

class DimensionLimitError extends Error {
	readonly codecError: CodecError;

	constructor(codecError: CodecError) {
		super(codecError.message);
		this.codecError = codecError;
	}
}

function assertWithinLimits(width: number, height: number): void {
	const {hardError} = checkDimensionLimits(width, height);
	if (hardError) {
		throw new DimensionLimitError(hardError);
	}
}

function makeDecodeError(error: unknown): CodecError {
	if (error instanceof DimensionLimitError) {
		return error.codecError;
	}

	if (error instanceof UnsupportedTiffError) {
		return {
			code: 'unsupported-format',
			message: error.message,
			cause: error,
		};
	}

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

export type RefusedFormat = 'heic' | 'raw';

export type FormatInfo = {
	/**
	Set when the file is a format the app refuses to import.
	*/
	readonly refused?: RefusedFormat;
	readonly animated: boolean;
};

const RAW_EXTENSION = /\.(?:dng|cr2|cr3|nef|arw|raf|orf|rw2)$/i;
const HEIC_EXTENSION = /\.(?:heic|heif)$/i;
const RAW_SIGNATURES = ['FUJIFILMCCD-RAW', 'IIRO', 'IIRS', 'MMOR', 'IIU\0'];
const HEVC_BRANDS = new Set([
	'heic',
	'heix',
	'heim',
	'heis',
	'hevc',
	'hevx',
	'hevm',
	'hevs',
]);
const HEIF_CONTAINER_BRANDS = new Set(['mif1', 'msf1']);
const HEADER_BYTES = 512;
const READ_CHUNK_BYTES = 65_536;

type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

/**
 Serves small reads from one cached chunk, so walking a large file block by
 block never holds the whole file in memory. A read past the end is short.
 */
function createByteReader(blob: Blob): ByteReader {
	let start = 0;
	let chunk = new Uint8Array();

	return async (offset, length) => {
		const end = Math.min(offset + length, blob.size);
		if (offset < start || end > start + chunk.length) {
			start = offset;
			chunk = new Uint8Array(
				await blob
					.slice(offset, offset + Math.max(length, READ_CHUNK_BYTES))
					.arrayBuffer(),
			);
		}

		return chunk.subarray(offset - start, Math.max(offset, end) - start);
	};
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCodePoint(...bytes.subarray(offset, offset + length));
}

function uint32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset);
}

/**
 The major brand followed by the compatible brands of an ISO base media file
 (HEIC, AVIF, CR3), or an empty list for any other file.
 */
function ftypBrands(header: Uint8Array): readonly string[] {
	if (header.length < 12 || ascii(header, 4, 4) !== 'ftyp') {
		return [];
	}

	const end = Math.min(uint32(header, 0), header.length);
	const brands = [ascii(header, 8, 4)];
	for (let offset = 16; offset + 4 <= end; offset += 4) {
		brands.push(ascii(header, offset, 4));
	}

	return brands;
}

function refusedFormat(
	header: Uint8Array,
	fileName: string,
): RefusedFormat | undefined {
	const brands = ftypBrands(header);
	const major = brands[0] ?? '';
	const isCr2 = ascii(header, 0, 4) === 'II*\0' && ascii(header, 8, 2) === 'CR';

	if (
		RAW_EXTENSION.test(fileName) ||
		isCr2 ||
		major === 'crx ' ||
		RAW_SIGNATURES.some(
			(signature) => ascii(header, 0, signature.length) === signature,
		)
	) {
		return 'raw';
	}

	if (
		HEIC_EXTENSION.test(fileName) ||
		HEVC_BRANDS.has(major) ||
		(HEIF_CONTAINER_BRANDS.has(major) &&
			!brands.includes('avif') &&
			!brands.includes('avis'))
	) {
		return 'heic';
	}

	return undefined;
}

/**
 Walks the GIF block structure until a second image block, the trailer, or the
 end of the file.
 */
async function isAnimatedGif(read: ByteReader): Promise<boolean> {
	// Bit 7 flags a color table of 2 ^ (low three bits + 1) RGB entries.
	const colorTableBytes = (packed: number) =>
		packed >= 128 ? 3 * 2 ** ((packed % 8) + 1) : 0;
	const skipSubBlocks = async (from: number): Promise<number | undefined> => {
		let offset = from;
		for (;;) {
			const [size] = await read(offset, 1);
			if (size === undefined) {
				return undefined;
			}

			offset += size + 1;
			if (size === 0) {
				return offset;
			}
		}
	};

	const screen = await read(0, 13);
	let offset: number | undefined = 13 + colorTableBytes(screen[10] ?? 0);
	let frames = 0;

	while (offset !== undefined) {
		const [introducer] = await read(offset, 1);
		if (introducer === 0x21) {
			offset = await skipSubBlocks(offset + 2);
		} else if (introducer === 0x2c) {
			frames++;
			if (frames > 1) {
				return true;
			}

			const descriptor = await read(offset, 10);
			// Descriptor, local color table, then the LZW minimum code size byte.
			offset = await skipSubBlocks(
				offset + 11 + colorTableBytes(descriptor[9] ?? 0),
			);
		} else {
			return false;
		}
	}

	return false;
}

async function isAnimatedPng(read: ByteReader): Promise<boolean> {
	let offset = 8;
	for (;;) {
		const chunk = await read(offset, 12);
		if (chunk.length < 8) {
			return false;
		}

		const type = ascii(chunk, 4, 4);
		if (type === 'acTL') {
			return chunk.length === 12 && uint32(chunk, 8) > 1;
		}

		if (type === 'IDAT') {
			return false;
		}

		offset += uint32(chunk, 0) + 12;
	}
}

async function isAnimated(
	header: Uint8Array,
	read: ByteReader,
): Promise<boolean> {
	if (['GIF87a', 'GIF89a'].includes(ascii(header, 0, 6))) {
		return isAnimatedGif(read);
	}

	if (ascii(header, 0, 8) === '\u0089PNG\r\n\u001A\n') {
		return isAnimatedPng(read);
	}

	// Bit 1 of the VP8X flags byte is the animation flag.
	return ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 4) === 'WEBP'
		? ascii(header, 12, 4) === 'VP8X' &&
				Math.floor((header[20] ?? 0) / 2) % 2 === 1
		: ftypBrands(header).includes('avis');
}

/**
 Reads the header of a chosen file before it reaches the browser decoder:
 whether it is a refused format (HEIC/HEIF, camera RAW) and whether it holds
 an animation, of which only the first frame is imported (engine.md section
 16.4). A file that cannot be read or parsed is left to the decoder.
 */
export async function inspectImageFormat(
	blob: Blob,
	fileName: string,
): Promise<FormatInfo> {
	try {
		const read = createByteReader(blob);
		const header = await read(0, HEADER_BYTES);
		const refused = refusedFormat(header, fileName);
		return refused
			? {refused, animated: false}
			: {animated: await isAnimated(header, read)};
	} catch {
		const refused = refusedFormat(new Uint8Array(), fileName);
		return {refused, animated: false};
	}
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
		let size: {readonly width: number; readonly height: number};
		if (await isTiff(blob)) {
			size = await readTiffInfo(blob);
		} else {
			bitmap = await runtime.createImageBitmap(blob, {
				imageOrientation: 'from-image',
				colorSpaceConversion: 'default',
			});
			size = bitmap;
		}

		const {width, height} = size;
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
		let source: Blob | ImageData = blob;
		// No browser target decodes TIFF, so its pixels come from `utif2` and only
		// a resize goes through the browser.
		if (await isTiff(blob)) {
			const image = await decodeTiff(
				blob,
				options.skipDimensionLimits ? undefined : assertWithinLimits,
			);
			if (bitmapOptions.resizeQuality === undefined) {
				return {ok: true, value: image};
			}

			source = new ImageData(
				image.data as Uint8ClampedArray<ArrayBuffer>,
				image.width,
				image.height,
			);
		}

		bitmap = await runtime.createImageBitmap(source, bitmapOptions);
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
