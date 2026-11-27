import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import fc from 'fast-check';
import {deflateSync} from 'fflate';
import {describe, expect, it} from 'vite-plus/test';
import {
	decodeMaskAsset,
	encodeMaskAsset,
	MaskAssetError,
	maskBytes,
	type MaskAsset,
} from '../../src/engine/mask/asset.ts';
import type {MaskBitmap} from '../../src/engine/mask/brush-types.ts';
import {createMask} from '../../src/engine/mask/brush.ts';
import {hash32} from '../../src/engine/random.ts';

const TINY: MaskBitmap = {width: 2, height: 1, data: new Uint8Array([7, 9])};
const TINY_BYTES = [0x44, 0x4d, 0x53, 0x4b, 2, 0, 0, 0, 1, 0, 0, 0, 7, 9];

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

// Incompressible, so the stream spans many inflate steps.
function noiseMask(width: number, height: number): MaskBitmap {
	const mask = createMask(width, height);
	for (let i = 0; i < mask.data.length; i++) {
		mask.data[i] = hash32(1, i) & 255; // eslint-disable-line no-bitwise
	}

	return mask;
}

// An asset whose compressed data inflates to `bytes`, with a matching hash.
function forged(
	bytes: Uint8Array,
	overrides: Partial<MaskAsset> = {},
): MaskAsset {
	return {
		sha256: sha256(bytes),
		width: 2,
		height: 1,
		compressed: new Uint8Array(deflateSync(bytes)),
		...overrides,
	};
}

describe('mask asset', () => {
	it('lays out the canonical bytes', () => {
		expect(Array.from(maskBytes(TINY))).toEqual(TINY_BYTES);
		const wide = maskBytes(createMask(258, 2));
		expect(Array.from(wide.subarray(4, 12))).toEqual([2, 1, 0, 0, 2, 0, 0, 0]);
		expect(wide).toHaveLength(12 + 516);
	});

	it('hashes the canonical bytes, whatever the compression', async () => {
		const asset = await encodeMaskAsset(TINY);
		expect(asset.sha256).toBe(sha256(new Uint8Array(TINY_BYTES)));
		expect(await encodeMaskAsset(TINY)).toEqual(asset);
		const stored = deflateSync(maskBytes(TINY), {level: 0});
		await expect(
			decodeMaskAsset({...asset, compressed: stored}),
		).resolves.toEqual(TINY);
	});

	it('writes raw DEFLATE that DecompressionStream reads', async () => {
		const mask = noiseMask(300, 200);
		const {compressed} = await encodeMaskAsset(mask);
		const stream = new Blob([compressed])
			.stream()
			.pipeThrough(new DecompressionStream('deflate-raw'));
		const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
		expect(bytes).toEqual(maskBytes(mask));
	});

	it('round trips any bitmap', async () => {
		const side = fc.integer({min: 1, max: 40});
		await fc.assert(
			fc.asyncProperty(
				side.chain((width) =>
					side.chain((height) =>
						fc.record({
							width: fc.constant(width),
							height: fc.constant(height),
							data: fc.uint8Array({
								minLength: width * height,
								maxLength: width * height,
							}),
						}),
					),
				),
				async (mask) => {
					const asset = await encodeMaskAsset(mask);
					expect(await decodeMaskAsset(asset)).toEqual(mask);
				},
			),
		);
	});

	it.each([
		['an incompressible mask', noiseMask(700, 500)],
		['a mask at the pixel cap', createMask(2048, 2048, 255)],
	])('round trips %s', async (_, mask) => {
		const decoded = await decodeMaskAsset(await encodeMaskAsset(mask));
		expect(decoded.width).toBe(mask.width);
		expect(Buffer.from(decoded.data).equals(mask.data)).toBe(true);
	});

	it('refuses to encode a bitmap that is not a grid within the cap', async () => {
		for (const mask of [
			{width: 2, height: 2, data: new Uint8Array(3)},
			{width: 0, height: 1, data: new Uint8Array(0)},
			{width: 1.5, height: 2, data: new Uint8Array(3)},
			createMask(2049, 2048),
		]) {
			await expect(encodeMaskAsset(mask)).rejects.toThrow(MaskAssetError);
		}
	});

	it('stops at the cap on an oversized stream', async () => {
		const bomb = deflateSync(new Uint8Array(32 * 1024 * 1024));
		await expect(
			decodeMaskAsset(forged(new Uint8Array(1), {compressed: bomb})),
		).rejects.toThrow(new MaskAssetError('Mask data is longer than 14 bytes'));
	});

	it('rejects one byte too many and one too few', async () => {
		await expect(
			decodeMaskAsset(forged(new Uint8Array([...TINY_BYTES, 0]))),
		).rejects.toThrow('longer than 14 bytes');
		await expect(
			decodeMaskAsset(forged(new Uint8Array(TINY_BYTES.slice(0, -1)))),
		).rejects.toThrow('13 of 14 bytes');
	});

	it('rejects damaged and truncated streams', async () => {
		const asset = await encodeMaskAsset(noiseMask(100, 100));
		for (const compressed of [
			new Uint8Array(0),
			new Uint8Array([0xff, 0xff, 0xff, 0xff]),
			asset.compressed.subarray(0, -20),
		]) {
			await expect(decodeMaskAsset({...asset, compressed})).rejects.toThrow(
				MaskAssetError,
			);
		}
	});

	it('rejects a wrong header, size or hash', async () => {
		const magic = new Uint8Array(TINY_BYTES);
		magic[0] = 0;
		await expect(decodeMaskAsset(forged(magic))).rejects.toThrow('header');

		const asset = await encodeMaskAsset(TINY);
		// The same byte count with the sides swapped.
		await expect(
			decodeMaskAsset({...asset, width: 1, height: 2}),
		).rejects.toThrow('header');
		await expect(
			decodeMaskAsset({...asset, sha256: '0'.repeat(64)}),
		).rejects.toThrow('hash');
		await expect(
			decodeMaskAsset({...asset, width: 100_000, height: 100_000}),
		).rejects.toThrow('Invalid mask size');
	});
});
