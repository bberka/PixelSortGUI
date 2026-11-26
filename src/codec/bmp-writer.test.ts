import {describe, expect, it} from 'vite-plus/test';
import {writeBmp} from './bmp-writer.ts';

function header(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer);
	return {
		magic: String.fromCodePoint(bytes[0], bytes[1]),
		fileSize: view.getUint32(2, true),
		dataOffset: view.getUint32(10, true),
		headerSize: view.getUint32(14, true),
		width: view.getInt32(18, true),
		height: view.getInt32(22, true),
		planes: view.getUint16(26, true),
		bits: view.getUint16(28, true),
		compression: view.getUint32(30, true),
		imageSize: view.getUint32(34, true),
		colorsUsed: view.getUint32(46, true),
	};
}

describe('writeBmp', () => {
	it('writes an opaque image as padded bottom-up 24-bit BGR', () => {
		const bytes = writeBmp({
			width: 1,
			height: 2,
			data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
		});

		expect(header(bytes)).toEqual({
			magic: 'BM',
			fileSize: 62,
			dataOffset: 54,
			headerSize: 40,
			width: 1,
			height: 2,
			planes: 1,
			bits: 24,
			compression: 0,
			imageSize: 8,
			colorsUsed: 0,
		});
		expect([...bytes.subarray(54)]).toEqual([6, 5, 4, 0, 3, 2, 1, 0]);
	});

	it('writes 32-bit BGRA when any pixel is transparent', () => {
		const bytes = writeBmp({
			width: 2,
			height: 1,
			data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 128]),
		});

		expect(header(bytes)).toMatchObject({bits: 32, fileSize: 62});
		expect([...bytes.subarray(54)]).toEqual([3, 2, 1, 255, 6, 5, 4, 128]);
	});
});
