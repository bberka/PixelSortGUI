import {Buffer} from 'node:buffer';
import {constants, deflateRawSync} from 'node:zlib';
import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {inflateRaw} from './inflate.ts';

function roundTrip(
	input: Uint8Array,
	options: Parameters<typeof deflateRawSync>[1],
) {
	return Buffer.from(inflateRaw(deflateRawSync(input, options)));
}

// Level 0 writes stored blocks; Z_FIXED forces the fixed Huffman tables.
const MODES = [{level: 0}, {level: 9}, {strategy: constants.Z_FIXED}] as const;

describe('inflateRaw', () => {
	it('inverts every block type, including long runs and several blocks', () => {
		const input = Buffer.alloc(200_000);
		for (let i = 0; i < input.length; i++) {
			input[i] = i < 100_000 ? (i * i) % 251 : i % 3;
		}

		for (const options of MODES) {
			expect(roundTrip(input, options).equals(input)).toBe(true);
		}
	});

	it('inverts arbitrary bytes', () => {
		fc.assert(
			fc.property(
				fc.uint8Array({maxLength: 2000}),
				fc.constantFrom(...MODES),
				(input, options) => {
					expect(roundTrip(input, options).equals(input)).toBe(true);
				},
			),
		);
	});

	it('throws on truncated and invalid data instead of looping', () => {
		const whole = deflateRawSync(Buffer.alloc(5000, 7));
		expect(() => inflateRaw(whole.subarray(0, 3))).toThrow('Invalid deflate');
		// Block type 3 is reserved.
		expect(() => inflateRaw(new Uint8Array([0b111]))).toThrow(
			'Invalid deflate',
		);
		expect(() => inflateRaw(new Uint8Array())).toThrow('Invalid deflate');
	});
});
