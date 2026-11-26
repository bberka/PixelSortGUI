/* eslint-disable no-bitwise -- DEFLATE is a bit stream */

/**
 Raw DEFLATE (RFC 1951) decompression. The build aliases `pako` to this module,
 because `utif2` needs a synchronous `inflateRaw` and pako's Zlib licence is
 not on the allowed list (engine.md section 16.4).
 */

type Huffman = {
	// Number of codes of each length.
	readonly counts: Uint16Array;
	// Symbols ordered by code.
	readonly symbols: Uint16Array;
};

const LENGTH_BASE = [
	3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
	83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
	0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
	5, 5, 0,
];
const DISTANCE_BASE = [
	1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
	1025, 1537, 2049, 3073, 4097, 6145, 8193, 12_289, 16_385, 24_577,
];
const DISTANCE_EXTRA = [
	0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
	11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [
	16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

function corrupt(): never {
	throw new Error('Invalid deflate data');
}

function buildHuffman(lengths: Uint8Array): Huffman {
	const counts = new Uint16Array(16);
	for (const length of lengths) {
		counts[length]++;
	}

	counts[0] = 0;
	const offsets = new Uint16Array(16);
	for (let length = 1; length < 16; length++) {
		offsets[length] = offsets[length - 1] + counts[length - 1];
	}

	const symbols = new Uint16Array(lengths.length);
	for (const [symbol, length] of lengths.entries()) {
		if (length > 0) {
			symbols[offsets[length]++] = symbol;
		}
	}

	return {counts, symbols};
}

const FIXED_LITERALS = buildHuffman(
	new Uint8Array(288).fill(8).fill(9, 144, 256).fill(7, 256, 280),
);
const FIXED_DISTANCES = buildHuffman(new Uint8Array(30).fill(5));

export function inflateRaw(input: Uint8Array): Uint8Array<ArrayBuffer> {
	let position = 0;
	let buffer = 0;
	let buffered = 0;
	let out = new Uint8Array(Math.max(1024, input.length * 3));
	let size = 0;

	const bits = (count: number): number => {
		while (buffered < count) {
			if (position >= input.length) {
				corrupt();
			}

			buffer |= input[position++] << buffered;
			buffered += 8;
		}

		const value = buffer & ((1 << count) - 1);
		buffer >>>= count;
		buffered -= count;
		return value;
	};

	// Canonical codes of one length are consecutive, so a code is found by
	// reading one bit at a time and comparing with the first code of its length.
	const decode = ({counts, symbols}: Huffman): number => {
		let code = 0;
		let first = 0;
		let index = 0;
		for (let length = 1; length < 16; length++) {
			code |= bits(1);
			const count = counts[length];
			if (code - first < count) {
				return symbols[index + code - first];
			}

			index += count;
			first = (first + count) << 1;
			code <<= 1;
		}

		return corrupt();
	};

	const reserve = (extra: number): void => {
		if (size + extra <= out.length) {
			return;
		}

		const grown = new Uint8Array(Math.max(out.length * 2, size + extra));
		grown.set(out.subarray(0, size));
		out = grown;
	};

	const readDynamicTables = (): [Huffman, Huffman] => {
		const literalCount = bits(5) + 257;
		const distanceCount = bits(5) + 1;
		const codeCount = bits(4) + 4;
		const codeLengths = new Uint8Array(19);
		for (let i = 0; i < codeCount; i++) {
			codeLengths[CODE_LENGTH_ORDER[i]] = bits(3);
		}

		const codes = buildHuffman(codeLengths);
		const lengths = new Uint8Array(literalCount + distanceCount);
		for (let i = 0; i < lengths.length;) {
			const symbol = decode(codes);
			if (symbol < 16) {
				lengths[i++] = symbol;
				continue;
			}

			if (symbol === 16 && i === 0) {
				corrupt();
			}

			const value = symbol === 16 ? lengths[i - 1] : 0;
			const repeat =
				symbol === 16
					? 3 + bits(2)
					: symbol === 17
						? 3 + bits(3)
						: 11 + bits(7);
			if (i + repeat > lengths.length) {
				corrupt();
			}

			lengths.fill(value, i, i + repeat);
			i += repeat;
		}

		return [
			buildHuffman(lengths.subarray(0, literalCount)),
			buildHuffman(lengths.subarray(literalCount)),
		];
	};

	const readCompressed = (literals: Huffman, distances: Huffman): void => {
		for (;;) {
			const symbol = decode(literals);
			if (symbol < 256) {
				reserve(1);
				out[size++] = symbol;
				continue;
			}

			if (symbol === 256) {
				return;
			}

			const index = symbol - 257;
			if (index >= LENGTH_BASE.length) {
				corrupt();
			}

			const length = LENGTH_BASE[index] + bits(LENGTH_EXTRA[index]);
			const code = decode(distances);
			const distance = DISTANCE_BASE[code] + bits(DISTANCE_EXTRA[code]);
			if (!(distance <= size)) {
				corrupt();
			}

			reserve(length);
			// Byte by byte: a match may overlap the bytes it is producing.
			for (let i = 0; i < length; i++, size++) {
				out[size] = out[size - distance];
			}
		}
	};

	let last = 0;
	while (last === 0) {
		last = bits(1);
		const type = bits(2);
		switch (type) {
			case 0: {
				// A stored block starts on a byte boundary.
				buffer = 0;
				buffered = 0;
				const length = bits(16);
				if (
					(length ^ bits(16)) !== 0xff_ff ||
					position + length > input.length
				) {
					corrupt();
				}

				reserve(length);
				out.set(input.subarray(position, position + length), size);
				position += length;
				size += length;

				break;
			}

			case 1: {
				readCompressed(FIXED_LITERALS, FIXED_DISTANCES);

				break;
			}

			case 2: {
				readCompressed(...readDynamicTables());

				break;
			}

			default: {
				corrupt();
			}
		}
	}

	return out.subarray(0, size);
}
