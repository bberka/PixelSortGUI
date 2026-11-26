import {roundHalfAway} from '../../engine/math.ts';
import {
	isResizeWithinLimits,
	percentSize,
	type ResizeSpec,
	type Size,
} from '../../engine/transform.ts';

export type ResizeUnit = 'px' | 'percent';
export type ResizeAxis = keyof Size;

// The text of the two size fields, in the chosen unit.
export type SizeFields = Readonly<Record<ResizeAxis, string>>;

export const LIMIT_MESSAGE =
	'Maximum output size is 50 MP (50,000,000 px) and 16,384 px per side.';
export const PIXELS_MESSAGE = 'Enter whole numbers of at least 1.';
export const PERCENT_MESSAGE = 'Enter a percentage from 1 to 1000.';
export const MIN_PERCENT = 1;
export const MAX_PERCENT = 1000;

const OTHER_AXIS: Readonly<Record<ResizeAxis, ResizeAxis>> = {
	width: 'height',
	height: 'width',
};

function parsePixels(text: string): number | null {
	// Thousands separators are accepted: "20,000" and "20 000".
	const digits = text.replaceAll(/[\s,]/g, '');
	if (!/^\d+$/.test(digits)) {
		return null;
	}

	const value = Number(digits);
	return value >= 1 ? value : null;
}

function parsePercent(text: string): number | null {
	const trimmed = text.trim().replace(/%$/, '').trim();
	if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
		return null;
	}

	const value = Number(trimmed);
	return value >= MIN_PERCENT && value <= MAX_PERCENT ? value : null;
}

function percentText(side: number, of: number): string {
	return String(roundHalfAway((side * 10_000) / of) / 100);
}

// The fields for the saved resize, or for the cropped size without one.
export function sizeFields(
	cropped: Size,
	resize: ResizeSpec | null,
	unit: ResizeUnit,
): SizeFields {
	const size = resize ?? cropped;
	return unit === 'px'
		? {width: String(size.width), height: String(size.height)}
		: {
				width: percentText(size.width, cropped.width),
				height: percentText(size.height, cropped.height),
			};
}

/**
 The fields after typing in one of them. A locked pair follows it: the same
 percentage, or the pixel side that keeps the cropped image's proportions.
 */
export function editSize(
	fields: SizeFields,
	axis: ResizeAxis,
	text: string,
	{
		unit,
		locked,
		cropped,
	}: {
		readonly unit: ResizeUnit;
		readonly locked: boolean;
		readonly cropped: Size;
	},
): SizeFields {
	const next = {...fields, [axis]: text};
	if (!locked) {
		return next;
	}

	const other = OTHER_AXIS[axis];
	if (unit === 'percent') {
		return {...next, [other]: text};
	}

	const side = parsePixels(text);
	if (side === null) {
		return next;
	}

	const paired = Math.max(
		1,
		roundHalfAway((side * cropped[other]) / cropped[axis]),
	);
	return {...next, [other]: String(paired)};
}

export type ResizeTarget =
	| {readonly output: Size; readonly invalid?: undefined}
	| {
			readonly output?: undefined;
			readonly error: string;
			// The fields the error is about.
			readonly invalid: readonly ResizeAxis[];
	  };

/**
 The output size the fields ask for, or why it cannot be used. Fields that
 still show the saved resize unedited give it back exactly: a percentage is
 rounded for display and would otherwise move the size or fall out of range.
 */
export function resizeTarget(
	fields: SizeFields,
	unit: ResizeUnit,
	cropped: Size,
	saved: ResizeSpec | null = null,
): ResizeTarget {
	if (saved) {
		const shown = sizeFields(cropped, saved, unit);
		if (shown.width === fields.width && shown.height === fields.height) {
			return {output: {width: saved.width, height: saved.height}};
		}
	}

	const parse = unit === 'px' ? parsePixels : parsePercent;
	const width = parse(fields.width);
	const height = parse(fields.height);
	if (width === null || height === null) {
		const invalid: ResizeAxis[] = [];
		if (width === null) {
			invalid.push('width');
		}

		if (height === null) {
			invalid.push('height');
		}

		return {
			error: unit === 'px' ? PIXELS_MESSAGE : PERCENT_MESSAGE,
			invalid,
		};
	}

	const size =
		unit === 'px'
			? {width, height}
			: {
					width: percentSize(cropped, width).width,
					height: percentSize(cropped, height).height,
				};
	return isResizeWithinLimits(cropped, size)
		? {output: size}
		: {error: LIMIT_MESSAGE, invalid: ['width', 'height']};
}

// The same size in the other unit; unusable text gives way to the saved size.
export function convertSize(
	fields: SizeFields,
	from: ResizeUnit,
	to: ResizeUnit,
	cropped: Size,
	resize: ResizeSpec | null,
): SizeFields {
	const {output} = resizeTarget(fields, from, cropped, resize);
	const kept: ResizeSpec | null = output
		? {...output, filter: 'lanczos3'}
		: resize;
	return sizeFields(cropped, kept, to);
}
