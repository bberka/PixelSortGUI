import type {BlendMode, ParamSpec, ParamValue} from '../engine/types.ts';
import {
	decimalsForStep,
	formatIntegerParam,
	formatNumberParam,
	type NumberSpec,
} from '../features/params/format.ts';

const MIN_LABEL_DECIMALS = 2;

// "0.8" reads as "0.80", while "0.253" keeps the digit a 0.001 step allows.
function formatStepped(value: number, step: number): string {
	const decimals = decimalsForStep(step);
	if (decimals === 0) {
		return String(value);
	}

	const padded = value.toFixed(Math.max(decimals, MIN_LABEL_DECIMALS));
	const shortest = value.toFixed(MIN_LABEL_DECIMALS);
	return Number(shortest) === Number(padded)
		? shortest
		: String(Number(padded));
}

function formatNumberValue(spec: NumberSpec, value: number): string {
	return spec.unit === 'percent'
		? formatNumberParam(spec, value)
		: formatStepped(value, spec.step);
}

function formatValue(spec: ParamSpec, value: ParamValue): string {
	switch (spec.kind) {
		case 'range': {
			const [low, high] = value as readonly [number, number];
			return `${formatStepped(low, spec.step)} to ${formatStepped(high, spec.step)}`;
		}

		case 'number': {
			return formatNumberValue(spec, value as number);
		}

		case 'integer': {
			return formatIntegerParam(spec, value as number);
		}

		case 'angle': {
			return `${Number((value as number).toFixed(1))}°`;
		}

		case 'boolean': {
			return value ? 'on' : 'off';
		}

		case 'enum': {
			return (
				spec.options.find((option) => option.value === value)?.label ??
				String(value)
			);
		}

		case 'seed': {
			return String(value);
		}
	}
}

export function formatParamCommitLabel(
	spec: ParamSpec,
	value: ParamValue,
): string {
	return `${spec.label} ${formatValue(spec, value)}`;
}

export function formatMixCommitLabel(mix: number): string {
	return `Mix ${Math.round(mix * 100)}%`;
}

export function formatBlendCommitLabel(blend: BlendMode): string {
	return `Blend ${blend.charAt(0).toUpperCase()}${blend.slice(1)}`;
}
