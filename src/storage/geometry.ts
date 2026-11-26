import {
	IDENTITY_TRANSFORM,
	effectiveDimensions,
	type SourceTransform,
} from '../engine/transform.ts';
import {StorageValidationError, type ProjectRecord} from './types.ts';

export type StoredGeometry = {
	transform: SourceTransform;
	effectiveWidth: number;
	effectiveHeight: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

// A copy holding only the known fields, or `null` when the value is not a
// transform that fits a source of this size.
function parseTransform(
	sourceWidth: number,
	sourceHeight: number,
	value: unknown,
): StoredGeometry | null {
	if (!isObject(value)) {
		return null;
	}

	const {rotation, flipX, flipY, crop, resize} = value;
	if (
		typeof flipX !== 'boolean' ||
		typeof flipY !== 'boolean' ||
		(crop !== null && !isObject(crop)) ||
		(resize !== null && !isObject(resize))
	) {
		return null;
	}

	const transform = {
		rotation,
		flipX,
		flipY,
		crop: crop && {
			x: crop.x,
			y: crop.y,
			width: crop.width,
			height: crop.height,
		},
		resize: resize && {
			width: resize.width,
			height: resize.height,
			filter: resize.filter,
		},
	} as SourceTransform;
	try {
		const size = effectiveDimensions(sourceWidth, sourceHeight, transform);
		return {
			transform,
			effectiveWidth: size.width,
			effectiveHeight: size.height,
		};
	} catch (error) {
		if (error instanceof RangeError) {
			return null;
		}

		throw error;
	}
}

function identityGeometry(
	sourceWidth: number,
	sourceHeight: number,
): StoredGeometry {
	return {
		transform: IDENTITY_TRANSFORM,
		effectiveWidth: sourceWidth,
		effectiveHeight: sourceHeight,
	};
}

/**
 The geometry of a stored transform (persistence.md section 8.1). Never throws:
 an invalid one becomes the identity and sets `repaired`.
 */
export function resolveStoredGeometry(
	sourceWidth: number,
	sourceHeight: number,
	stored: unknown,
): StoredGeometry & {repaired: boolean} {
	const parsed =
		stored === undefined
			? null
			: parseTransform(sourceWidth, sourceHeight, stored);
	return {
		...(parsed ?? identityGeometry(sourceWidth, sourceHeight)),
		repaired: stored !== undefined && parsed === null,
	};
}

// The geometry to write for a transform a caller chose.
export function geometryForWrite(
	sourceWidth: number,
	sourceHeight: number,
	transform: SourceTransform,
): StoredGeometry {
	const parsed = parseTransform(sourceWidth, sourceHeight, transform);
	if (!parsed) {
		throw new StorageValidationError(
			`Invalid transform for a ${sourceWidth} × ${sourceHeight} image`,
		);
	}

	return parsed;
}

// The geometry a commit writes: the chosen transform, or else the stored one.
export function commitGeometry(
	project: ProjectRecord,
	transform: SourceTransform | undefined,
): StoredGeometry {
	const {sourceWidth, sourceHeight} = project;
	if (transform !== undefined) {
		return geometryForWrite(sourceWidth, sourceHeight, transform);
	}

	const {repaired, ...stored} = resolveStoredGeometry(
		sourceWidth,
		sourceHeight,
		project.transform,
	);
	return stored;
}

// `project` with a valid transform and an effective size that matches it.
export function repairProjectGeometry(project: ProjectRecord): ProjectRecord {
	const {repaired, ...geometry} = resolveStoredGeometry(
		project.sourceWidth,
		project.sourceHeight,
		project.transform,
	);
	return !repaired &&
		project.transform !== undefined &&
		project.effectiveWidth === geometry.effectiveWidth &&
		project.effectiveHeight === geometry.effectiveHeight
		? project
		: {...project, ...geometry};
}
