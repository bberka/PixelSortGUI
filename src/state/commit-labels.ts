import {
	IDENTITY_TRANSFORM,
	transformKey,
	type SourceTransform,
} from '../engine/transform.ts';
import {
	canonicalJson,
	type BlendMode,
	type ParamSpec,
	type ParamValue,
} from '../engine/types.ts';
import {
	decimalsForStep,
	formatIntegerParam,
	formatNumberParam,
	type NumberSpec,
} from '../features/params/format.ts';
import type {MaskKind} from '../engine/mask/types.ts';
import type {MaskPatch} from './mask-edits.ts';

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

		case 'image': {
			return value === '' ? 'cleared' : 'chosen';
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

function formatMaskPercent(value: number): string {
	return `${Number((value * 100).toFixed(1))}%`;
}

const FIT_LABELS = {
	cover: 'Cover',
	contain: 'Contain',
	stretch: 'Stretch',
} as const;

const MASK_KIND_LABELS: Readonly<Record<MaskKind, string>> = {
	paint: 'Paint',
	luma: 'Brightness',
	image: 'Image',
};

// Adding, replacing or removing a mask (persistence.md section 8.2).
export function formatMaskKindCommitLabel(
	before: MaskKind | undefined,
	after: MaskKind | null,
): string {
	if (after === null) {
		return 'Remove mask';
	}

	const name = MASK_KIND_LABELS[after];
	return before === undefined
		? `Add ${name.toLowerCase()} mask`
		: `Mask type ${name}`;
}

// A mask setting, named for the first field the patch holds.
export function formatMaskCommitLabel(patch: MaskPatch): string {
	if (patch.invert !== undefined) {
		return `Invert mask ${patch.invert ? 'on' : 'off'}`;
	}

	if (patch.feather !== undefined) {
		return `Mask feather ${patch.feather} px`;
	}

	if (patch.range !== undefined) {
		const [low, high] = patch.range;
		return `Mask range ${formatMaskPercent(low)} to ${formatMaskPercent(high)}`;
	}

	if (patch.softness !== undefined) {
		return `Mask softness ${formatMaskPercent(patch.softness)}`;
	}

	if (patch.source !== undefined) {
		return `Mask image ${patch.source === '' ? 'cleared' : 'chosen'}`;
	}

	return patch.fit === undefined ? 'Mask' : `Mask fit ${FIT_LABELS[patch.fit]}`;
}

export function formatBlendCommitLabel(blend: BlendMode): string {
	return `Blend ${blend.charAt(0).toUpperCase()}${blend.slice(1)}`;
}

// The orientation as a screen matrix `[a, b, c, d]`: clockwise rotation, then
// the flips (engine.md section 16.3).
function orientationMatrix({rotation, flipX, flipY}: SourceTransform) {
	const [cos, sin] = {0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1]}[
		rotation
	];
	const x = flipX ? -1 : 1;
	const y = flipY ? -1 : 1;
	return [x * cos, x * -sin, y * sin, y * cos];
}

// Keyed by the matrix of the step seen on screen.
const ORIENTATION_LABELS: Readonly<Record<string, string>> = {
	'0,-1,1,0': 'Rotate 90° CW',
	'0,1,-1,0': 'Rotate 90° CCW',
	'-1,0,0,-1': 'Rotate 180°',
	'-1,0,0,1': 'Flip horizontal',
	'1,0,0,-1': 'Flip vertical',
};

// `after * transpose(before)`, the step from one orientation to the other.
function orientationStep(
	before: SourceTransform,
	after: SourceTransform,
): string {
	const [a, b, c, d] = orientationMatrix(after);
	const [e, f, g, h] = orientationMatrix(before);
	return [a * e + b * f, a * g + b * h, c * e + d * f, c * g + d * h].join(',');
}

// The history label of a geometry commit (persistence.md section 8.2).
export function formatTransformCommitLabel(
	before: SourceTransform,
	after: SourceTransform,
): string {
	const step = orientationStep(before, after);
	const turned = step !== '1,0,0,1';
	const undone = [turned, before.crop, before.resize].filter(Boolean).length;
	if (undone > 1 && transformKey(after) === transformKey(IDENTITY_TRANSFORM)) {
		return 'Reset transform';
	}

	if (turned) {
		return ORIENTATION_LABELS[step] ?? 'Transform';
	}

	if (canonicalJson(before.crop) !== canonicalJson(after.crop)) {
		return after.crop
			? `Crop ${after.crop.width} × ${after.crop.height}`
			: 'Reset crop';
	}

	if (canonicalJson(before.resize) !== canonicalJson(after.resize)) {
		return after.resize
			? `Resize ${after.resize.width} × ${after.resize.height}`
			: 'Reset resize';
	}

	return 'Transform';
}
