import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {composite, compositeRows} from '../../src/engine/composite.ts';
import type {BlendMode} from '../../src/engine/types.ts';
import {bytes, image, noiseImage} from './sample-effects.ts';

// Instance input and effect output for one pixel.
const INPUT = [200, 50, 10, 255];
const EFFECT = [100, 150, 10, 128];

function blendOne(mix: number, blend: BlendMode): number[] {
	const output = image(1, 1, EFFECT);
	composite(image(1, 1, INPUT), output, mix, blend);
	return bytes(output);
}

describe('composite', () => {
	// Each expected value is floorDiv(2 * (i * (100 - m) + b * m) + 100, 200)
	// from engine.md section 4.5, worked by hand.
	it.each<[BlendMode, number, number[]]>([
		['normal', 1, [100, 150, 10, 128]],
		['normal', 0.5, [150, 100, 10, 192]],
		['normal', 0.25, [175, 75, 10, 223]],
		['normal', 0.33, [167, 83, 10, 213]],
		['lighten', 1, [200, 150, 10, 128]],
		['lighten', 0.5, [200, 100, 10, 192]],
		['darken', 1, [100, 50, 10, 128]],
		['darken', 0.5, [150, 50, 10, 192]],
		['difference', 1, [100, 100, 0, 128]],
		['difference', 0.5, [150, 75, 5, 192]],
	])('%s at mix %d', (blend, mix, expected) => {
		expect(blendOne(mix, blend)).toEqual(expected);
	});

	it('rounds an exact half up', () => {
		const output = image(1, 1, [1, 0, 255, 0]);
		composite(image(1, 1, [0, 1, 254, 1]), output, 0.5, 'normal');
		expect(bytes(output)).toEqual([1, 1, 255, 1]);
	});

	it.each<BlendMode>(['normal', 'lighten', 'darken', 'difference'])(
		'mix 0 gives the input exactly with %s',
		(blend) => {
			expect(blendOne(0, blend)).toEqual(INPUT);
		},
	);

	it('mix 1 with normal leaves the effect output untouched', () => {
		expect(blendOne(1, 'normal')).toEqual(EFFECT);
	});

	it('always mixes alpha as normal', () => {
		for (const blend of ['lighten', 'darken', 'difference'] as const) {
			expect(blendOne(1, blend)[3]).toBe(128);
			expect(blendOne(0.5, blend)[3]).toBe(192);
		}
	});

	it('uses mix rounded to whole percent', () => {
		expect(blendOne(0.254, 'normal')).toEqual(blendOne(0.25, 'normal'));
		expect(blendOne(0.999, 'normal')).toEqual(EFFECT);
	});

	it('clamps an out-of-range mix and treats NaN as 1', () => {
		expect(blendOne(-3, 'normal')).toEqual(INPUT);
		expect(blendOne(7, 'difference')).toEqual(blendOne(1, 'difference'));
		expect(blendOne(NaN, 'normal')).toEqual(EFFECT);
	});

	it('treats an unknown blend mode as normal', () => {
		expect(blendOne(0.5, 'screen' as BlendMode)).toEqual(
			blendOne(0.5, 'normal'),
		);
	});

	it('does not write the input and returns the output image', () => {
		const input = noiseImage(5, 4, 1);
		const before = bytes(input);
		const output = noiseImage(5, 4, 2);
		expect(composite(input, output, 0.4, 'difference')).toBe(output);
		expect(bytes(input)).toEqual(before);
	});

	it('compositeRows touches only the rows it is given', () => {
		const input = noiseImage(3, 4, 1);
		const effect = noiseImage(3, 4, 2);
		const whole = composite(input, noiseImage(3, 4, 2), 0.3, 'lighten');
		const partial = noiseImage(3, 4, 2);
		compositeRows(input, partial, 0.3, 'lighten', 1, 3);
		expect(bytes(partial).slice(0, 12)).toEqual(bytes(effect).slice(0, 12));
		expect(bytes(partial).slice(12, 36)).toEqual(bytes(whole).slice(12, 36));
		expect(bytes(partial).slice(36)).toEqual(bytes(effect).slice(36));
	});

	it('matches a BigInt evaluation of the formula for random pixels', () => {
		const blended = {
			normal: (_i: number, f: number) => f,
			lighten: Math.max,
			darken: Math.min,
			difference: (i: number, f: number) => Math.abs(i - f),
		};
		fc.assert(
			fc.property(
				fc.array(fc.integer({min: 0, max: 255}), {minLength: 4, maxLength: 4}),
				fc.array(fc.integer({min: 0, max: 255}), {minLength: 4, maxLength: 4}),
				fc.integer({min: 0, max: 100}),
				fc.constantFrom<BlendMode>('normal', 'lighten', 'darken', 'difference'),
				(i, f, m, blend) => {
					const output = image(1, 1, f);
					composite(image(1, 1, i), output, m / 100, blend);
					const expected = i.map((value, c) => {
						const b = c === 3 ? f[c] : blended[blend](value, f[c]);
						return Number(
							(2n * BigInt(value * (100 - m) + b * m) + 100n) / 200n,
						);
					});
					expect(bytes(output)).toEqual(expected);
				},
			),
			{numRuns: 1000},
		);
	});
});
