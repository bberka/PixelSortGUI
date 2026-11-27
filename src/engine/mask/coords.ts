// The painted mask grid and the mapping between it and the effective image
// (engine.md section 16.6).

import {clamp, roundHalfAway} from '../math.ts';
import {
	effectiveDimensions,
	orientedDimensions,
	type CropRect,
	type Size,
} from '../transform.ts';
import type {BrushSample, MaskGeometry} from './brush-types.ts';

export const MASK_PIXEL_CAP = 4_194_304;
const MIN_SAMPLE_RADIUS = 8;

// Continuous coordinates: pixel `i` covers `[i, i + 1)`.
export type Point = {readonly x: number; readonly y: number};

// The size `renderSizeForPixelCap` of `codec/decode.ts` gives at the mask cap.
export function maskGridSize(sourceWidth: number, sourceHeight: number): Size {
	const scale = Math.min(
		1,
		Math.sqrt(MASK_PIXEL_CAP / (sourceWidth * sourceHeight)),
	);
	return {
		width: Math.max(1, Math.floor(sourceWidth * scale)),
		height: Math.max(1, Math.floor(sourceHeight * scale)),
	};
}

type Frame = {
	grid: Size;
	oriented: Size;
	crop: CropRect;
	effective: Size;
	// Rotation by 90 or 270 degrees.
	swapped: boolean;
};

// Throws `RangeError` for a transform that `effectiveDimensions` rejects.
function frame({sourceWidth, sourceHeight, transform}: MaskGeometry): Frame {
	const effective = effectiveDimensions(sourceWidth, sourceHeight, transform);
	const oriented = orientedDimensions(
		sourceWidth,
		sourceHeight,
		transform.rotation,
	);
	return {
		grid: maskGridSize(sourceWidth, sourceHeight),
		oriented,
		crop: transform.crop ?? {x: 0, y: 0, ...oriented},
		effective,
		swapped: transform.rotation === 90 || transform.rotation === 270,
	};
}

// A point of the effective image on the mask grid. Points outside stay outside.
export function effectiveToMask(geometry: MaskGeometry, point: Point): Point {
	const {grid, oriented, crop, effective} = frame(geometry);
	const {sourceWidth, sourceHeight, transform} = geometry;
	let u = crop.x + (point.x * crop.width) / effective.width;
	let v = crop.y + (point.y * crop.height) / effective.height;
	if (transform.flipX) {
		u = oriented.width - u;
	}

	if (transform.flipY) {
		v = oriented.height - v;
	}

	let x = u;
	let y = v;
	switch (transform.rotation) {
		case 0: {
			break;
		}

		case 90: {
			x = v;
			y = sourceHeight - u;
			break;
		}

		case 180: {
			x = sourceWidth - u;
			y = sourceHeight - v;
			break;
		}

		case 270: {
			x = sourceWidth - v;
			y = u;
			break;
		}
	}

	return {
		x: (x * grid.width) / sourceWidth,
		y: (y * grid.height) / sourceHeight,
	};
}

// The inverse of `effectiveToMask`.
export function maskToEffective(geometry: MaskGeometry, point: Point): Point {
	const {grid, oriented, crop, effective} = frame(geometry);
	const {sourceWidth, sourceHeight, transform} = geometry;
	const x = (point.x * sourceWidth) / grid.width;
	const y = (point.y * sourceHeight) / grid.height;
	let u = x;
	let v = y;
	switch (transform.rotation) {
		case 0: {
			break;
		}

		case 90: {
			u = sourceHeight - y;
			v = x;
			break;
		}

		case 180: {
			u = sourceWidth - x;
			v = sourceHeight - y;
			break;
		}

		case 270: {
			u = y;
			v = sourceWidth - x;
			break;
		}
	}

	if (transform.flipX) {
		u = oriented.width - u;
	}

	if (transform.flipY) {
		v = oriented.height - v;
	}

	return {
		x: ((u - crop.x) * effective.width) / crop.width,
		y: ((v - crop.y) * effective.height) / crop.height,
	};
}

export function pressureFactor(
	pointerType: string,
	pressure: number,
	pressureSetsSize: boolean,
): number {
	return pointerType === 'pen' && pressureSetsSize
		? 0.2 + 0.8 * clamp(pressure, 0, 1)
		: 1;
}

// `roundHalfAway(16 * v)`, never `-0`.
function sixteenths(v: number): number {
	return roundHalfAway(16 * v) + 0;
}

/**
 The sample for a pointer at `point` with a brush `size` px across, both in
 effective-image pixels. An unlocked resize gives an elliptical dab.
 */
export function brushSample(
	geometry: MaskGeometry,
	point: Point,
	size: number,
	factor = 1,
): BrushSample {
	const {grid, crop, effective, swapped} = frame(geometry);
	const radius = (size / 2) * factor;
	// The radius along each effective axis, in oriented source pixels.
	const across = (radius * crop.width) / effective.width;
	const down = (radius * crop.height) / effective.height;
	const rx = ((swapped ? down : across) * grid.width) / geometry.sourceWidth;
	const ry = ((swapped ? across : down) * grid.height) / geometry.sourceHeight;
	const centre = effectiveToMask(geometry, point);
	return {
		x: sixteenths(centre.x),
		y: sixteenths(centre.y),
		rx: Math.max(MIN_SAMPLE_RADIUS, sixteenths(rx)),
		ry: Math.max(MIN_SAMPLE_RADIUS, sixteenths(ry)),
	};
}
