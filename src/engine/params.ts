import {clamp, roundHalfAway, wrap} from './math.ts';
import {
	canonicalJson,
	type EffectDefinition,
	type EffectInstance,
	type EffectRegistry,
	type ParamSpec,
	type ParamSpecs,
	type ParamValue,
} from './types.ts';

const SHA256_HEX = /^[\da-f]{64}$/;

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && !Number.isNaN(value);
}

/**
 Rounds to a multiple of `step`. Steps of the form 1/k (0.01, 0.1, 0.5) divide
 by k instead of multiplying by the step, so the result is the double nearest
 to the decimal (0.57, not 0.5700000000000001).
 */
function roundToStep(value: number, step: number): number {
	if (!(step > 0) || !Number.isFinite(value)) {
		return value;
	}

	const perUnit = Math.round(1 / step);
	return perUnit >= 1 && Math.abs(perUnit * step - 1) < 1e-9
		? roundHalfAway(value * perUnit) / perUnit
		: roundHalfAway(value / step) * step;
}

function fitNumber(
	value: number,
	min: number,
	max: number,
	step: number,
): number {
	const fitted = clamp(roundToStep(clamp(value, min, max), step), min, max);
	// Adding 0 turns -0 into 0, so a stored value never differs from itself by sign.
	return fitted + 0;
}

function isPair(value: unknown): value is readonly [number, number] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		isNumber(value[0]) &&
		isNumber(value[1])
	);
}

function validateOne(spec: ParamSpec, value: unknown): ParamValue {
	switch (spec.kind) {
		case 'number': {
			return fitNumber(
				isNumber(value) ? value : spec.default,
				spec.min,
				spec.max,
				spec.step,
			);
		}

		case 'integer': {
			return fitNumber(
				isNumber(value) ? value : spec.default,
				spec.min,
				spec.max,
				1,
			);
		}

		case 'boolean': {
			return typeof value === 'boolean' ? value : spec.default;
		}

		case 'enum': {
			return typeof value === 'string' &&
				spec.options.some((option) => option.value === value)
				? value
				: spec.default;
		}

		case 'range': {
			const pair = isPair(value) ? value : spec.default;
			const a = fitNumber(pair[0], spec.min, spec.max, spec.step);
			const b = fitNumber(pair[1], spec.min, spec.max, spec.step);
			return a > b ? [b, a] : [a, b];
		}

		case 'angle': {
			// A finite angle above about 1.8e307 overflows when multiplied by 10.
			const angle =
				isNumber(value) && Number.isFinite(value * 10) ? value : spec.default;
			return wrap(roundHalfAway(angle * 10), 3600) / 10;
		}

		case 'seed': {
			// eslint-disable-next-line no-bitwise -- seeds are uint32 (engine.md section 3)
			return isNumber(value) ? value >>> 0 : 0;
		}

		case 'image': {
			return typeof value === 'string' && SHA256_HEX.test(value)
				? value
				: spec.default;
		}
	}
}

/**
 Returns a complete, valid parameter object in schema key order. Missing and
 wrongly typed values get the default, unknown keys are dropped. The input is
 not modified.
 */
export function validateParams<P extends Record<string, ParamValue>>(
	specs: ParamSpecs<P>,
	params: Readonly<Record<string, unknown>>,
): P {
	const result: Record<string, ParamValue> = {};
	for (const [key, spec] of Object.entries<ParamSpec>(specs)) {
		const value: unknown = Object.hasOwn(params, key) ? params[key] : undefined;
		result[key] = validateOne(spec, value);
	}

	return result as P;
}

// The schema defaults. A seed defaults to 0: the caller that creates an instance supplies the random seed.
export function defaultParams<P extends Record<string, ParamValue>>(
	specs: ParamSpecs<P>,
): P {
	return validateParams(specs, {});
}

/**
 Applies `definition.migrations` in sequence from `fromVersion` up to
 `definition.version`. A version step with no migration leaves the parameters
 as they are. Each migration gets its own shallow copy, so the caller's
 object is never modified.
 */
export function migrateParams(
	definition: EffectDefinition,
	fromVersion: number,
	params: Readonly<Record<string, ParamValue>>,
): Record<string, ParamValue> {
	let current: Record<string, ParamValue> = {...params};
	for (let version = fromVersion; version < definition.version; version++) {
		const migrate = definition.migrations?.[version];
		if (migrate) {
			current = {...migrate(current)};
		}
	}

	return current;
}

export type ResolvedInstance =
	| {
			status: 'ok';
			definition: EffectDefinition;
			// Migrated to `definition.version` and validated: what `render` receives.
			params: Record<string, ParamValue>;
			// The instance's version was lower than the definition's.
			migrated: boolean;
			// Validation changed, added or dropped a value.
			fixed: boolean;
	  }
	| {status: 'unknown-type'}
	| {status: 'newer-version'; definition: EffectDefinition};

/**
 Finds the instance's definition and brings its parameters up to date. The
 instance is not modified; an unknown type or a newer version is reported so
 the caller can keep the instance as it is.
 */
export function resolveInstance(
	instance: EffectInstance,
	registry: EffectRegistry,
): ResolvedInstance {
	const definition = registry.get(instance.type);
	if (!definition) {
		return {status: 'unknown-type'};
	}

	const version =
		Number.isSafeInteger(instance.version) && instance.version >= 1
			? instance.version
			: 1;
	if (version > definition.version) {
		return {status: 'newer-version', definition};
	}

	const stored: unknown = instance.params;
	const raw =
		typeof stored === 'object' && stored !== null && !Array.isArray(stored)
			? (stored as Record<string, ParamValue>)
			: {};
	const migrated = migrateParams(definition, version, raw);
	const params = validateParams(definition.params, migrated);
	return {
		status: 'ok',
		definition,
		params,
		migrated: version < definition.version,
		fixed: canonicalJson(params) !== canonicalJson(migrated),
	};
}
