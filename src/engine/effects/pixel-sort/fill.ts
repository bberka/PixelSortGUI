/* eslint-disable no-bitwise -- packed sort words: key16 in the high half, line index in the low half */
import {P_SHUFFLE, unit4} from './select.ts';

// 'builtin' exists so tests can prove the radix sort against `Uint32Array.prototype.sort`.
export type Sorter = 'radix' | 'builtin';

const INSERTION_MAX = 32;

/**
 Packs `c * 65536 + localIndex` for the interval at `start`. Words are unique,
 so any correct sort of them is the stable sort of engine.md section 5.5.
 `divisor` is `discretize * 257`, or 0 for no discretize.
 */
export function packKeys(
	keys: Uint16Array,
	start: number,
	length: number,
	divisor: number,
	descending: boolean,
	packed: Uint32Array,
): void {
	if (divisor === 0 && !descending) {
		for (let i = 0; i < length; i++) {
			packed[i] = (keys[start + i] << 16) | i;
		}

		return;
	}

	for (let i = 0; i < length; i++) {
		let c: number = keys[start + i];
		if (divisor !== 0) {
			c = Math.floor(c / divisor);
		}

		if (descending) {
			c = 65_535 - c;
		}

		packed[i] = (c << 16) | i;
	}
}

function insertionSort(words: Uint32Array, length: number): void {
	for (let i = 1; i < length; i++) {
		const value = words[i];
		let j = i - 1;
		while (j >= 0 && words[j] > value) {
			words[j + 1] = words[j];
			j--;
		}

		words[j + 1] = value;
	}
}

/**
 Two-pass 8-bit LSD radix sort on the key half of each word. The low half
 already ascends, and each pass is stable, so the result is fully sorted. A
 pass whose digit is the same in every word would not move anything and is
 skipped. `counts` needs 512 entries.
 */
function radixSort(
	words: Uint32Array,
	spare: Uint32Array,
	counts: Int32Array,
	length: number,
): Uint32Array {
	counts.fill(0);
	for (let i = 0; i < length; i++) {
		const word = words[i];
		counts[(word >>> 16) & 0xff]++;
		counts[256 + (word >>> 24)]++;
	}

	const first = words[0];
	let from = words;
	let to = spare;
	if (counts[(first >>> 16) & 0xff] !== length) {
		let sum = 0;
		for (let digit = 0; digit < 256; digit++) {
			const count = counts[digit];
			counts[digit] = sum;
			sum += count;
		}

		for (let i = 0; i < length; i++) {
			const word = from[i];
			to[counts[(word >>> 16) & 0xff]++] = word;
		}

		from = spare;
		to = words;
	}

	if (counts[256 + (first >>> 24)] !== length) {
		let sum = 0;
		for (let digit = 256; digit < 512; digit++) {
			const count = counts[digit];
			counts[digit] = sum;
			sum += count;
		}

		for (let i = 0; i < length; i++) {
			const word = from[i];
			to[counts[256 + (word >>> 24)]++] = word;
		}

		from = to;
	}

	return from;
}

// Sorts the first `length` words ascending and returns the buffer that holds them: `words` or `spare`.
export function sortPacked(
	words: Uint32Array,
	spare: Uint32Array,
	counts: Int32Array,
	length: number,
	sorter: Sorter,
): Uint32Array {
	if (sorter === 'builtin') {
		words.subarray(0, length).sort();
		return words;
	}

	if (length <= INSERTION_MAX) {
		insertionSort(words, length);
		return words;
	}

	return radixSort(words, spare, counts, length);
}

// Fisher–Yates of engine.md section 5.5 over local indices `0..length-1`.
export function shuffleIndices(
	indices: Uint32Array,
	length: number,
	seed: number,
	lineId: number,
	sourcePosition: number,
): void {
	for (let i = 0; i < length; i++) {
		indices[i] = i;
	}

	for (let j = length - 1; j >= 1; j--) {
		const t = Math.floor(
			unit4(seed, P_SHUFFLE, lineId, sourcePosition, j) * (j + 1),
		);
		const held = indices[j];
		indices[j] = indices[t];
		indices[t] = held;
	}
}

export function fillSort(
	pixels: Uint32Array,
	out: Uint32Array,
	start: number,
	length: number,
	ordered: Uint32Array,
): void {
	for (let i = 0; i < length; i++) {
		out[start + i] = pixels[start + (ordered[i] & 0xff_ff)];
	}
}

export function fillAverage(
	bytes: Uint8Array,
	outBytes: Uint8Array,
	start: number,
	length: number,
): void {
	const begin = start * 4;
	const end = begin + length * 4;
	let r = 0;
	let g = 0;
	let b = 0;
	let a = 0;
	for (let p = begin; p < end; p += 4) {
		r += bytes[p];
		g += bytes[p + 1];
		b += bytes[p + 2];
		a += bytes[p + 3];
	}

	const den = 2 * length;
	r = Math.floor((2 * r + length) / den);
	g = Math.floor((2 * g + length) / den);
	b = Math.floor((2 * b + length) / den);
	a = Math.floor((2 * a + length) / den);
	for (let p = begin; p < end; p += 4) {
		outBytes[p] = r;
		outBytes[p + 1] = g;
		outBytes[p + 2] = b;
		outBytes[p + 3] = a;
	}
}

// `first` and `last` are the local indices of the first and last ordered pixel.
export function fillGradient(
	bytes: Uint8Array,
	outBytes: Uint8Array,
	start: number,
	length: number,
	first: number,
	last: number,
): void {
	const s = (start + first) * 4;
	const e = (start + last) * 4;
	const span = length - 1;
	const den = 2 * span;
	for (let channel = 0; channel < 4; channel++) {
		const from = bytes[s + channel];
		const to = bytes[e + channel];
		let p = start * 4 + channel;
		for (let j = 0; j < length; j++, p += 4) {
			outBytes[p] = Math.floor((2 * (from * (span - j) + to * j) + span) / den);
		}
	}
}

/**
 Local indices of the smallest and largest packed word, which are the two ends
 of the sorted order, returned as `first * 65536 + last`.
 */
export function packedExtremes(packed: Uint32Array, length: number): number {
	let min = packed[0];
	let max = min;
	for (let i = 1; i < length; i++) {
		const word = packed[i];
		if (word < min) {
			min = word;
		} else if (word > max) {
			max = word;
		}
	}

	return (min & 0xff_ff) * 65_536 + (max & 0xff_ff);
}
