import type {EffectRegistry, ParamSpec, ParamSpecs} from '@/engine/types.ts';
import {formatAngle, formatNumberParam} from '@/features/params/format.ts';

export type ParamReference = {
	readonly key: string;
	readonly label: string;
	readonly range: string;
	readonly defaultValue: string;
	readonly help?: string;
	/**
	 The condition under which the control appears, when it is not always shown.
	 */
	readonly shownWhen?: string;
};

export type EffectReference = {
	readonly type: string;
	readonly label: string;
	readonly description: string;
	readonly params: readonly ParamReference[];
};

type Described = Pick<ParamReference, 'range' | 'defaultValue'>;

function onOff(value: boolean): string {
	return value ? 'On' : 'Off';
}

function describeSpec(spec: ParamSpec): Described {
	switch (spec.kind) {
		case 'number': {
			return {
				range: `${formatNumberParam(spec, spec.min)} to ${formatNumberParam(spec, spec.max)}`,
				defaultValue: formatNumberParam(spec, spec.default),
			};
		}

		case 'integer': {
			const unit = spec.unit === 'px' ? ' px' : '';
			return {
				range: `${spec.min} to ${spec.max}${unit}`,
				defaultValue: `${spec.default}${unit}`,
			};
		}

		case 'boolean': {
			return {range: 'On or off', defaultValue: onOff(spec.default)};
		}

		case 'enum': {
			return {
				range: spec.options.map((option) => option.label).join(', '),
				defaultValue:
					spec.options.find((option) => option.value === spec.default)?.label ??
					spec.default,
			};
		}

		case 'range': {
			return {
				range: `Two values from ${spec.min} to ${spec.max}`,
				defaultValue: `${spec.default[0]} to ${spec.default[1]}`,
			};
		}

		case 'angle': {
			return {
				range: `${formatAngle(0)} to ${formatAngle(359.9)}`,
				defaultValue: formatAngle(spec.default),
			};
		}

		case 'seed': {
			return {
				range: 'Any whole number',
				defaultValue: 'Random for each new effect',
			};
		}
	}
}

function describeVisibility(
	spec: ParamSpec,
	params: ParamSpecs,
): string | undefined {
	const rule = spec.visibleWhen;
	if (!rule) {
		return undefined;
	}

	const other = params[rule.param];
	const name = (value: string | boolean | number) => {
		if (typeof value === 'boolean') {
			return onOff(value);
		}

		const option =
			other?.kind === 'enum'
				? other.options.find((item) => item.value === value)
				: undefined;
		return option?.label ?? String(value);
	};

	const label = other?.label ?? rule.param;
	const parts: string[] = [];
	if (rule.equals) {
		parts.push(
			`${label} is ${rule.equals.map((value) => name(value)).join(' or ')}`,
		);
	}

	if (rule.notEquals) {
		parts.push(
			`${label} is not ${rule.notEquals.map((value) => name(value)).join(' or ')}`,
		);
	}

	return parts.length > 0 ? parts.join(' and ') : undefined;
}

/**
 The effects reference of the guide, read from the registry so an effect added
 later is listed with no change to the guide (product.md F27).
 */
export function buildEffectsReference(
	registry: EffectRegistry,
): EffectReference[] {
	return registry.list().map((definition) => ({
		type: definition.type,
		label: definition.label,
		description: definition.description,
		params: Object.entries(definition.params).map(([key, spec]) => ({
			key,
			label: spec.label,
			help: spec.help,
			shownWhen: describeVisibility(spec, definition.params),
			...describeSpec(spec),
		})),
	}));
}
