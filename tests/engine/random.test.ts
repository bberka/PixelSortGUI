/* eslint-disable no-bitwise -- the reference hash is 32-bit integer arithmetic */
import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {hash32, intIn, mix32, unit} from '../../src/engine/random.ts';

const MASK = 0xff_ff_ff_ffn;

// Engine.md section 10.1, written again in BigInt so it shares no code or
// number semantics with the implementation.
function referenceMix32(value: bigint): bigint {
	let x = value & MASK;
	x ^= x >> 16n;
	x = (x * 0x7f_eb_35_2dn) & MASK;
	x ^= x >> 15n;
	x = (x * 0x84_6c_a6_8bn) & MASK;
	x ^= x >> 16n;
	return x;
}

function referenceHash32(seed: number, ...keys: number[]): number {
	let h = referenceMix32(BigInt.asUintN(32, BigInt(Math.trunc(seed))));
	for (const key of keys) {
		h = referenceMix32(h ^ BigInt.asUintN(32, BigInt(Math.trunc(key))));
	}

	return Number(h);
}

describe('mix32', () => {
	it.each([
		[0, 0],
		[1, 1_753_845_952],
		[0xff_ff_ff_ff, 1_734_902_346],
		[0x12_34_56_78, 4_125_564_054],
	])('mix32(%d) is %d', (input, expected) => {
		expect(mix32(input)).toBe(expected);
	});

	it('matches the BigInt reference on random uint32 inputs', () => {
		fc.assert(
			fc.property(fc.integer({min: 0, max: 0xff_ff_ff_ff}), (x) => {
				expect(mix32(x)).toBe(Number(referenceMix32(BigInt(x))));
			}),
			{numRuns: 2000},
		);
	});
});

describe('hash32', () => {
	// Expected values were computed outside this repository from the formulas
	// in engine.md section 10.1.
	it.each<[number[], number]>([
		[[0], 0],
		[[1, 2, 3], 1_066_372_762],
		[[1], 1_753_845_952],
		[[0, 0], 0],
		[[0, 1], 1_753_845_952],
		[[1, 0], 1_492_470_133],
		[[0xff_ff_ff_ff], 1_734_902_346],
		[[42, 7, 1000, 65_535], 2_967_425_672],
		[[123_456_789, 0xff_ff_ff_ff], 3_719_292_234],
		[[7, -1], 699_684_894],
		[[2 ** 32 + 5, 9], 4_234_561_161],
		[[3, 1, 2], 488_249_326],
		[[3, 2, 1], 2_902_294_105],
	])('hash32(%j) is %d', (args, expected) => {
		const [seed, ...keys] = args;
		expect(hash32(seed, ...keys)).toBe(expected);
		expect(referenceHash32(seed, ...keys)).toBe(expected);
	});

	it('matches the BigInt reference for random seeds and keys', () => {
		fc.assert(
			fc.property(
				fc.integer({min: -(2 ** 31), max: 2 ** 32 - 1}),
				fc.array(fc.integer({min: -(2 ** 31), max: 2 ** 32 - 1}), {
					maxLength: 5,
				}),
				(seed, keys) => {
					expect(hash32(seed, ...keys)).toBe(referenceHash32(seed, ...keys));
				},
			),
			{numRuns: 2000},
		);
	});
});

describe('unit', () => {
	it('is hash32 divided by 2^32', () => {
		expect(unit(9, 4)).toBe(0.4314821292646229);
		expect(unit(0)).toBe(0);
		expect(unit(0xff_ff_ff_ff)).toBe(1_734_902_346 / 4_294_967_296);
	});

	it('stays in [0, 1)', () => {
		for (let i = 0; i < 100_000; i++) {
			const u = unit(17, 2, i);
			expect(u >= 0 && u < 1).toBe(true);
		}
	});
});

describe('intIn', () => {
	it('matches hand-computed draws', () => {
		expect(intIn(-5, 5, 9, 4)).toBe(-1);
		expect(intIn(0, 255, 1, 2, 3)).toBe(63);
		expect(intIn(10, 10, 5, 5)).toBe(10);
	});

	it('stays within bounds and reaches both ends over 100,000 draws', () => {
		const seen = new Set<number>();
		for (let i = 0; i < 100_000; i++) {
			const value = intIn(-3, 4, 99, 5, i);
			if (!Number.isSafeInteger(value) || value < -3 || value > 4) {
				throw new Error(`draw ${i} gave ${value}`);
			}

			seen.add(value);
		}

		expect([...seen].toSorted((a, b) => a - b)).toEqual([
			-3, -2, -1, 0, 1, 2, 3, 4,
		]);
	});
});
