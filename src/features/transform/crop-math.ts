import {clamp, roundHalfAway} from '../../engine/math.ts';
import {
	dragCrop,
	initialCrop,
	orientedDimensions,
	type AspectRatio,
	type CropRect,
	type Size,
	type SourceTransform,
} from '../../engine/transform.ts';
import {sameCrop, type AspectId} from '../../state/geometry.ts';

export type Orientation = 'cw' | 'ccw' | 'flipH' | 'flipV';

export const CROP_HANDLES = [
	'nw',
	'n',
	'ne',
	'e',
	'se',
	's',
	'sw',
	'w',
] as const;

export type CropHandle = (typeof CROP_HANDLES)[number];

export const ASPECT_LABELS: Readonly<Record<AspectId, string>> = {
	free: 'Free',
	original: 'Original',
	'1:1': '1:1',
	'4:3': '4:3',
	'3:4': '3:4',
	'3:2': '3:2',
	'2:3': '2:3',
	'16:9': '16:9',
	'9:16': '9:16',
	'4:5': '4:5',
};

// The locked ratio of a choice; `null` for a free box.
export function aspectRatio(id: AspectId, bounds: Size): AspectRatio | null {
	if (id === 'free') {
		return null;
	}

	if (id === 'original') {
		return {a: bounds.width, b: bounds.height};
	}

	const [a, b] = id.split(':').map(Number);
	return {a, b};
}

const TURNED_ASPECTS: Readonly<Record<AspectId, AspectId>> = {
	free: 'free',
	original: 'original',
	'1:1': '1:1',
	'4:3': '3:4',
	'3:4': '4:3',
	'3:2': '2:3',
	'2:3': '3:2',
	'16:9': '9:16',
	'9:16': '16:9',
	'4:5': 'free',
};

export function turnAspect(id: AspectId, step: Orientation): AspectId {
	return step === 'cw' || step === 'ccw' ? TURNED_ASPECTS[id] : id;
}

// The box after the image of size `bounds` is turned or mirrored on screen.
export function turnCrop(
	{x, y, width, height}: CropRect,
	bounds: Size,
	step: Orientation,
): CropRect {
	switch (step) {
		case 'cw': {
			return {
				x: bounds.height - y - height,
				y: x,
				width: height,
				height: width,
			};
		}

		case 'ccw': {
			return {x: y, y: bounds.width - x - width, width: height, height: width};
		}

		case 'flipH': {
			return {x: bounds.width - x - width, y, width, height};
		}

		case 'flipV': {
			return {x, y: bounds.height - y - height, width, height};
		}
	}
}

/**
 The geometry after one rotate or flip of the image as it is seen. The stored
 order is rotation then flips, so a quarter turn exchanges the two flips.
 */
export function orientTransform(
	source: Size,
	transform: SourceTransform,
	step: Orientation,
): SourceTransform {
	const {rotation, flipX, flipY, crop, resize} = transform;
	const bounds = orientedDimensions(source.width, source.height, rotation);
	const turnedCrop = crop && turnCrop(crop, bounds, step);
	if (step === 'flipH' || step === 'flipV') {
		return {
			rotation,
			flipX: step === 'flipH' ? !flipX : flipX,
			flipY: step === 'flipV' ? !flipY : flipY,
			crop: turnedCrop,
			resize,
		};
	}

	return {
		rotation: ((rotation + (step === 'cw' ? 90 : 270)) %
			360) as SourceTransform['rotation'],
		flipX: flipY,
		flipY: flipX,
		crop: turnedCrop,
		resize: resize && {
			...resize,
			width: resize.height,
			height: resize.width,
		},
	};
}

/**
 The geometry that saves `crop` over an image of size `bounds`. A box over the
 whole image is no crop, and a box of a new size drops the resize.
 */
export function cropTransform(
	transform: SourceTransform,
	crop: CropRect,
	bounds: Size,
): SourceTransform {
	const whole = {x: 0, y: 0, ...bounds};
	const before = transform.crop ?? whole;
	const resized = crop.width !== before.width || crop.height !== before.height;
	return {
		...transform,
		crop: sameCrop(crop, whole) ? null : crop,
		resize: resized ? null : transform.resize,
	};
}

// The box a ratio choice starts with.
export function boxForAspect(
	id: AspectId,
	current: CropRect,
	bounds: Size,
): CropRect {
	const ratio = aspectRatio(id, bounds);
	return ratio ? initialCrop(bounds, ratio) : current;
}

export function moveCrop(
	start: CropRect,
	dx: number,
	dy: number,
	bounds: Size,
): CropRect {
	return {
		...start,
		x: clamp(roundHalfAway(start.x + dx), 0, bounds.width - start.width),
		y: clamp(roundHalfAway(start.y + dy), 0, bounds.height - start.height),
	};
}

// One axis of a free resize: `side` is -1 for the low edge, 1 for the high one.
function moveEdge(
	start: number,
	length: number,
	limit: number,
	side: number,
	delta: number,
): [start: number, length: number] {
	if (side === 0) {
		return [start, length];
	}

	const end = start + length;
	if (side < 0) {
		const low = clamp(roundHalfAway(start + delta), 0, end - 1);
		return [low, end - low];
	}

	return [start, clamp(roundHalfAway(end + delta), start + 1, limit) - start];
}

/**
 The box after `handle` of `start` moves by `(dx, dy)` image pixels. With a
 locked ratio a corner follows the axis that moved further, measured in the
 ratio's own proportions.
 */
export function resizeCrop(
	start: CropRect,
	handle: CropHandle,
	{dx, dy}: {readonly dx: number; readonly dy: number},
	ratio: AspectRatio | null,
	bounds: Size,
): CropRect {
	const sideX = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
	const sideY = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
	// A movement along the axis an edge handle does not own changes nothing.
	if ((sideX === 0 || dx === 0) && (sideY === 0 || dy === 0)) {
		return start;
	}

	if (!ratio) {
		const [x, width] = moveEdge(start.x, start.width, bounds.width, sideX, dx);
		const [y, height] = moveEdge(
			start.y,
			start.height,
			bounds.height,
			sideY,
			dy,
		);
		return {x, y, width, height};
	}

	const width = start.width + sideX * dx;
	const height = start.height + sideY * dy;
	if (handle === 'n' || handle === 's') {
		return dragCrop(start, {handle, length: height}, ratio, bounds);
	}

	if (handle === 'e' || handle === 'w') {
		return dragCrop(start, {handle, length: width}, ratio, bounds);
	}

	const axis =
		Math.abs(dx) * ratio.b >= Math.abs(dy) * ratio.a ? 'width' : 'height';
	return dragCrop(
		start,
		{handle, axis, length: axis === 'width' ? width : height},
		ratio,
		bounds,
	);
}

export const NUDGE_STEP = 1;
export const NUDGE_SHIFT_STEP = 10;

// The movement an arrow key stands for, or `null` for any other key.
export function arrowDelta(
	key: string,
	shiftKey: boolean,
): {dx: number; dy: number} | null {
	const step = shiftKey ? NUDGE_SHIFT_STEP : NUDGE_STEP;
	switch (key) {
		case 'ArrowLeft': {
			return {dx: -step, dy: 0};
		}

		case 'ArrowRight': {
			return {dx: step, dy: 0};
		}

		case 'ArrowUp': {
			return {dx: 0, dy: -step};
		}

		case 'ArrowDown': {
			return {dx: 0, dy: step};
		}

		default: {
			return null;
		}
	}
}
