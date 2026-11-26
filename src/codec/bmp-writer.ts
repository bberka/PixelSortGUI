import type {RgbaImage} from '../engine/types.ts';

const FILE_HEADER_BYTES = 14;
const INFO_HEADER_BYTES = 40;
export const BMP_HEADER_BYTES = FILE_HEADER_BYTES + INFO_HEADER_BYTES;
// 72 dpi in pixels per metre.
const PIXELS_PER_METRE = 2835;

/**
 3 for an opaque image, 4 when any pixel has transparency.
 */
export function bmpBytesPerPixel({data}: RgbaImage): 3 | 4 {
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < 255) {
			return 4;
		}
	}

	return 3;
}

/**
 An uncompressed (BI_RGB) 24-bit or 32-bit BMP with bottom-up rows, each padded
 to a multiple of four bytes. It carries no metadata and no colour profile.
 */
export function writeBmp(image: RgbaImage): Uint8Array<ArrayBuffer> {
	const {width, height, data} = image;
	const bytesPerPixel = bmpBytesPerPixel(image);
	const rowBytes = Math.ceil((width * bytesPerPixel) / 4) * 4;
	const pixelBytes = rowBytes * height;
	const out = new Uint8Array(BMP_HEADER_BYTES + pixelBytes);
	const view = new DataView(out.buffer);

	out[0] = 0x42;
	out[1] = 0x4d;
	view.setUint32(2, out.length, true);
	view.setUint32(10, BMP_HEADER_BYTES, true);
	view.setUint32(14, INFO_HEADER_BYTES, true);
	view.setInt32(18, width, true);
	view.setInt32(22, height, true);
	view.setUint16(26, 1, true);
	view.setUint16(28, bytesPerPixel * 8, true);
	view.setUint32(34, pixelBytes, true);
	view.setInt32(38, PIXELS_PER_METRE, true);
	view.setInt32(42, PIXELS_PER_METRE, true);

	for (let y = 0; y < height; y++) {
		let from = (height - 1 - y) * width * 4;
		let to = BMP_HEADER_BYTES + y * rowBytes;
		for (let x = 0; x < width; x++) {
			out[to] = data[from + 2];
			out[to + 1] = data[from + 1];
			out[to + 2] = data[from];
			if (bytesPerPixel === 4) {
				out[to + 3] = data[from + 3];
			}

			from += 4;
			to += bytesPerPixel;
		}
	}

	return out;
}
