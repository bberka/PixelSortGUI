import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	Cancelled,
	canonicalJson,
	canonicalStackJson,
	copyImage,
	createImage,
	type EffectStack,
} from '../../src/engine/types.ts';

const sample: EffectStack = {
	schemaVersion: 1,
	instances: [
		{
			id: 'abcd1234',
			type: 'pixelSort',
			version: 1,
			enabled: true,
			params: {threshold: [0.25, 0.8], angle: 90, key: 'luma', invert: false},
			mix: 0.5,
			blend: 'lighten',
		},
	],
};

function reorder(value: unknown, reverse: boolean): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => reorder(item, reverse));
	}

	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value).map(
			([key, item]) => [key, reorder(item, reverse)] as const,
		);
		return Object.fromEntries(reverse ? entries.toReversed() : entries);
	}

	return value;
}

function viaJson(value: unknown): unknown {
	// eslint-disable-next-line unicorn/prefer-structured-clone -- the point is what JSON keeps, which structuredClone does not reproduce (-0, undefined)
	return JSON.parse(JSON.stringify(value));
}

describe('canonicalStackJson', () => {
	it('sorts keys at every level and uses no whitespace', () => {
		expect(canonicalStackJson(sample)).toBe(
			'{"instances":[{"blend":"lighten","enabled":true,"id":"abcd1234","mix":0.5,' +
				'"params":{"angle":90,"invert":false,"key":"luma","threshold":[0.25,0.8]},' +
				'"type":"pixelSort","version":1}],"schemaVersion":1}',
		);
	});

	it('gives the same string whatever order the keys were written in', () => {
		const reversed = reorder(sample, true) as EffectStack;
		expect(Object.keys(reversed)).toEqual(['instances', 'schemaVersion']);
		expect(Object.keys(reversed.instances[0].params)[0]).toBe('invert');
		expect(canonicalStackJson(reversed)).toBe(canonicalStackJson(sample));
	});

	it('parses back to the same stack', () => {
		expect(JSON.parse(canonicalStackJson(sample))).toEqual(sample);
	});

	it('keeps array order: instance order and range order are part of the value', () => {
		const second = {...sample.instances[0], id: 'zzzz0000'};
		const ab = {...sample, instances: [sample.instances[0], second]};
		const ba = {...sample, instances: [second, sample.instances[0]]};
		expect(canonicalStackJson(ab)).not.toBe(canonicalStackJson(ba));
		expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
	});

	it('keeps unknown effect types, unknown parameters and unknown fields', () => {
		const future = {
			schemaVersion: 1,
			instances: [
				{
					...sample.instances[0],
					type: 'notInvented',
					version: 9,
					params: {tiles: 4, nested: {b: 1, a: [true, null]}},
					maskId: 'm1',
				},
			],
		} as unknown as EffectStack;
		const json = canonicalStackJson(future);
		expect(JSON.parse(json)).toEqual(future);
		expect(json).toContain('"maskId":"m1"');
		expect(json).toContain('"nested":{"a":[true,null],"b":1}');
	});
});

describe('canonicalJson', () => {
	it('writes numbers in shortest round-trip form', () => {
		expect(canonicalJson([1, 0.1 + 0.2, 1e21, 1e-7, -0, 0.57])).toBe(
			'[1,0.30000000000000004,1e+21,1e-7,0,0.57]',
		);
	});

	it('sorts keys by code unit, so capitals come before lower case', () => {
		expect(canonicalJson({b: 1, a: 2, B: 3, 10: 4, 9: 5})).toBe(
			'{"10":4,"9":5,"B":3,"a":2,"b":1}',
		);
	});

	it('follows JSON for values JSON cannot hold', () => {
		expect(canonicalJson({a: undefined, b: NaN, c: [undefined]})).toBe(
			'{"b":null,"c":[null]}',
		);
	});

	it('escapes strings and keys as JSON does', () => {
		expect(canonicalJson({'a"b': 'line\nbreak'})).toBe(
			String.raw`{"a\"b":"line\nbreak"}`,
		);
	});

	it('is stable under key reordering and parses back, for any JSON value', () => {
		fc.assert(
			fc.property(fc.jsonValue(), (value) => {
				const canonical = canonicalJson(value);
				expect(canonicalJson(reorder(value, true))).toBe(canonical);
				expect(canonicalJson(JSON.parse(canonical))).toBe(canonical);
				expect(JSON.parse(canonical)).toEqual(viaJson(value));
			}),
			{numRuns: 500},
		);
	});
});

describe('image helpers', () => {
	it('createImage allocates a zeroed buffer of the right length', () => {
		const img = createImage(3, 2);
		expect(img.width).toBe(3);
		expect(img.height).toBe(2);
		expect(img.data).toEqual(new Uint8ClampedArray(24));
	});

	it('copyImage copies the bytes into a new buffer', () => {
		const img = createImage(1, 1);
		img.data.set([1, 2, 3, 4]);
		const copy = copyImage(img);
		expect(copy).toEqual(img);
		copy.data[0] = 99;
		expect(img.data[0]).toBe(1);
	});
});

describe('Cancelled', () => {
	it('is an Error that can be told apart by class and name', () => {
		const error = new Cancelled();
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('Cancelled');
	});
});
