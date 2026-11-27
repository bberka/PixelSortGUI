/* eslint-disable no-bitwise -- packed sort words: key16 in the high half, line index in the low half */
import {P_CHANNEL_SHUFFLE, P_SHUFFLE, unit4, unit5} from './select.ts';
import type {IntervalTransform} from './spec.ts';

// 'builtin' exists so tests can prove the radix sort against `Uint32Array.prototype.sort`.
export type Sorter = 'radix' | 'builtin';

const INSERTION_MAX = 32;

/**
 Exact bijective index mapping for `intervalTransform` (engine.md section 5.5).
 Maps output position `index` in `0..length-1` to ordered source position `k`.
 */
export function transformIndex(
	mode: IntervalTransform,
	index: number,
	length: number,
): number {
	switch (mode) {
		case 'none': {
			return index;
		}

		case 'reverse': {
			return length - 1 - index;
		}

		case 'mirror': {
			const mid = (length + 1) >> 1;
			return index < mid ? index * 2 : 2 * (length - 1 - index) + 1;
		}

		case 'splice': {
			const shift = length >> 1;
			const moved = index + shift;
			return moved < length ? moved : moved - length;
		}

		case 'fold': {
			const left = length >> 1;
			return index < left ? 2 * (left - 1 - index) + 1 : 2 * (index - left);
		}
	}
}

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

/**
 Packs `c * 65536 + localIndex` using one RGBA byte channel's own key16
 (`byte * 257`), for per-channel sorting (engine.md section 5.5).
 */
export function packChannelKeys(
	bytes: Uint8Array,
	start: number,
	length: number,
	channel: number,
	divisor: number,
	descending: boolean,
	packed: Uint32Array,
): void {
	let p = start * 4 + channel;
	if (divisor === 0 && !descending) {
		for (let i = 0; i < length; i++, p += 4) {
			packed[i] = ((bytes[p] * 257) << 16) | i;
		}

		return;
	}

	for (let i = 0; i < length; i++, p += 4) {
		let c = bytes[p] * 257;
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

// Fisher–Yates of engine.md section 5.5 over local indices `0..length-1` for one channel.
export function shuffleChannelIndices(
	indices: Uint32Array,
	length: number,
	seed: number,
	lineId: number,
	sourcePosition: number,
	channel: number,
): void {
	for (let i = 0; i < length; i++) {
		indices[i] = i;
	}

	for (let j = length - 1; j >= 1; j--) {
		const t = Math.floor(
			unit5(seed, P_CHANNEL_SHUFFLE, lineId, sourcePosition, channel, j) *
				(j + 1),
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
	transform: IntervalTransform = 'none',
): void {
	if (transform === 'none') {
		for (let i = 0; i < length; i++) {
			out[start + i] = pixels[start + (ordered[i] & 0xff_ff)];
		}

		return;
	}

	for (let i = 0; i < length; i++) {
		const k = transformIndex(transform, i, length);
		out[start + i] = pixels[start + (ordered[k] & 0xff_ff)];
	}
}

export function fillChannelSort(
	bytes: Uint8Array,
	outBytes: Uint8Array,
	start: number,
	length: number,
	channel: number,
	ordered: Uint32Array,
	transform: IntervalTransform = 'none',
): void {
	const base = start * 4 + channel;
	if (transform === 'none') {
		for (let i = 0; i < length; i++) {
			outBytes[base + i * 4] = bytes[base + (ordered[i] & 0xff_ff) * 4];
		}

		return;
	}

	for (let i = 0; i < length; i++) {
		const k = transformIndex(transform, i, length);
		outBytes[base + i * 4] = bytes[base + (ordered[k] & 0xff_ff) * 4];
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

export function fillChannelAverage(
	bytes: Uint8Array,
	outBytes: Uint8Array,
	start: number,
	length: number,
	channel: number,
): void {
	const begin = start * 4 + channel;
	const end = begin + length * 4;
	let sum = 0;
	for (let p = begin; p < end; p += 4) {
		sum += bytes[p];
	}

	const mean = Math.floor((2 * sum + length) / (2 * length));
	for (let p = begin; p < end; p += 4) {
		outBytes[p] = mean;
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
	transform: IntervalTransform = 'none',
): void {
	const s = (start + first) * 4;
	const e = (start + last) * 4;
	const span = length - 1;
	const den = 2 * span;
	if (transform === 'none') {
		for (let channel = 0; channel < 4; channel++) {
			const from = bytes[s + channel];
			const to = bytes[e + channel];
			let p = start * 4 + channel;
			for (let j = 0; j < length; j++, p += 4) {
				outBytes[p] = Math.floor(
					(2 * (from * (span - j) + to * j) + span) / den,
				);
			}
		}

		return;
	}

	for (let channel = 0; channel < 4; channel++) {
		const from = bytes[s + channel];
		const to = bytes[e + channel];
		let p = start * 4 + channel;
		for (let j = 0; j < length; j++, p += 4) {
			const k = transformIndex(transform, j, length);
			outBytes[p] = Math.floor((2 * (from * (span - k) + to * k) + span) / den);
		}
	}
}

export function fillChannelGradient(
	bytes: Uint8Array,
	outBytes: Uint8Array,
	start: number,
	length: number,
	channel: number,
	first: number,
	last: number,
	transform: IntervalTransform = 'none',
): void {
	const from = bytes[(start + first) * 4 + channel];
	const to = bytes[(start + last) * 4 + channel];
	const span = length - 1;
	const den = 2 * span;
	let p = start * 4 + channel;
	if (transform === 'none') {
		for (let j = 0; j < length; j++, p += 4) {
			outBytes[p] = Math.floor((2 * (from * (span - j) + to * j) + span) / den);
		}

		return;
	}

	for (let j = 0; j < length; j++, p += 4) {
		const k = transformIndex(transform, j, length);
		outBytes[p] = Math.floor((2 * (from * (span - k) + to * k) + span) / den);
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
