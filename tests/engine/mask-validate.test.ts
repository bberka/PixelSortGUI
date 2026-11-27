import {describe, expect, it} from 'vite-plus/test';
import {validateMask} from '../../src/engine/mask/validate.ts';
import {
	canonicalStackJson,
	stackSchemaVersion,
	type EffectStack,
} from '../../src/engine/types.ts';
import {instance} from './sample-effects.ts';

const HASH = 'ab'.repeat(32);

describe('validateMask (engine.md section 16.6)', () => {
	it('fills the defaults of every kind', () => {
		expect(validateMask({kind: 'paint'})).toEqual({
			kind: 'paint',
			invert: false,
			feather: 0,
			asset: '',
		});
		expect(validateMask({kind: 'luma'})).toEqual({
			kind: 'luma',
			invert: false,
			feather: 0,
			range: [0.5, 1],
			softness: 0.1,
		});
		expect(validateMask({kind: 'image'})).toEqual({
			kind: 'image',
			invert: false,
			feather: 0,
			source: '',
			fit: 'cover',
		});
	});

	it('keeps valid values', () => {
		const masks = [
			{kind: 'paint', invert: true, feather: 256, asset: HASH},
			{kind: 'luma', invert: true, feather: 1, range: [0, 0.25], softness: 1},
			{kind: 'image', invert: false, feather: 12, source: HASH, fit: 'contain'},
		];
		for (const mask of masks) {
			expect(validateMask(mask)).toEqual(mask);
		}
	});

	it('rounds and clamps feather', () => {
		const feather = (value: unknown) =>
			validateMask({kind: 'paint', feather: value})?.feather;
		expect(feather(3.5)).toBe(4);
		expect(feather(3.49)).toBe(3);
		expect(feather(-4)).toBe(0);
		expect(feather(999)).toBe(256);
		expect(feather(Infinity)).toBe(256);
		expect(feather(NaN)).toBe(0);
		expect(feather('8')).toBe(0);
	});

	it('swaps, clamps and rounds the brightness range and softness', () => {
		expect(
			validateMask({kind: 'luma', range: [2, 0.12345], softness: 0.4567}),
		).toMatchObject({range: [0.123, 1], softness: 0.457});
		expect(
			validateMask({kind: 'luma', range: [0.5], softness: -1}),
		).toMatchObject({range: [0.5, 1], softness: 0});
	});

	it('empties a hash that is not 64 lowercase hex digits and resets a bad fit', () => {
		for (const bad of ['AB'.repeat(32), 'abc', 7, null]) {
			expect(validateMask({kind: 'paint', asset: bad})).toMatchObject({
				asset: '',
			});
			expect(validateMask({kind: 'image', source: bad})).toMatchObject({
				source: '',
			});
		}

		expect(validateMask({kind: 'image', fit: 'tile'})).toMatchObject({
			fit: 'cover',
		});
		expect(validateMask({kind: 'luma', invert: 1})).toMatchObject({
			invert: false,
		});
	});

	it('rejects a newer or unknown kind and values that are not objects', () => {
		const rejected = [
			{kind: 'gradient', invert: false, feather: 0},
			{kind: 'toString'},
			{kind: '__proto__'},
			{kind: 1},
			{},
			[],
			null,
			undefined,
			'paint',
			3,
		];
		for (const value of rejected) {
			expect(validateMask(value)).toBeUndefined();
		}
	});

	it('returns a copy without unknown keys and leaves the input alone', () => {
		const stored = {kind: 'luma', range: [1, 0], extra: 'x'};
		const snapshot = structuredClone(stored);
		const mask = validateMask(stored);
		expect(mask).not.toHaveProperty('extra');
		expect(stored).toEqual(snapshot);
	});
});

describe('stack schema version and canonical JSON', () => {
	const masked = instance('testInvert', {
		mask: {kind: 'luma', invert: false, feather: 0, range: [0, 1], softness: 0},
	});
	const plain = instance('testInvert');

	it('is 2 exactly when some instance has a mask', () => {
		expect(stackSchemaVersion([])).toBe(1);
		expect(stackSchemaVersion([plain])).toBe(1);
		expect(stackSchemaVersion([plain, masked])).toBe(2);
		expect(stackSchemaVersion([{...masked, enabled: false}])).toBe(2);
		expect(stackSchemaVersion([{...plain, mask: undefined}])).toBe(1);
	});

	it('includes the mask, so every mask change gives different text', () => {
		const stackWith = (feather: number): EffectStack => ({
			schemaVersion: 2,
			instances: [{...masked, mask: {...masked.mask!, feather}}],
		});
		expect(canonicalStackJson(stackWith(0))).toContain('"mask":{"feather":0');
		expect(canonicalStackJson(stackWith(0))).not.toBe(
			canonicalStackJson(stackWith(1)),
		);
	});

	it('writes an undefined mask like an absent one', () => {
		const withUndefined: EffectStack = {
			schemaVersion: 1,
			instances: [{...plain, mask: undefined}],
		};
		expect(canonicalStackJson(withUndefined)).toBe(
			canonicalStackJson({schemaVersion: 1, instances: [plain]}),
		);
	});
});
