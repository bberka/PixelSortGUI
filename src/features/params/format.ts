import type {ParamSpec, ParamValue} from '@/engine/types.ts';

export type NumberSpec = Extract<ParamSpec, {kind: 'number'}>;
export type IntegerSpec = Extract<ParamSpec, {kind: 'integer'}>;
export type RangeSpec = Extract<ParamSpec, {kind: 'range'}>;
export type AngleSpec = Extract<ParamSpec, {kind: 'angle'}>;
export type EnumSpec = Extract<ParamSpec, {kind: 'enum'}>;
export type BooleanSpec = Extract<ParamSpec, {kind: 'boolean'}>;
export type SeedSpec = Extract<ParamSpec, {kind: 'seed'}>;
export type NumericSpec = NumberSpec | IntegerSpec;

export function decimalsForStep(step: number): number {
	if (!Number.isFinite(step) || step <= 0) {
		return 0;
	}

	const text = step.toString();
	const point = text.indexOf('.');
	return point === -1 ? 0 : text.length - point - 1;
}

function formatPercent(value: number, step: number): string {
	const decimals = Math.max(0, decimalsForStep(step) - 2);
	return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumberParam(spec: NumberSpec, value: number): string {
	return spec.unit === 'percent'
		? formatPercent(value, spec.step)
		: String(value);
}

export function formatIntegerParam(spec: IntegerSpec, value: number): string {
	return spec.unit === 'px' ? `${value} px` : String(value);
}

export function formatNumericParam(spec: NumericSpec, value: number): string {
	return spec.kind === 'number'
		? formatNumberParam(spec, value)
		: formatIntegerParam(spec, value);
}

/**
The text a numeric field shows: a bare number, or a percentage with its unit.
*/
export function formatEntryValue(spec: NumericSpec, value: number): string {
	return spec.kind === 'number' && spec.unit === 'percent'
		? formatNumberParam(spec, value)
		: String(value);
}

export function formatAngle(value: number): string {
	return `${value.toFixed(1)}°`;
}

/**
The angle field shows the bare number so it can be typed over.
*/
export function formatAngleInput(value: number): string {
	return value.toFixed(1);
}

export function formatRange(value: readonly [number, number]): string {
	return `${String(value[0])} – ${String(value[1])}`;
}

export function parseNumericText(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed === '') {
		return null;
	}

	const value = Number(trimmed);
	return Number.isNaN(value) ? null : value;
}

export function parseNumberText(spec: NumberSpec, text: string): number | null {
	if (spec.unit === 'percent') {
		const value = parseNumericText(text.replace(/%$/, ''));
		return value === null ? null : value / 100;
	}

	return parseNumericText(text);
}

export function pairFrom(
	value: ParamValue | undefined,
	fallback: readonly [number, number],
): readonly [number, number] {
	if (
		Array.isArray(value) &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'number'
	) {
		const low: number = value[0];
		const high: number = value[1];
		return [low, high];
	}

	return fallback;
}

export function numberFrom(
	value: ParamValue | undefined,
	fallback: number,
): number {
	return typeof value === 'number' ? value : fallback;
}

export function booleanFrom(
	value: ParamValue | undefined,
	fallback: boolean,
): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

export function stringFrom(
	value: ParamValue | undefined,
	fallback: string,
): string {
	return typeof value === 'string' ? value : fallback;
}

export function isDefaultParamValue(
	spec: ParamSpec,
	value: ParamValue | undefined,
): boolean {
	switch (spec.kind) {
		case 'number':
		case 'integer':
		case 'boolean':
		case 'enum':
		case 'angle': {
			return value === spec.default;
		}

		case 'range': {
			const pair = pairFrom(value, spec.default);
			return pair[0] === spec.default[0] && pair[1] === spec.default[1];
		}

		case 'seed': {
			// A seed instance gets a random value when it is created, so there is no default to compare against.
			return false;
		}
	}
}
