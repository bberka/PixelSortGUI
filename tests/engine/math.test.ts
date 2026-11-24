import {describe, expect, it} from 'vite-plus/test';
import {clamp, floorDiv, roundHalfAway, wrap} from '../../src/engine/math.ts';

describe('engine.md section 1 helpers', () => {
	it('floorDiv rounds toward negative infinity', () => {
		expect(floorDiv(7, 2)).toBe(3);
		expect(floorDiv(-7, 2)).toBe(-4);
		expect(floorDiv(6, 3)).toBe(2);
	});

	it('roundHalfAway rounds halves away from zero', () => {
		expect(roundHalfAway(0.5)).toBe(1);
		expect(roundHalfAway(-0.5)).toBe(-1);
		expect(roundHalfAway(2.4)).toBe(2);
		expect(roundHalfAway(-2.6)).toBe(-3);
		expect(roundHalfAway(1.5)).toBe(2);
		expect(roundHalfAway(-1.5)).toBe(-2);
	});

	it('clamp limits to both ends', () => {
		expect(clamp(5, 0, 3)).toBe(3);
		expect(clamp(-1, 0, 3)).toBe(0);
		expect(clamp(2, 0, 3)).toBe(2);
	});

	it('wrap maps negatives into [0, n)', () => {
		expect(wrap(-1, 360)).toBe(359);
		expect(wrap(360, 360)).toBe(0);
		expect(wrap(725, 360)).toBe(5);
	});
});
