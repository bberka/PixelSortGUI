import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	defaultParams,
	migrateParams,
	resolveInstance,
	validateParams,
} from '../../src/engine/params.ts';
import {createRegistry} from '../../src/engine/registry.ts';
import type {
	EffectDefinition,
	ParamSpec,
	ParamSpecs,
} from '../../src/engine/types.ts';
import {instance, type Params} from './sample-effects.ts';

const meta = {label: 'Label', group: 'Group'};

function one(spec: ParamSpec, value: unknown): unknown {
	return validateParams({p: spec}, {p: value}).p;
}

describe('validateParams: number', () => {
	const ratio: ParamSpec = {
		...meta,
		kind: 'number',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.5,
	};

	it('keeps a valid value', () => {
		expect(one(ratio, 0.25)).toBe(0.25);
	});

	it('rounds to the step, giving the nearest double to the decimal', () => {
		expect(one(ratio, 0.567)).toBe(0.57);
		expect(one(ratio, 0.289999)).toBe(0.29);
	});

	it('clamps to min and max', () => {
		expect(one(ratio, 2)).toBe(1);
		expect(one(ratio, -1)).toBe(0);
		expect(one(ratio, Infinity)).toBe(1);
		expect(one(ratio, -Infinity)).toBe(0);
	});

	it('uses the default for a wrong type or NaN', () => {
		expect(one(ratio, '0.3')).toBe(0.5);
		expect(one(ratio, NaN)).toBe(0.5);
		expect(one(ratio, null)).toBe(0.5);
		expect(one(ratio, [0.3, 0.4])).toBe(0.5);
		expect(one(ratio, true)).toBe(0.5);
	});

	it('uses the default for a missing key', () => {
		expect(validateParams({p: ratio}, {})).toEqual({p: 0.5});
	});

	it('rounds halves away from zero and never stores -0', () => {
		const signed: ParamSpec = {
			...meta,
			kind: 'number',
			min: -1,
			max: 1,
			step: 0.25,
			default: 0,
		};
		expect(one(signed, -0.3)).toBe(-0.25);
		expect(one(signed, -0.375)).toBe(-0.5);
		expect(one(signed, 0.375)).toBe(0.5);
		expect(Object.is(one(signed, -0.1), 0)).toBe(true);
		expect(Object.is(one(signed, -0), 0)).toBe(true);
	});

	it('rounds to a step larger than 1', () => {
		const coarse: ParamSpec = {
			...meta,
			kind: 'number',
			min: 0,
			max: 100,
			step: 5,
			default: 50,
		};
		expect(one(coarse, 12.5)).toBe(15);
		expect(one(coarse, 12.4)).toBe(10);
	});

	it('stays inside the range when max is not a multiple of the step', () => {
		const odd: ParamSpec = {
			...meta,
			kind: 'number',
			min: 0,
			max: 0.95,
			step: 0.1,
			default: 0.5,
		};
		expect(one(odd, 0.99)).toBe(0.95);
	});
});

describe('validateParams: integer', () => {
	const length: ParamSpec = {
		...meta,
		kind: 'integer',
		min: 1,
		max: 100,
		default: 8,
		unit: 'px',
	};

	it('rounds to an integer', () => {
		expect(one(length, 3.5)).toBe(4);
		expect(one(length, 3.4)).toBe(3);
		expect(one(length, 42)).toBe(42);
	});

	it('clamps to min and max', () => {
		expect(one(length, 0)).toBe(1);
		expect(one(length, 1000)).toBe(100);
		expect(one(length, -Infinity)).toBe(1);
	});

	it('uses the default for a wrong type, NaN or a missing key', () => {
		expect(one(length, '7')).toBe(8);
		expect(one(length, NaN)).toBe(8);
		expect(validateParams({p: length}, {})).toEqual({p: 8});
	});
});

describe('validateParams: boolean', () => {
	const flag: ParamSpec = {...meta, kind: 'boolean', default: true};

	it('keeps booleans and replaces everything else with the default', () => {
		expect(one(flag, false)).toBe(false);
		expect(one(flag, 'false')).toBe(true);
		expect(one(flag, 0)).toBe(true);
		expect(validateParams({p: flag}, {})).toEqual({p: true});
	});
});

describe('validateParams: enum', () => {
	const mode: ParamSpec = {
		...meta,
		kind: 'enum',
		options: [
			{value: 'a', label: 'A'},
			{value: 'b', label: 'B'},
		],
		default: 'a',
	};

	it('keeps a listed option and replaces everything else with the default', () => {
		expect(one(mode, 'b')).toBe('b');
		expect(one(mode, 'zzz')).toBe('a');
		expect(one(mode, 3)).toBe('a');
		expect(validateParams({p: mode}, {})).toEqual({p: 'a'});
	});
});

describe('validateParams: range', () => {
	const threshold: ParamSpec = {
		...meta,
		kind: 'range',
		min: 0,
		max: 1,
		step: 0.01,
		default: [0.25, 0.75],
	};

	it('keeps a valid pair and returns a new array', () => {
		const pair = [0.1, 0.9] as const;
		const result = one(threshold, pair);
		expect(result).toEqual([0.1, 0.9]);
		expect(result).not.toBe(pair);
	});

	it('swaps a pair whose low end is above its high end', () => {
		expect(one(threshold, [0.8, 0.2])).toEqual([0.2, 0.8]);
	});

	it('clamps and rounds both ends', () => {
		expect(one(threshold, [-1, 2])).toEqual([0, 1]);
		expect(one(threshold, [0.123, 0.456])).toEqual([0.12, 0.46]);
	});

	it('uses the default for anything that is not a pair of numbers', () => {
		expect(one(threshold, [0.5])).toEqual([0.25, 0.75]);
		expect(one(threshold, [0.1, 0.2, 0.3])).toEqual([0.25, 0.75]);
		expect(one(threshold, [0.1, 'a'])).toEqual([0.25, 0.75]);
		expect(one(threshold, [0.1, NaN])).toEqual([0.25, 0.75]);
		expect(one(threshold, 0.5)).toEqual([0.25, 0.75]);
		expect(validateParams({p: threshold}, {})).toEqual({p: [0.25, 0.75]});
	});
});

describe('validateParams: angle', () => {
	const angle: ParamSpec = {
		...meta,
		kind: 'angle',
		default: 90,
		snaps: [0, 90],
	};

	it('normalises into [0, 360) in steps of 0.1', () => {
		expect(one(angle, 45)).toBe(45);
		expect(one(angle, 370)).toBe(10);
		expect(one(angle, -90)).toBe(270);
		expect(one(angle, 360)).toBe(0);
		expect(one(angle, 720.5)).toBe(0.5);
		expect(one(angle, 12.34)).toBe(12.3);
		expect(one(angle, 359.96)).toBe(0);
	});

	it('rounds halves away from zero before wrapping', () => {
		expect(one(angle, -0.05)).toBe(359.9);
	});

	it('uses the default for a wrong type or a non-finite number', () => {
		expect(one(angle, '45')).toBe(90);
		expect(one(angle, NaN)).toBe(90);
		expect(one(angle, Infinity)).toBe(90);
		expect(one(angle, 1e308)).toBe(90);
		expect(validateParams({p: angle}, {})).toEqual({p: 90});
	});

	it('normalises the schema default too', () => {
		expect(one({...meta, kind: 'angle', default: 360, snaps: []}, 'x')).toBe(0);
	});
});

describe('validateParams: seed', () => {
	const seed: ParamSpec = {...meta, kind: 'seed'};

	it('converts numbers to uint32', () => {
		expect(one(seed, 123)).toBe(123);
		expect(one(seed, -1)).toBe(4_294_967_295);
		expect(one(seed, 2 ** 32 + 5)).toBe(5);
		expect(one(seed, 1.9)).toBe(1);
	});

	it('uses 0 for a wrong type, NaN or a missing key', () => {
		expect(one(seed, 'x')).toBe(0);
		expect(one(seed, NaN)).toBe(0);
		expect(validateParams({p: seed}, {})).toEqual({p: 0});
	});
});

describe('validateParams: image', () => {
	const picture: ParamSpec = {...meta, kind: 'image', default: ''};
	const sha256 = '0123456789abcdef'.repeat(4);

	it('keeps an empty string or 64 lowercase hex digits', () => {
		expect(one(picture, '')).toBe('');
		expect(one(picture, sha256)).toBe(sha256);
	});

	it.each([
		sha256.toUpperCase(),
		sha256.slice(1),
		`${sha256}0`,
		`${sha256}\n`,
		'g'.repeat(64),
		`blob:${sha256}`,
		7,
		null,
	])('drops %j', (value) => {
		expect(one(picture, value)).toBe('');
	});
});

type EveryKind = {
	amount: number;
	span: number;
	on: boolean;
	mode: string;
	window: readonly [number, number];
	direction: number;
	seed: number;
};

const everyKind = {
	amount: {...meta, kind: 'number', min: -2, max: 2, step: 0.05, default: 1},
	span: {...meta, kind: 'integer', min: 0, max: 500, default: 20},
	on: {...meta, kind: 'boolean', default: false},
	mode: {
		...meta,
		kind: 'enum',
		options: [
			{value: 'x', label: 'X'},
			{value: 'y', label: 'Y'},
		],
		default: 'y',
	},
	window: {
		...meta,
		kind: 'range',
		min: 0,
		max: 255,
		step: 1,
		default: [10, 20],
	},
	direction: {...meta, kind: 'angle', default: 180, snaps: []},
	seed: {...meta, kind: 'seed'},
} satisfies ParamSpecs<EveryKind>;

describe('validateParams: whole object', () => {
	it('drops unknown keys and returns keys in schema order', () => {
		const result = validateParams<EveryKind>(everyKind, {
			seed: 7,
			extra: 'from a newer version',
			amount: 0.5,
		});
		expect(Object.keys(result)).toEqual(Object.keys(everyKind));
		expect(result).toEqual({
			amount: 0.5,
			span: 20,
			on: false,
			mode: 'y',
			window: [10, 20],
			direction: 180,
			seed: 7,
		});
	});

	it('ignores inherited properties of the input', () => {
		const inherited = Object.create({span: 99}) as Record<string, unknown>;
		expect(validateParams<EveryKind>(everyKind, inherited).span).toBe(20);
	});

	it('does not modify its input', () => {
		const input = {window: [200, 100], extra: 1};
		validateParams(everyKind, input);
		expect(input).toEqual({window: [200, 100], extra: 1});
	});

	it('defaultParams returns every default', () => {
		expect(defaultParams(everyKind)).toEqual({
			amount: 1,
			span: 20,
			on: false,
			mode: 'y',
			window: [10, 20],
			direction: 180,
			seed: 0,
		});
	});

	it('is idempotent and always in range for arbitrary input (engine.md 14.3 item 6)', () => {
		const anyValue = fc.oneof(
			fc.anything(),
			fc.double(),
			fc.tuple(fc.double(), fc.double()),
			fc.constantFrom('x', 'y', 'z'),
		);
		fc.assert(
			fc.property(
				fc.record(
					{
						amount: anyValue,
						span: anyValue,
						on: anyValue,
						mode: anyValue,
						window: anyValue,
						direction: anyValue,
						seed: anyValue,
						unknown: anyValue,
					},
					{requiredKeys: []},
				),
				(input) => {
					const once = validateParams<EveryKind>(everyKind, input);
					expect(validateParams(everyKind, once)).toEqual(once);
					expect(once.amount >= -2 && once.amount <= 2).toBe(true);
					expect(Number.isSafeInteger(once.span)).toBe(true);
					expect(once.span >= 0 && once.span <= 500).toBe(true);
					expect(typeof once.on).toBe('boolean');
					expect(['x', 'y']).toContain(once.mode);
					expect(once.window[0] <= once.window[1]).toBe(true);
					expect(once.window[0] >= 0 && once.window[1] <= 255).toBe(true);
					expect(once.direction >= 0 && once.direction < 360).toBe(true);
					expect(Number.isSafeInteger(once.seed)).toBe(true);
					expect(once.seed >= 0 && once.seed <= 0xff_ff_ff_ff).toBe(true);
				},
			),
			{numRuns: 1000},
		);
	});
});

// Version 1 had `delta`; version 2 renamed it to `amount`; version 3 changed
// output only; version 4 doubled the scale of `amount`.
const versioned: EffectDefinition<{amount: number}> = {
	type: 'testVersioned',
	version: 4,
	label: 'Versioned',
	description: 'Test effect.',
	category: 'color',
	params: {
		amount: {...meta, kind: 'integer', min: 0, max: 100, default: 5},
	},
	migrations: {
		1(old) {
			const {delta, ...rest} = old;
			return {...rest, amount: delta ?? 5};
		},
		3(old) {
			old.amount = typeof old.amount === 'number' ? old.amount * 2 : 5;
			return old;
		},
	},
	render(input, output) {
		output.data.set(input.data);
	},
};

describe('migrateParams', () => {
	it('applies every migration from the given version in sequence', () => {
		expect(migrateParams(versioned, 1, {delta: 7})).toEqual({amount: 14});
		expect(migrateParams(versioned, 2, {amount: 7})).toEqual({amount: 14});
		expect(migrateParams(versioned, 3, {amount: 7})).toEqual({amount: 14});
	});

	it('leaves parameters of the current version alone', () => {
		expect(migrateParams(versioned, 4, {amount: 7})).toEqual({amount: 7});
	});

	it('does not modify its input, even when a migration writes to its argument', () => {
		const stored = {amount: 7};
		migrateParams(versioned, 3, stored);
		expect(stored).toEqual({amount: 7});
	});

	it('produces parameters that pass validation from every version (engine.md 14.3 item 6)', () => {
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 4}),
				fc.dictionary(
					fc.constantFrom('delta', 'amount', 'other'),
					fc.oneof(fc.double(), fc.boolean(), fc.string()),
				),
				(version, params: Params) => {
					const migrated = migrateParams(versioned, version, params);
					const valid = validateParams(versioned.params, migrated);
					expect(validateParams(versioned.params, valid)).toEqual(valid);
					expect(Object.keys(valid)).toEqual(['amount']);
					expect(Number.isSafeInteger(valid.amount)).toBe(true);
					expect(valid.amount >= 0 && valid.amount <= 100).toBe(true);
				},
			),
			{numRuns: 500},
		);
	});
});

describe('resolveInstance', () => {
	const registry = createRegistry([versioned]);

	it('returns validated parameters for a current instance', () => {
		const current = instance('testVersioned', {
			version: 4,
			params: {amount: 9},
		});
		expect(resolveInstance(current, registry)).toEqual({
			status: 'ok',
			definition: versioned,
			params: {amount: 9},
			migrated: false,
			fixed: false,
		});
	});

	it('migrates an older instance without modifying it', () => {
		const old = instance('testVersioned', {version: 1, params: {delta: 4}});
		const before = structuredClone(old);
		expect(resolveInstance(old, registry)).toMatchObject({
			status: 'ok',
			params: {amount: 8},
			migrated: true,
			fixed: false,
		});
		expect(old).toEqual(before);
	});

	it('reports when validation had to change a value', () => {
		const wild = instance('testVersioned', {
			version: 4,
			params: {amount: 5000, stray: true},
		});
		expect(resolveInstance(wild, registry)).toMatchObject({
			status: 'ok',
			params: {amount: 100},
			fixed: true,
		});
	});

	it('reports an unknown type and a newer version', () => {
		expect(resolveInstance(instance('fromTheFuture'), registry)).toEqual({
			status: 'unknown-type',
		});
		expect(
			resolveInstance(instance('testVersioned', {version: 5}), registry),
		).toEqual({status: 'newer-version', definition: versioned});
	});

	it('treats a version that is not a positive integer as version 1', () => {
		const broken = instance('testVersioned', {
			version: NaN,
			params: {delta: 3},
		});
		expect(resolveInstance(broken, registry)).toMatchObject({
			status: 'ok',
			params: {amount: 6},
			migrated: true,
		});
	});

	it('uses the defaults when the stored params are not an object', () => {
		const broken = instance('testVersioned', {
			version: 4,
			params: null as unknown as Params,
		});
		expect(resolveInstance(broken, registry)).toMatchObject({
			status: 'ok',
			params: {amount: 5},
			fixed: true,
		});
	});
});
