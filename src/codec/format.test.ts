import {describe, expect, it} from 'vite-plus/test';
import {
	animatedAvifBytes,
	BLUE,
	bmpBytes,
	gifBytes,
	RED,
	stillAvifBytes,
} from '../../tests/fixtures/formats.ts';
import {inspectImageFormat} from './decode.ts';

function binary(text: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(text, (character) => character.codePointAt(0)!);
}

function uint32(value: number): string {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value);
	return String.fromCodePoint(...bytes);
}

function ftyp(major: string, ...compatible: string[]): Uint8Array<ArrayBuffer> {
	const body = `ftyp${major}${uint32(0)}${compatible.join('')}`;
	return binary(`${uint32(body.length + 4)}${body}`);
}

function pngChunk(type: string, data: string): string {
	return `${uint32(data.length)}${type}${data}${uint32(0)}`;
}

function png(...chunks: string[]): Uint8Array<ArrayBuffer> {
	return binary(
		`\u0089PNG\r\n\u001A\n${pngChunk('IHDR', '\0'.repeat(13))}${chunks.join('')}`,
	);
}

function webp(chunk: string, flags: number): Uint8Array<ArrayBuffer> {
	return binary(
		`RIFF${uint32(22)}WEBP${chunk}${uint32(10)}${String.fromCodePoint(flags)}${'\0'.repeat(9)}`,
	);
}

async function inspect(bytes: Uint8Array<ArrayBuffer>, name = 'photo') {
	return inspectImageFormat(new Blob([bytes]), name);
}

const acTL = (frames: number) =>
	pngChunk('acTL', `${uint32(frames)}${uint32(0)}`);
const IDAT = pngChunk('IDAT', 'x');

describe('animation detection', () => {
	it.each([
		['two-frame GIF', gifBytes([RED, BLUE]), true],
		['one-frame GIF', gifBytes([RED]), false],
		['animated PNG', png(acTL(2), IDAT), true],
		['one-frame APNG', png(acTL(1), IDAT), false],
		['still PNG', png(IDAT), false],
		['acTL after IDAT', png(IDAT, acTL(2)), false],
		['animated WebP', webp('VP8X', 0x02), true],
		['still extended WebP with alpha', webp('VP8X', 0x10), false],
		['simple WebP', webp('VP8 ', 0x02), false],
		['AVIF sequence', animatedAvifBytes(), true],
		['still AVIF', stillAvifBytes(), false],
		['BMP', bmpBytes(RED), false],
	] as const)('reads a %s', async (_label, bytes, animated) => {
		expect(await inspect(bytes)).toEqual({animated});
	});

	it('finds a second GIF frame beyond the first read chunk', async () => {
		const gif = gifBytes([RED]);
		// A 200,000-byte comment ahead of two copies of the frame.
		const block = [255, ...Array.from({length: 255}, () => 1)];
		const comment = [
			0x21,
			0xfe,
			...Array.from({length: 800}, () => block).flat(),
			0,
		];
		const head = gif.subarray(0, 25);
		const frame = gif.subarray(25, -1);
		const bytes = new Uint8Array([
			...head,
			...frame,
			...comment,
			...frame,
			0x3b,
		]);

		expect(await inspect(bytes)).toEqual({animated: true});
	});

	it('treats truncated files as still and leaves them to the decoder', async () => {
		const gif = gifBytes([RED, BLUE]);
		for (const length of [0, 6, 20, 40]) {
			expect(await inspect(gif.slice(0, length))).toEqual({animated: false});
		}

		expect(await inspect(png(acTL(2)).slice(0, 40))).toEqual({
			animated: false,
		});
	});
});

describe('refused formats', () => {
	it.each(['dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'DNG'])(
		'refuses a .%s file as RAW',
		async (extension) => {
			expect(
				await inspect(binary('II*\0data'), `shot.${extension}`),
			).toMatchObject({refused: 'raw'});
		},
	);

	it.each([
		['CR2', binary('II*\0\u0010\0\0\0CR\u0002\0')],
		['CR3', ftyp('crx ', 'isom')],
		['RAF', binary('FUJIFILMCCD-RAW 0201')],
		['ORF', binary('IIRO\u0008\0\0\0')],
		['RW2', binary('IIU\0\u0018\0\0\0')],
	])('refuses a renamed %s file by its header', async (_label, bytes) => {
		expect(await inspect(bytes, 'shot.jpg')).toMatchObject({refused: 'raw'});
	});

	it.each(['heic', 'heif', 'HEIC'])(
		'refuses a .%s file as HEIC',
		async (extension) => {
			expect(await inspect(binary('data'), `shot.${extension}`)).toMatchObject({
				refused: 'heic',
			});
		},
	);

	it.each([
		['heic brand', ftyp('heic', 'mif1')],
		['heix brand', ftyp('heix')],
		['mif1 without an AVIF brand', ftyp('mif1', 'mif1', 'heic')],
	])('refuses a renamed HEIC with the %s', async (_label, bytes) => {
		expect(await inspect(bytes, 'shot.jpg')).toMatchObject({refused: 'heic'});
	});

	it('accepts an AVIF whose major brand is mif1', async () => {
		expect(
			await inspect(ftyp('mif1', 'mif1', 'avif', 'miaf'), 'shot.avif'),
		).toEqual({animated: false});
	});

	it('does not refuse a plain TIFF header', async () => {
		expect(await inspect(binary('II*\0\u0008\0\0\0\0\0'), 'scan.tif')).toEqual({
			animated: false,
		});
	});
});
