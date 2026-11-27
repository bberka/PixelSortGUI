/* eslint-disable no-bitwise -- the hash is defined in 32-bit integer operations (engine.md section 10.1) */
import {
	hueKey16,
	lightnessKey16,
	lumaKey16,
	saturationKey16,
	valueKey16,
	type SortKey,
} from '../../keys.ts';
import {mix32} from '../../random.ts';

// Part of the output definition (engine.md section 5.8).
export const P_CAP = 1;
export const P_SKIP = 2;
export const P_ORDER = 3;
export const P_SHUFFLE = 4;
export const P_CHANNEL_ORDER = 5;
export const P_CHANNEL_SHUFFLE = 6;

// `unit(seed, a, b, c)` of random.ts without the rest-argument array.
export function unit3(seed: number, a: number, b: number, c: number): number {
	let h = mix32(seed >>> 0);
	h = mix32((h ^ a) >>> 0);
	h = mix32((h ^ b) >>> 0);
	h = mix32((h ^ c) >>> 0);
	return h / 4_294_967_296;
}

// `unit(seed, a, b, c, d)` of random.ts without the rest-argument array.
export function unit4(
	seed: number,
	a: number,
	b: number,
	c: number,
	d: number,
): number {
	let h = mix32(seed >>> 0);
	h = mix32((h ^ a) >>> 0);
	h = mix32((h ^ b) >>> 0);
	h = mix32((h ^ c) >>> 0);
	h = mix32((h ^ d) >>> 0);
	return h / 4_294_967_296;
}

// `unit(seed, a, b, c, d, e)` of random.ts without the rest-argument array.
export function unit5(
	seed: number,
	a: number,
	b: number,
	c: number,
	d: number,
	e: number,
): number {
	let h = mix32(seed >>> 0);
	h = mix32((h ^ a) >>> 0);
	h = mix32((h ^ b) >>> 0);
	h = mix32((h ^ c) >>> 0);
	h = mix32((h ^ d) >>> 0);
	h = mix32((h ^ e) >>> 0);
	return h / 4_294_967_296;
}

/**
 Writes `key16` of line pixels `start..end-1` into `out` at the same indices.
 `bytes` holds the line as RGBA. One loop per key keeps every key call site
 monomorphic, so the engine inlines it; a shared loop over a key function
 would turn megamorphic as soon as a second key is used.
 */
export function fillKeys(
	key: SortKey,
	bytes: Uint8Array,
	start: number,
	end: number,
	out: Uint16Array,
): void {
	let p = start * 4;
	switch (key) {
		case 'luma': {
			for (let i = start; i < end; i++, p += 4) {
				out[i] = lumaKey16(bytes[p], bytes[p + 1], bytes[p + 2]);
			}

			break;
		}

		case 'lightness': {
			for (let i = start; i < end; i++, p += 4) {
				out[i] = lightnessKey16(bytes[p], bytes[p + 1], bytes[p + 2]);
			}

			break;
		}

		case 'value': {
			for (let i = start; i < end; i++, p += 4) {
				out[i] = valueKey16(bytes[p], bytes[p + 1], bytes[p + 2]);
			}

			break;
		}

		case 'saturation': {
			for (let i = start; i < end; i++, p += 4) {
				out[i] = saturationKey16(bytes[p], bytes[p + 1], bytes[p + 2]);
			}

			break;
		}

		case 'hue': {
			for (let i = start; i < end; i++, p += 4) {
				out[i] = hueKey16(bytes[p], bytes[p + 1], bytes[p + 2]);
			}

			break;
		}

		case 'red': {
			for (let i = start; i < end; i++, p += 4) {
				out[i] = bytes[p] * 257;
			}

			break;
		}

		case 'green': {
			for (let i = start; i < end; i++, p += 4) {
				out[i] = bytes[p + 1] * 257;
			}

			break;
		}

		case 'blue': {
			for (let i = start; i < end; i++, p += 4) {
				out[i] = bytes[p + 2] * 257;
			}

			break;
		}
	}
}

export function thresholdBound(value: number): number {
	return Math.floor(value * 65_535 + 0.5);
}

export function selectThreshold(
	bytes: Uint8Array,
	keys: Uint16Array,
	length: number,
	lo16: number,
	hi16: number,
	invert: boolean,
	selected: Uint8Array,
): void {
	if (invert) {
		for (let i = 0; i < length; i++) {
			const key = keys[i];
			selected[i] =
				bytes[4 * i + 3] !== 0 && (key < lo16 || key > hi16) ? 1 : 0;
		}
	} else {
		for (let i = 0; i < length; i++) {
			const key = keys[i];
			selected[i] =
				bytes[4 * i + 3] !== 0 && key >= lo16 && key <= hi16 ? 1 : 0;
		}
	}
}

export function selectWhole(
	bytes: Uint8Array,
	length: number,
	selected: Uint8Array,
): void {
	for (let i = 0; i < length; i++) {
		selected[i] = bytes[4 * i + 3] === 0 ? 0 : 1;
	}
}

export function selectFromMap(
	map: Uint8Array,
	offsets: Int32Array,
	length: number,
	selected: Uint8Array,
): void {
	for (let i = 0; i < length; i++) {
		selected[i] = map[offsets[i]];
	}
}

// Length cap of the interval whose first pixel drew `u` (engine.md section 5.4).
export function intervalCap(
	scaledMaxLength: number,
	lengthJitter: number,
	u: number,
): number {
	return Math.max(
		1,
		Math.floor(scaledMaxLength * (1 + lengthJitter * (2 * u - 1))),
	);
}

// Engine.md section 5.7: unselected pixels keep alpha and get R, G, B at a quarter.
export function writeSelectionView(
	bytes: Uint8Array,
	selected: Uint8Array,
	length: number,
	outBytes: Uint8Array,
): void {
	for (let i = 0, p = 0; i < length; i++, p += 4) {
		if (selected[i] === 0) {
			outBytes[p] = bytes[p] >> 2;
			outBytes[p + 1] = bytes[p + 1] >> 2;
			outBytes[p + 2] = bytes[p + 2] >> 2;
		} else {
			outBytes[p] = bytes[p];
			outBytes[p + 1] = bytes[p + 1];
			outBytes[p + 2] = bytes[p + 2];
		}

		outBytes[p + 3] = bytes[p + 3];
	}
}
