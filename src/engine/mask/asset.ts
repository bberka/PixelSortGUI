// Painted mask assets: canonical bytes, mask hash and compression
// (engine.md section 16.6, persistence.md section 8.6).

import {deflateSync, Inflate} from 'fflate';
import type {MaskBitmap} from './brush-types.ts';
import {MASK_PIXEL_CAP} from './coords.ts';

// `DMSK`.
const MAGIC = [0x44, 0x4d, 0x53, 0x4b];
export const MASK_HEADER_BYTES = 12;
// One DEFLATE step expands at most about 1032 times, so this bounds what a
// hostile stream can produce before the cap stops it to about 1 MiB.
const INFLATE_STEP_BYTES = 1024;

export type MaskAsset = {
	// SHA-256 of the canonical bytes, 64 lowercase hex characters.
	sha256: string;
	width: number;
	height: number;
	// Raw DEFLATE of the canonical bytes.
	compressed: Uint8Array<ArrayBuffer>;
};

export class MaskAssetError extends Error {
	override name = 'MaskAssetError';
}

function assertGridSize(width: number, height: number): void {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width * height > MASK_PIXEL_CAP
	) {
		throw new MaskAssetError(`Invalid mask size ${width}x${height}`);
	}
}

export function maskBytes({
	width,
	height,
	data,
}: MaskBitmap): Uint8Array<ArrayBuffer> {
	assertGridSize(width, height);
	if (data.length !== width * height) {
		throw new MaskAssetError(
			`A ${width}x${height} mask cannot hold ${data.length} bytes`,
		);
	}

	const bytes = new Uint8Array(MASK_HEADER_BYTES + data.length);
	bytes.set(MAGIC);
	const view = new DataView(bytes.buffer);
	view.setUint32(4, width, true);
	view.setUint32(8, height, true);
	bytes.set(data, MASK_HEADER_BYTES);
	return bytes;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}

export async function encodeMaskAsset(bitmap: MaskBitmap): Promise<MaskAsset> {
	const bytes = maskBytes(bitmap);
	return {
		sha256: await sha256Hex(bytes),
		width: bitmap.width,
		height: bitmap.height,
		compressed: new Uint8Array(deflateSync(bytes)),
	};
}

// Inflates raw DEFLATE, stopping as soon as the output passes `length` bytes.
function inflateExactly(
	compressed: Uint8Array,
	length: number,
): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(length);
	let size = 0;
	const inflate = new Inflate((chunk) => {
		if (size + chunk.length > length) {
			throw new MaskAssetError(`Mask data is longer than ${length} bytes`);
		}

		out.set(chunk, size);
		size += chunk.length;
	});
	try {
		let start = 0;
		do {
			const end = start + INFLATE_STEP_BYTES;
			inflate.push(compressed.subarray(start, end), end >= compressed.length);
			start = end;
		} while (start < compressed.length);
	} catch (error) {
		if (error instanceof MaskAssetError) {
			throw error;
		}

		throw new MaskAssetError('Mask data cannot be decompressed', {
			cause: error,
		});
	}

	if (size !== length) {
		throw new MaskAssetError(`Mask data is ${size} of ${length} bytes`);
	}

	return out;
}

/**
 The bitmap of an asset. Rejects with `MaskAssetError` unless the data
 decompresses to exactly the canonical bytes of the stated size and hash.
 */
export async function decodeMaskAsset({
	sha256,
	width,
	height,
	compressed,
}: Readonly<
	Omit<MaskAsset, 'compressed'> & {compressed: Uint8Array}
>): Promise<MaskBitmap> {
	assertGridSize(width, height);
	const bytes = inflateExactly(compressed, MASK_HEADER_BYTES + width * height);
	const view = new DataView(bytes.buffer);
	if (
		MAGIC.some((byte, index) => bytes[index] !== byte) ||
		view.getUint32(4, true) !== width ||
		view.getUint32(8, true) !== height
	) {
		throw new MaskAssetError('Mask data has the wrong header');
	}

	if ((await sha256Hex(bytes)) !== sha256) {
		throw new MaskAssetError('Mask data does not match its hash');
	}

	return {width, height, data: bytes.subarray(MASK_HEADER_BYTES)};
}
