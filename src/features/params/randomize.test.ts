import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {randomizeParams, type RandomSource} from './randomize.ts';
import {effects} from '@/engine/effects/index.ts';
import {validateParams} from '@/engine/params.ts';
import type {ParamSpec, ParamSpecs, ParamValue} from '@/engine/types.ts';

const meta = {label: 'Label', group: 'Group'};

function sequence(values: readonly number[]): RandomSource {
	let index = 0;
	return () => {
		const value = values[index % values.length];
		index++;
		return value;
	};
}

function isOnStep(value: number, step: number): boolean {
	const steps = value / step;
	return Math.abs(steps - Math.round(steps)) < 1e-6;
}

const unitInterval = fc.double({
	min: 0,
	max: 1,
	maxExcluded: true,
	noNaN: true,
});
const randomValues = fc.array(unitInterval, {minLength: 1, maxLength: 64});

const stepArb = fc.constantFrom(1, 0.5, 0.25, 0.1, 0.05, 0.01);
const boundsArb = fc
	.record({
		min: fc.integer({min: -100_000, max: 100_000}),
		steps: fc.integer({min: 1, max: 200}),
		extra: fc.double({min: 0, max: 0.99, noNaN: true}),
		step: stepArb,
	})
	.map(({min, steps, extra, step}) => {
		const low = min / 1000;
		return {min: low, max: low + (steps + extra) * step, step};
	});
const integerBoundsArb = fc
	.tuple(fc.integer({min: -5000, max: 5000}), fc.integer({min: 0, max: 5000}))
	.map(([min, span]) => ({min, max: min + span}));

const numberSpecArb = boundsArb.map(({min, max, step}): ParamSpec => ({
	...meta,
	kind: 'number',
	min,
	max,
	step,
	default: min,
}));
const integerSpecArb = integerBoundsArb.map(({min, max}): ParamSpec => ({
	...meta,
	kind: 'integer',
	min,
	max,
	default: min,
}));
const rangeSpecArb = boundsArb.map(({min, max, step}): ParamSpec => ({
	...meta,
	kind: 'range',
	min,
	max,
	step,
	default: [min, max],
}));
const angleSpecArb = fc.constant<ParamSpec>({
	...meta,
	kind: 'angle',
	default: 0,
	snaps: [0, 90, 180, 270],
});
const enumSpecArb = fc
	.uniqueArray(fc.string({minLength: 1, maxLength: 6}), {
		minLength: 1,
		maxLength: 8,
	})
	.map((values): ParamSpec => ({
		...meta,
		kind: 'enum',
		options: values.map((value) => ({value, label: value})),
		default: values[0],
	}));
const booleanSpecArb = fc
	.boolean()
	.map((value): ParamSpec => ({...meta, kind: 'boolean', default: value}));
const seedSpecArb = fc.constant<ParamSpec>({...meta, kind: 'seed'});

const anySpecArb = fc.oneof(
	numberSpecArb,
	integerSpecArb,
	rangeSpecArb,
	angleSpecArb,
	enumSpecArb,
	booleanSpecArb,
	seedSpecArb,
);

function one(spec: ParamSpec, values: readonly number[]): ParamValue {
	return randomizeParams({p: spec}, sequence(values)).p;
}

describe('randomizeParams properties', () => {
	it('draws a number inside its bounds, on its step', () => {
		fc.assert(
			fc.property(numberSpecArb, randomValues, (spec, values) => {
				if (spec.kind !== 'number') {
					throw new Error('Expected a number spec');
				}

				const value = one(spec, values);
				expect(typeof value).toBe('number');
				expect(value).toBeGreaterThanOrEqual(spec.min);
				expect(value).toBeLessThanOrEqual(spec.max);
				expect(isOnStep(value as number, spec.step)).toBe(true);
			}),
		);
	});

	it('draws an integer inside its bounds', () => {
		fc.assert(
			fc.property(integerSpecArb, randomValues, (spec, values) => {
				if (spec.kind !== 'integer') {
					throw new Error('Expected an integer spec');
				}

				const value = one(spec, values);
				expect(Number.isSafeInteger(value)).toBe(true);
				expect(value).toBeGreaterThanOrEqual(spec.min);
				expect(value).toBeLessThanOrEqual(spec.max);
			}),
		);
	});

	it('draws an angle in [0, 360) on the 0.1 step', () => {
		fc.assert(
			fc.property(angleSpecArb, randomValues, (spec, values) => {
				const value = one(spec, values) as number;
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThan(360);
				expect(isOnStep(value, 0.1)).toBe(true);
			}),
		);
	});

	it('draws an ordered range of two values inside its bounds, on its step', () => {
		fc.assert(
			fc.property(rangeSpecArb, randomValues, (spec, values) => {
				if (spec.kind !== 'range') {
					throw new Error('Expected a range spec');
				}

				const value = one(spec, values);
				if (!Array.isArray(value)) {
					throw new TypeError('Expected a pair');
				}

				const ends: number[] = value;
				const [low, high] = ends;
				expect(ends).toHaveLength(2);
				expect(low).toBeLessThanOrEqual(high);
				for (const end of ends) {
					expect(end).toBeGreaterThanOrEqual(spec.min);
					expect(end).toBeLessThanOrEqual(spec.max);
					expect(isOnStep(end, spec.step)).toBe(true);
				}
			}),
		);
	});

	it('draws an enum option and a boolean', () => {
		fc.assert(
			fc.property(enumSpecArb, randomValues, (spec, values) => {
				if (spec.kind !== 'enum') {
					throw new Error('Expected an enum spec');
				}

				expect(spec.options.map((option) => option.value)).toContain(
					one(spec, values),
				);
			}),
		);
		fc.assert(
			fc.property(booleanSpecArb, randomValues, (spec, values) => {
				expect(typeof one(spec, values)).toBe('boolean');
			}),
		);
	});

	it('draws a uint32 seed', () => {
		fc.assert(
			fc.property(seedSpecArb, randomValues, (spec, values) => {
				const value = one(spec, values) as number;
				expect(Number.isSafeInteger(value)).toBe(true);
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThanOrEqual(0xff_ff_ff_ff);
			}),
		);
	});

	it('gives the same result for the same random source and passes validateParams unchanged', () => {
		fc.assert(
			fc.property(
				fc.array(anySpecArb, {minLength: 1, maxLength: 8}),
				randomValues,
				(list, values) => {
					const specs: ParamSpecs = Object.fromEntries(
						list.map((spec, index) => [`p${index}`, spec]),
					);
					const first = randomizeParams(specs, sequence(values));
					const second = randomizeParams(specs, sequence(values));
					expect(second).toEqual(first);
					expect(validateParams(specs, first)).toEqual(first);
					expect(Object.keys(first)).toEqual(Object.keys(specs));
				},
			),
		);
	});
});

describe('randomizeParams values', () => {
	it('maps the ends and middle of the random source onto an integer span', () => {
		const spec: ParamSpec = {
			...meta,
			kind: 'integer',
			min: 0,
			max: 3,
			default: 0,
		};
		expect([0, 0.25, 0.5, 0.75, 0.999999].map((r) => one(spec, [r]))).toEqual([
			0, 1, 2, 3, 3,
		]);
	});

	it('gives the first and last grid value of a number with equal weight', () => {
		const spec: ParamSpec = {
			...meta,
			kind: 'number',
			min: 0,
			max: 1,
			step: 0.25,
			default: 0,
		};
		expect([0, 0.2, 0.4, 0.6, 0.8].map((r) => one(spec, [r]))).toEqual([
			0, 0.25, 0.5, 0.75, 1,
		]);
	});

	it('orders a range whichever way the two draws fall', () => {
		const spec: ParamSpec = {
			...meta,
			kind: 'range',
			min: 0,
			max: 10,
			step: 1,
			default: [0, 10],
		};
		expect(one(spec, [0.9, 0.1])).toEqual([1, 9]);
	});

	it('maps the source onto angle, enum, boolean and seed', () => {
		const specs: ParamSpecs = {
			angle: {...meta, kind: 'angle', default: 0, snaps: []},
			mode: {
				...meta,
				kind: 'enum',
				options: [
					{value: 'a', label: 'A'},
					{value: 'b', label: 'B'},
				],
				default: 'a',
			},
			flag: {...meta, kind: 'boolean', default: false},
			seed: {...meta, kind: 'seed'},
		};
		expect(randomizeParams(specs, sequence([0.5, 0.6, 0.4, 0.5]))).toEqual({
			angle: 180,
			mode: 'b',
			flag: true,
			seed: 2_147_483_648,
		});
	});

	it('never invents an image', () => {
		const spec: ParamSpec = {...meta, kind: 'image', default: ''};
		expect([0, 0.5, 0.999999].map((r) => one(spec, [r]))).toEqual(['', '', '']);
	});

	it('keeps the chosen image', () => {
		const spec: ParamSpec = {...meta, kind: 'image', default: ''};
		const image = 'a'.repeat(64);
		expect(
			[0, 0.999999].map(
				(r) => randomizeParams({p: spec}, sequence([r]), {p: image}).p,
			),
		).toEqual([image, image]);
	});

	it('is valid for every registered effect, including parameters hidden by visibleWhen', () => {
		fc.assert(
			fc.property(randomValues, (values) => {
				for (const definition of effects) {
					const params = randomizeParams(definition.params, sequence(values));
					expect(validateParams(definition.params, params)).toEqual(params);
					expect(Object.keys(params)).toEqual(Object.keys(definition.params));
				}
			}),
		);
	});
});
