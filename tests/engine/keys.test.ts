import {describe, expect, it} from 'vite-plus/test';
import {
	SORT_KEYS,
	blueKey16,
	computeKey16,
	getKeyFn,
	greenKey16,
	hueKey16,
	lightnessKey16,
	lumaKey16,
	redKey16,
	saturationKey16,
	valueKey16,
	type SortKey,
} from '../../src/engine/keys.ts';

function bigFloorDiv(a: bigint, b: bigint): bigint {
	const q = a / b;
	const r = a % b;
	return r !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

// Independent BigInt reference implementations directly from engine.md section 5.3.
function refKey16(key: SortKey, r: number, g: number, b: number): number {
	const R = BigInt(r);
	const G = BigInt(g);
	const B = BigInt(b);
	const M = BigInt(Math.max(r, g, b));
	const m = BigInt(Math.min(r, g, b));
	const d = M - m;

	switch (key) {
		case 'luma': {
			const y = 2126n * R + 7152n * G + 722n * B;
			return Number(bigFloorDiv(y * 131_070n + 2_550_000n, 5_100_000n));
		}

		case 'lightness': {
			return Number(bigFloorDiv((M + m) * 131_070n + 510n, 1020n));
		}

		case 'value': {
			return Number(M * 257n);
		}

		case 'saturation': {
			if (d === 0n) {
				return 0;
			}

			const den = M + m <= 255n ? M + m : 510n - M - m;
			return Number(bigFloorDiv(d * 131_070n + den, 2n * den));
		}

		case 'hue': {
			if (d === 0n) {
				return 0;
			}

			let h: bigint;
			if (M === R) {
				h = G - B;
				if (h < 0n) {
					h += 6n * d;
				}
			} else if (M === G) {
				h = B - R + 2n * d;
			} else {
				h = R - G + 4n * d;
			}

			const key16 = bigFloorDiv(h * 131_072n + 6n * d, 12n * d);
			return key16 === 65_536n ? 0 : Number(key16);
		}

		case 'red': {
			return Number(R * 257n);
		}

		case 'green': {
			return Number(G * 257n);
		}

		case 'blue': {
			return Number(B * 257n);
		}
	}
}

type ColourCase = {
	name: string;
	rgb: readonly [number, number, number];
	expected: Record<SortKey, number>;
};

// 18 hand-computed colours covering black, white, primaries, secondaries/ties,
// greys, channel boundaries, saturation branch boundary (M+m = 255 vs 256), and hue wrap.
const HAND_COMPUTED_CASES: readonly ColourCase[] = [
	{
		name: 'black (0, 0, 0)',
		rgb: [0, 0, 0],
		expected: {
			luma: 0,
			lightness: 0,
			value: 0,
			saturation: 0,
			hue: 0,
			red: 0,
			green: 0,
			blue: 0,
		},
	},
	{
		name: 'white (255, 255, 255)',
		rgb: [255, 255, 255],
		expected: {
			luma: 65_535,
			lightness: 65_535,
			value: 65_535,
			saturation: 0,
			hue: 0,
			red: 65_535,
			green: 65_535,
			blue: 65_535,
		},
	},
	{
		name: 'pure red (255, 0, 0)',
		rgb: [255, 0, 0],
		expected: {
			// Y = 2126*255 = 542130; floor((542130*131070 + 2550000) / 5100000) = 13933
			luma: 13_933,
			// Floor((255*131070 + 510) / 1020) = 32768
			lightness: 32_768,
			value: 65_535,
			saturation: 65_535,
			hue: 0,
			red: 65_535,
			green: 0,
			blue: 0,
		},
	},
	{
		name: 'pure green (0, 255, 0)',
		rgb: [0, 255, 0],
		expected: {
			// Y = 7152*255 = 1823760; floor((1823760*131070 + 2550000) / 5100000) = 46871
			luma: 46_871,
			lightness: 32_768,
			value: 65_535,
			saturation: 65_535,
			// H = 2*255 = 510; floor((510*131072 + 1530) / 3060) = 21845
			hue: 21_845,
			red: 0,
			green: 65_535,
			blue: 0,
		},
	},
	{
		name: 'pure blue (0, 0, 255)',
		rgb: [0, 0, 255],
		expected: {
			// Y = 722*255 = 184110; floor((184110*131070 + 2550000) / 5100000) = 4732
			luma: 4732,
			lightness: 32_768,
			value: 65_535,
			saturation: 65_535,
			// H = 4*255 = 1020; floor((1020*131072 + 1530) / 3060) = 43691
			hue: 43_691,
			red: 0,
			green: 0,
			blue: 65_535,
		},
	},
	{
		name: 'yellow R=G tie (255, 255, 0)',
		rgb: [255, 255, 0],
		expected: {
			// Y = 9278*255; floor((9278*65535 + 5000) / 10000) = 60803
			luma: 60_803,
			lightness: 32_768,
			value: 65_535,
			saturation: 65_535,
			// M=R tie: h = G - B = 255; floor((255*131072 + 1530) / 3060) = 10923
			hue: 10_923,
			red: 65_535,
			green: 65_535,
			blue: 0,
		},
	},
	{
		name: 'cyan G=B tie (0, 255, 255)',
		rgb: [0, 255, 255],
		expected: {
			luma: 51_602,
			lightness: 32_768,
			value: 65_535,
			saturation: 65_535,
			// M=G tie: h = 255 - 0 + 510 = 765; 765/1530 * 65536 = 32768
			hue: 32_768,
			red: 0,
			green: 65_535,
			blue: 65_535,
		},
	},
	{
		name: 'magenta R=B tie (255, 0, 255)',
		rgb: [255, 0, 255],
		expected: {
			luma: 18_664,
			lightness: 32_768,
			value: 65_535,
			saturation: 65_535,
			// M=R tie: h = 0 - 255 + 6*255 = 1275; floor((1275*131072 + 1530) / 3060) = 54613
			hue: 54_613,
			red: 65_535,
			green: 0,
			blue: 65_535,
		},
	},
	{
		name: 'mid grey (128, 128, 128)',
		rgb: [128, 128, 128],
		expected: {
			luma: 32_896,
			lightness: 32_896,
			value: 32_896,
			saturation: 0,
			hue: 0,
			red: 32_896,
			green: 32_896,
			blue: 32_896,
		},
	},
	{
		name: 'dark grey boundary (1, 1, 1)',
		rgb: [1, 1, 1],
		expected: {
			luma: 257,
			lightness: 257,
			value: 257,
			saturation: 0,
			hue: 0,
			red: 257,
			green: 257,
			blue: 257,
		},
	},
	{
		name: 'near-white grey boundary (254, 254, 254)',
		rgb: [254, 254, 254],
		expected: {
			luma: 65_278,
			lightness: 65_278,
			value: 65_278,
			saturation: 0,
			hue: 0,
			red: 65_278,
			green: 65_278,
			blue: 65_278,
		},
	},
	{
		name: 'hue wrap point just below 360 deg (255, 0, 1)',
		rgb: [255, 0, 1],
		expected: {
			// Y = 2126*255 + 722 = 542852
			luma: 13_951,
			lightness: 32_768,
			value: 65_535,
			saturation: 65_535,
			// H = -1 + 6*255 = 1529; floor((1529*131072 + 1530) / 3060) = 65493
			hue: 65_493,
			red: 65_535,
			green: 0,
			blue: 257,
		},
	},
	{
		name: 'saturation branch M+m = 255 (200, 55, 55)',
		rgb: [200, 55, 55],
		expected: {
			// Y = 2126*200 + 7152*55 + 722*55 = 858270
			luma: 22_058,
			lightness: 32_768,
			value: 51_400,
			// D = 145, den = 255; floor((145*131070 + 255) / 510) = 37265
			saturation: 37_265,
			hue: 0,
			red: 51_400,
			green: 14_135,
			blue: 14_135,
		},
	},
	{
		name: 'saturation branch M+m = 256 (201, 55, 55)',
		rgb: [201, 55, 55],
		expected: {
			luma: 22_112,
			lightness: 32_896,
			value: 51_657,
			// D = 146, den = 510 - 256 = 254; floor((146*131070 + 254) / 508) = 37670
			saturation: 37_670,
			hue: 0,
			red: 51_657,
			green: 14_135,
			blue: 14_135,
		},
	},
	{
		name: 'blue-dominant mixed (12, 34, 56)',
		rgb: [12, 34, 56],
		expected: {
			luma: 7944,
			lightness: 8738,
			value: 14_392,
			saturation: 42_405,
			hue: 38_229,
			red: 3084,
			green: 8738,
			blue: 14_392,
		},
	},
	{
		name: 'green-dominant mixed (180, 220, 40)',
		rgb: [180, 220, 40],
		expected: {
			luma: 51_015,
			lightness: 33_410,
			value: 56_540,
			saturation: 47_185,
			hue: 13_350,
			red: 46_260,
			green: 56_540,
			blue: 10_280,
		},
	},
	{
		name: 'red-dominant with G < B wrap (240, 100, 150)',
		rgb: [240, 100, 150],
		expected: {
			luma: 34_277,
			lightness: 43_690,
			value: 61_680,
			saturation: 53_970,
			hue: 61_635,
			red: 61_680,
			green: 25_700,
			blue: 38_550,
		},
	},
	{
		name: 'near-black chromatic (1, 0, 0)',
		rgb: [1, 0, 0],
		expected: {
			luma: 55,
			lightness: 129,
			value: 257,
			saturation: 65_535,
			hue: 0,
			red: 257,
			green: 0,
			blue: 0,
		},
	},
];

describe('sort and selection keys (engine.md section 5.3)', () => {
	it('exports all 8 keys in spec order', () => {
		expect(SORT_KEYS).toEqual([
			'luma',
			'lightness',
			'value',
			'saturation',
			'hue',
			'red',
			'green',
			'blue',
		]);
	});

	it('matches hand-computed values and BigInt spec reference for 18 colours', () => {
		for (const testCase of HAND_COMPUTED_CASES) {
			const [r, g, b] = testCase.rgb;
			for (const key of SORT_KEYS) {
				const ref = refKey16(key, r, g, b);
				expect(testCase.expected[key], `${testCase.name} ${key} vs ref`).toBe(
					ref,
				);
				const actual = computeKey16(key, r, g, b);
				expect(actual, `${testCase.name} ${key}`).toBe(testCase.expected[key]);
				expect(getKeyFn(key)(r, g, b)).toBe(actual);
				expect(Number.isSafeInteger(actual)).toBe(true);
				expect(actual).toBeGreaterThanOrEqual(0);
				expect(actual).toBeLessThanOrEqual(65_535);
			}
		}
	});

	it('direct named key functions match computeKey16', () => {
		const sample: readonly [number, number, number] = [193, 77, 211];
		const [r, g, b] = sample;
		expect(lumaKey16(r, g, b)).toBe(computeKey16('luma', r, g, b));
		expect(lightnessKey16(r, g, b)).toBe(computeKey16('lightness', r, g, b));
		expect(valueKey16(r, g, b)).toBe(computeKey16('value', r, g, b));
		expect(saturationKey16(r, g, b)).toBe(computeKey16('saturation', r, g, b));
		expect(hueKey16(r, g, b)).toBe(computeKey16('hue', r, g, b));
		expect(redKey16(r, g, b)).toBe(computeKey16('red', r, g, b));
		expect(greenKey16(r, g, b)).toBe(computeKey16('green', r, g, b));
		expect(blueKey16(r, g, b)).toBe(computeKey16('blue', r, g, b));
	});

	it('maps all 256 greys to hue 0, saturation 0, and exact v * 257 for brightness keys', () => {
		for (let v = 0; v <= 255; v++) {
			expect(hueKey16(v, v, v)).toBe(0);
			expect(saturationKey16(v, v, v)).toBe(0);
			expect(lumaKey16(v, v, v)).toBe(v * 257);
			expect(lightnessKey16(v, v, v)).toBe(v * 257);
			expect(valueKey16(v, v, v)).toBe(v * 257);
			expect(redKey16(v, v, v)).toBe(v * 257);
			expect(greenKey16(v, v, v)).toBe(v * 257);
			expect(blueKey16(v, v, v)).toBe(v * 257);
		}
	});

	it('is monotonic in each relevant channel', () => {
		for (let v = 0; v < 255; v++) {
			expect(redKey16(v + 1, 100, 50)).toBeGreaterThan(redKey16(v, 100, 50));
			expect(greenKey16(100, v + 1, 50)).toBeGreaterThan(
				greenKey16(100, v, 50),
			);
			expect(blueKey16(100, 50, v + 1)).toBeGreaterThan(blueKey16(100, 50, v));

			expect(lumaKey16(v + 1, 80, 40)).toBeGreaterThanOrEqual(
				lumaKey16(v, 80, 40),
			);
			expect(lumaKey16(80, v + 1, 40)).toBeGreaterThanOrEqual(
				lumaKey16(80, v, 40),
			);
			expect(lumaKey16(80, 40, v + 1)).toBeGreaterThanOrEqual(
				lumaKey16(80, 40, v),
			);

			expect(lightnessKey16(v + 1, v + 1, v + 1)).toBeGreaterThan(
				lightnessKey16(v, v, v),
			);
			expect(valueKey16(v + 1, 40, 20)).toBeGreaterThanOrEqual(
				valueKey16(v, 40, 20),
			);
		}

		// Saturation increases monotonically as chroma widens symmetrically around 128.
		for (let delta = 0; delta < 127; delta++) {
			expect(
				saturationKey16(128 + delta + 1, 128, 128 - delta - 1),
			).toBeGreaterThan(saturationKey16(128 + delta, 128, 128 - delta));
		}

		// Hue increases monotonically around the full-saturation RGB perimeter.
		const perimeter: Array<readonly [number, number, number]> = [];
		for (let g = 0; g < 255; g++) {
			perimeter.push([255, g, 0]);
		}

		for (let r = 255; r > 0; r--) {
			perimeter.push([r, 255, 0]);
		}

		for (let b = 0; b < 255; b++) {
			perimeter.push([0, 255, b]);
		}

		for (let g = 255; g > 0; g--) {
			perimeter.push([0, g, 255]);
		}

		for (let r = 0; r < 255; r++) {
			perimeter.push([r, 0, 255]);
		}

		for (let b = 255; b > 0; b--) {
			perimeter.push([255, 0, b]);
		}

		let prev = -1;
		for (const [r, g, b] of perimeter) {
			const h = hueKey16(r, g, b);
			expect(h).toBeGreaterThan(prev);
			expect(h).toBe(refKey16('hue', r, g, b));
			prev = h;
		}
	});

	it('reduced luma formula matches the spec formula for every Y from 0 to 2,550,000', () => {
		for (let y = 0; y <= 2_550_000; y++) {
			const original = Math.floor((y * 131_070 + 2_550_000) / 5_100_000);
			const reduced = Math.floor((257 * y + 5000) / 10_000);
			if (reduced !== original) {
				expect.fail(
					`Mismatch at Y=${y}: reduced=${reduced}, original=${original}`,
				);
			}
		}
	});
});
