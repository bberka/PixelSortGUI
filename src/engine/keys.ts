import {floorDiv} from './math.ts';

export type SortKey =
	| 'luma'
	| 'lightness'
	| 'value'
	| 'saturation'
	| 'hue'
	| 'red'
	| 'green'
	| 'blue';

export type KeyFn = (r: number, g: number, b: number) => number;

export const SORT_KEYS: readonly SortKey[] = [
	'luma',
	'lightness',
	'value',
	'saturation',
	'hue',
	'red',
	'green',
	'blue',
];

export function lumaKey16(r: number, g: number, b: number): number {
	const y = 2126 * r + 7152 * g + 722 * b;
	return Math.floor((257 * y + 5000) / 10_000);
}

export function lightnessKey16(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	return floorDiv((max + min) * 131_070 + 510, 1020);
}

export function valueKey16(r: number, g: number, b: number): number {
	return Math.max(r, g, b) * 257;
}

export function saturationKey16(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	if (delta === 0) {
		return 0;
	}

	const sum = max + min;
	const den = sum <= 255 ? sum : 510 - sum;
	return floorDiv(delta * 131_070 + den, 2 * den);
}

export function hueKey16(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	if (delta === 0) {
		return 0;
	}

	let h: number;
	if (max === r) {
		h = g - b;
		if (h < 0) {
			h += 6 * delta;
		}
	} else if (max === g) {
		h = b - r + 2 * delta;
	} else {
		h = r - g + 4 * delta;
	}

	const key16 = floorDiv(h * 131_072 + 6 * delta, 12 * delta);
	return key16 === 65_536 ? 0 : key16;
}

export function redKey16(r: number, _g: number, _b: number): number {
	return r * 257;
}

export function greenKey16(_r: number, g: number, _b: number): number {
	return g * 257;
}

export function blueKey16(_r: number, _g: number, b: number): number {
	return b * 257;
}

export const KEY_FNS: Readonly<Record<SortKey, KeyFn>> = {
	luma: lumaKey16,
	lightness: lightnessKey16,
	value: valueKey16,
	saturation: saturationKey16,
	hue: hueKey16,
	red: redKey16,
	green: greenKey16,
	blue: blueKey16,
};

export function getKeyFn(key: SortKey): KeyFn {
	return KEY_FNS[key];
}

export function computeKey16(
	key: SortKey,
	r: number,
	g: number,
	b: number,
): number {
	return KEY_FNS[key](r, g, b);
}
