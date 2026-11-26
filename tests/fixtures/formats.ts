/* eslint-disable no-bitwise -- GIF LZW codes and little-endian fields are bit-packed */

/**
 Tiny image files for the import format tests (engine.md section 16.4): GIF and
 BMP are written byte by byte, and the AVIF pair was encoded with `avifenc`
 from solid 8 × 6 px colours.
 */

export const FIXTURE_WIDTH = 8;
export const FIXTURE_HEIGHT = 6;

export type Rgb = readonly [number, number, number];

export const RED: Rgb = [200, 30, 30];
export const BLUE: Rgb = [30, 30, 200];

function ascii(text: string): number[] {
	return Array.from(text, (character) => character.codePointAt(0)!);
}

function le16(value: number): number[] {
	return [value & 0xff, (value >> 8) & 0xff];
}

function le32(value: number): number[] {
	return [...le16(value), ...le16(value >>> 16)];
}

/**
 LZW image data for one solid frame: 3-bit codes, with a clear code before
 every second pixel so the code width never grows.
 */
function gifImageData(colorIndex: number): number[] {
	const clear = 4;
	const end = 5;
	const codes: number[] = [];
	for (let pixel = 0; pixel < FIXTURE_WIDTH * FIXTURE_HEIGHT; pixel += 2) {
		codes.push(clear, colorIndex, colorIndex);
	}

	codes.push(end);

	const bytes: number[] = [];
	let buffer = 0;
	let bits = 0;
	for (const code of codes) {
		buffer |= code << bits;
		bits += 3;
		while (bits >= 8) {
			bytes.push(buffer & 0xff);
			buffer >>= 8;
			bits -= 8;
		}
	}

	if (bits > 0) {
		bytes.push(buffer);
	}

	// Minimum code size, one sub-block (under 256 bytes), terminator.
	return [2, bytes.length, ...bytes, 0];
}

/**
 A GIF with one solid frame per colour, looping when there are several.
 */
export function gifBytes(frames: readonly Rgb[]): Uint8Array<ArrayBuffer> {
	const palette = [0, 1, 2, 3].flatMap((index) => frames[index] ?? [0, 0, 0]);
	const loop = [0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, 0, 0, 0];

	return new Uint8Array([
		...ascii('GIF89a'),
		...le16(FIXTURE_WIDTH),
		...le16(FIXTURE_HEIGHT),
		0x81,
		0,
		0,
		...palette,
		...(frames.length > 1 ? loop : []),
		...frames.flatMap((_, index) => [
			0x21,
			0xf9,
			4,
			0,
			10,
			0,
			0,
			0,
			0x2c,
			0,
			0,
			0,
			0,
			...le16(FIXTURE_WIDTH),
			...le16(FIXTURE_HEIGHT),
			0,
			...gifImageData(index),
		]),
		0x3b,
	]);
}

/**
 A solid 24-bit uncompressed BMP.
 */
export function bmpBytes([red, green, blue]: Rgb): Uint8Array<ArrayBuffer> {
	const rowBytes = Math.ceil((FIXTURE_WIDTH * 3) / 4) * 4;
	const row = Array.from({length: rowBytes}, (_, index) =>
		index < FIXTURE_WIDTH * 3 ? [blue, green, red][index % 3] : 0,
	);
	const pixels = Array.from({length: FIXTURE_HEIGHT}, () => row).flat();

	return new Uint8Array([
		...ascii('BM'),
		...le32(54 + pixels.length),
		...le32(0),
		...le32(54),
		...le32(40),
		...le32(FIXTURE_WIDTH),
		...le32(FIXTURE_HEIGHT),
		...le16(1),
		...le16(24),
		...le32(0),
		...le32(pixels.length),
		...le32(2835),
		...le32(2835),
		...le32(0),
		...le32(0),
		...pixels,
	]);
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(
		// eslint-disable-next-line no-restricted-globals -- shared with Node and the unit tests; the input is a constant
		atob(base64),
		(character) => character.codePointAt(0)!,
	);
}

/**
 A still red AVIF.
 */
export function stillAvifBytes(): Uint8Array<ArrayBuffer> {
	return fromBase64(
		'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUEAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAIAAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAACAAAAAYAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBIAAAAAAAE2NvbHJuY2x4AAEAAgAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAKG1kYXQSAAoIOAi9YQECBpAyEhAAAAAP+kAMd7HqeCAT9ruh1A==',
	);
}

/**
 A two-frame AVIF sequence: red, then blue.
 */
export function animatedAvifBytes(): Uint8Array<ArrayBuffer> {
	return fromBase64(
		'AAAALGZ0eXBhdmlzAAAAAGF2aWZhdmlzbXNmMWlzbzhtaWYxbWlhZk1BMUEAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAPlAAAAJQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAACAAAAAYAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBIAAAAAAAE2NvbHJuY2x4AAEAAgAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAACxm1vb3YAAAB4bXZoZAEAAAAAAAAA5y3gUwAAAADnLeBTAAAAAv//////////AAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAJGdHJhawAAAGh0a2hkAQAAAQAAAADnLeBTAAAAAOct4FMAAAABAAAAAP//////////AAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAIAAAABgAAAAAALGVkdHMAAAAkZWxzdAEAAAEAAAABAAAAAAAAAAIAAAAAAAAAAAABAAAAAAGqbWRpYQAAACxtZGhkAQAAAAAAAADnLeBTAAAAAOct4FMAAAACAAAAAAAAAAJVxAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAABVW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAARVzdGJsAAAAlXN0c2QAAAAAAAAAAQAAAIVhdjAxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAgABgBIAAAASAAAAAAAAAABCkFPTSBDb2RpbmcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAADGF2MUOBIAAAAAAAE2NvbHJuY2x4AAEAAgAGgAAAABBjY3N0AAAAAHwAAAAAAAAYc3R0cwAAAAAAAAABAAAAAgAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAIAAAABAAAAHHN0c3oAAAAAAAAAAAAAAAIAAAAlAAAAHgAAABRzdGNvAAAAAAAAAAEAAAPlAAAAFHN0c3MAAAAAAAAAAQAAAAEAAABLbWRhdBIACgwgAAABF6bXzQECBpAyExAAgAAAD/pADHex6nggE/a7odQSADIaMAPAgAAAegAEAAAAlY+osKkpn5diIWH8xOA=',
	);
}
