import type {ParamSpec, ParamValue} from '@/engine/types.ts';

function isListed(
	list: ReadonlyArray<string | boolean | number>,
	value: ParamValue | undefined,
): boolean {
	return typeof value === 'boolean' ||
		typeof value === 'number' ||
		typeof value === 'string'
		? list.includes(value)
		: false;
}

/**
 Whether a parameter's control is shown. A hidden parameter keeps its value and
 still reaches `render` (engine.md section 3): `visibleWhen` only hides the
 control.
 */
export function isParamVisible(
	spec: ParamSpec,
	params: Readonly<Record<string, ParamValue>>,
): boolean {
	const rule = spec.visibleWhen;
	if (!rule) {
		return true;
	}

	const other = params[rule.param];
	const equals = rule.equals === undefined || isListed(rule.equals, other);
	const notEquals =
		rule.notEquals === undefined || !isListed(rule.notEquals, other);
	return equals && notEquals;
}
