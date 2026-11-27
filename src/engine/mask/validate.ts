import {validateParams} from '../params.ts';
import type {ParamSpecs, ParamValue} from '../types.ts';
import type {InstanceMask, MaskKind} from './types.ts';

// The fields of each kind, as parameter specs so they follow the section 3 rules.
const SHARED = {
	invert: {
		kind: 'boolean',
		label: 'Invert mask',
		group: 'Mask',
		default: false,
	},
	feather: {
		kind: 'integer',
		label: 'Mask feather',
		group: 'Mask',
		min: 0,
		max: 256,
		default: 0,
		unit: 'px',
	},
} as const;

const MASK_SPECS: Readonly<Record<MaskKind, ParamSpecs>> = {
	paint: {
		...SHARED,
		asset: {kind: 'image', label: 'Paint', group: 'Mask', default: ''},
	},
	luma: {
		...SHARED,
		range: {
			kind: 'range',
			label: 'Mask range',
			group: 'Mask',
			min: 0,
			max: 1,
			step: 0.001,
			default: [0.5, 1],
		},
		softness: {
			kind: 'number',
			label: 'Softness',
			group: 'Mask',
			min: 0,
			max: 1,
			step: 0.001,
			default: 0.1,
			unit: 'ratio',
		},
	},
	image: {
		...SHARED,
		source: {kind: 'image', label: 'Mask image', group: 'Mask', default: ''},
		fit: {
			kind: 'enum',
			label: 'Fit',
			group: 'Mask',
			options: [
				{value: 'cover', label: 'Cover'},
				{value: 'contain', label: 'Contain'},
				{value: 'stretch', label: 'Stretch'},
			],
			default: 'cover',
		},
	},
};

function isMaskKind(kind: unknown): kind is MaskKind {
	return typeof kind === 'string' && Object.hasOwn(MASK_SPECS, kind);
}

/**
 A complete, valid copy of `value`, or `undefined` when it is not a mask this
 version understands (not an object, or an unknown `kind`). The caller must then
 skip the instance, never apply it everywhere. `value` is not modified.
 */
export function validateMask(value: unknown): InstanceMask | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}

	const record = value as Record<string, ParamValue>;
	const {kind} = record;
	return isMaskKind(kind)
		? ({kind, ...validateParams(MASK_SPECS[kind], record)} as InstanceMask)
		: undefined;
}
