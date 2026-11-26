import type {RgbaImage} from '../engine/types.ts';

/**
 TIFF decode and encode through `utif2` (MIT), loaded on first use so it stays
 out of the app's startup chunks (engine.md section 16.4, AC-F21.6).
 */

type Tags = Record<string, ArrayLike<number> | undefined>;

export type TiffInfo = {
	/**
	Upright dimensions: swapped when the orientation tag turns the image.
	*/
	readonly width: number;
	readonly height: number;
};

export class UnsupportedTiffError extends Error {
	override readonly name = 'UnsupportedTiffError';
}

// None, LZW, JPEG, Deflate (both codes) and PackBits.
const COMPRESSIONS = new Set([1, 5, 7, 8, 32_773, 32_946]);
const JPEG = 7;

async function loadUtif() {
	const module = await import('utif2');
	return (module as unknown as {default?: typeof module}).default ?? module;
}

export async function isTiff(blob: Blob): Promise<boolean> {
	const [a, b, c, d] = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
	return (
		(a === 0x49 && b === 0x49 && c === 0x2a && d === 0) ||
		(a === 0x4d && b === 0x4d && c === 0 && d === 0x2a)
	);
}

/**
 Ends the directory chain after the first IFD: only the first page is imported,
 and a chain that points back at itself would never finish parsing.
 */
function keepFirstDirectory(buffer: ArrayBuffer): void {
	const view = new DataView(buffer);
	const little = view.getUint8(0) === 0x49;
	const directory = view.getUint32(4, little);
	const next = directory + 2 + view.getUint16(directory, little) * 12;
	view.setUint32(next, 0);
}

function supportsLayout(
	photometric: number,
	bits: number,
	samples: number,
	compression: number,
): boolean {
	switch (photometric) {
		// WhiteIsZero
		case 0: {
			return samples === 1 && [1, 4, 8, 16].includes(bits);
		}

		// BlackIsZero
		case 1: {
			return samples === 1
				? [1, 4, 8, 16].includes(bits)
				: samples === 2 && bits === 8;
		}

		// RGB
		case 2: {
			return (samples === 3 || samples === 4) && (bits === 8 || bits === 16);
		}

		// Palette
		case 3: {
			return samples === 1 && [1, 2, 4, 8].includes(bits);
		}

		// YCbCr, which only the JPEG decoder turns into RGB.
		case 6: {
			return compression === JPEG && samples === 3 && bits === 8;
		}

		default: {
			return false;
		}
	}
}

async function readFirstDirectory(buffer: ArrayBuffer) {
	const utif = await loadUtif();
	keepFirstDirectory(buffer);
	const first = utif.decode(buffer)[0];
	const ifd = first as unknown as Tags | undefined;
	const tag = (id: number, fallback: number) =>
		ifd?.[`t${id}`]?.[0] ?? fallback;

	const width = tag(256, 0);
	const height = tag(257, 0);
	const compression = tag(259, 1);
	const samples = tag(277, 1);
	const tiled = ifd?.t322 !== undefined;
	const offsets = ifd?.[tiled ? 't324' : 't273'];
	const lengths = ifd?.[tiled ? 't325' : 't279'];
	// Some writers leave the byte counts out of a single uncompressed strip.
	const complete =
		offsets !== undefined &&
		Array.from(offsets).every(
			(offset, index) => offset + (lengths?.[index] ?? 0) <= buffer.byteLength,
		);

	if (
		!first ||
		!ifd ||
		width < 1 ||
		height < 1 ||
		!complete ||
		!COMPRESSIONS.has(compression) ||
		// Planar samples and non-integer samples.
		tag(284, 1) !== 1 ||
		tag(339, 1) !== 1 ||
		!supportsLayout(tag(262, -1), tag(258, 1), samples, compression)
	) {
		throw new UnsupportedTiffError('Unsupported or damaged TIFF file');
	}

	const orientation = tag(274, 1);
	const turned = orientation >= 5 && orientation <= 8;
	return {
		utif,
		first,
		ifd,
		tag,
		orientation,
		size: {
			width: turned ? height : width,
			height: turned ? width : height,
		},
	};
}

/**
 The dimensions of the first page, without decompressing any pixels.
 */
export async function readTiffInfo(blob: Blob): Promise<TiffInfo> {
	const {size} = await readFirstDirectory(await blob.arrayBuffer());
	return size;
}

/**
 Turns stored rows upright for TIFF orientation 2 to 8 (tag 274).
 */
export function applyOrientation(
	image: RgbaImage,
	orientation: number,
): RgbaImage {
	if (orientation < 2 || orientation > 8) {
		return image;
	}

	const {width, height} = image;
	const turned = orientation >= 5;
	const outWidth = turned ? height : width;
	const outHeight = turned ? width : height;
	const data = new Uint8ClampedArray(image.data.length);
	const from = new Uint32Array(
		image.data.buffer,
		image.data.byteOffset,
		width * height,
	);
	const to = new Uint32Array(data.buffer, data.byteOffset, width * height);
	// Whether the stored column and row run backwards in the upright image.
	const flipColumn = [2, 3, 7, 8].includes(orientation);
	const flipRow = [3, 4, 6, 7].includes(orientation);

	for (let y = 0; y < height; y++) {
		const row = flipRow ? height - 1 - y : y;
		for (let x = 0; x < width; x++) {
			const column = flipColumn ? width - 1 - x : x;
			to[turned ? column * outWidth + row : row * outWidth + column] =
				from[y * width + x];
		}
	}

	return {width: outWidth, height: outHeight, data};
}

function unpremultiply(data: Uint8ClampedArray): void {
	for (let i = 0; i < data.length; i += 4) {
		const alpha = data[i + 3];
		if (alpha > 0 && alpha < 255) {
			for (let channel = i; channel < i + 3; channel++) {
				data[channel] = Math.round((data[channel] * 255) / alpha);
			}
		}
	}
}

/**
 Decodes the first page to upright straight-alpha RGBA. 16-bit samples keep
 their high byte. `checkSize` runs before any pixel memory is allocated.
 */
export async function decodeTiff(
	blob: Blob,
	checkSize?: (width: number, height: number) => void,
): Promise<RgbaImage> {
	const buffer = await blob.arrayBuffer();
	const {utif, first, ifd, tag, orientation, size} =
		await readFirstDirectory(buffer);
	checkSize?.(size.width, size.height);

	// The JPEG decoder always writes RGB, so a grayscale page is described as RGB.
	if (tag(259, 1) === JPEG && tag(277, 1) === 1) {
		ifd.t258 = [8, 8, 8];
		ifd.t262 = [2];
		ifd.t277 = [3];
	}

	const associatedAlpha = tag(277, 1) === 4 && tag(338, 0) === 1;
	utif.decodeImage(buffer, first);
	const rgba = utif.toRGBA8(first);
	const data = new Uint8ClampedArray(
		rgba.buffer as ArrayBuffer,
		rgba.byteOffset,
		rgba.byteLength,
	);
	if (associatedAlpha) {
		unpremultiply(data);
	}

	return applyOrientation(
		{width: first.width, height: first.height, data},
		orientation,
	);
}

/**
 An uncompressed 8-bit RGBA TIFF with straight (unassociated) alpha.
 */
export async function encodeTiff({
	width,
	height,
	data,
}: RgbaImage): Promise<ArrayBuffer> {
	const utif = await loadUtif();
	return utif.encodeImage(
		new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		width,
		height,
		{t305: ['Drift'], t338: [2]},
	);
}
