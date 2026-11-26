import {roundHalfAway} from '../engine/math.ts';
import {
	effectiveDimensions,
	orientedDimensions,
	transformKey,
	type CropRect,
	type Size,
	type SourceTransform,
} from '../engine/transform.ts';

// How the workers decode a source under a geometry transform (engine.md section 16.3).

export function isIdentity(transform: SourceTransform): boolean {
	return transformKey(transform) === transformKey();
}

// The effective size, or why the transform does not fit the source.
export function checkedDimensions(
	sourceWidth: number,
	sourceHeight: number,
	transform: SourceTransform,
): {size: Size} | {error: string} {
	try {
		return {
			size: effectiveDimensions(sourceWidth, sourceHeight, transform),
		};
	} catch (error) {
		return {error: error instanceof Error ? error.message : String(error)};
	}
}

// One crop edge pair moved onto a decoded axis, at least 1 px inside it.
function scaleSpan(
	start: number,
	length: number,
	side: number,
	decodedSide: number,
): {start: number; length: number} {
	const edge = (value: number) => roundHalfAway((value * decodedSide) / side);
	const first = Math.min(edge(start), decodedSide - 1);
	return {start: first, length: Math.max(1, edge(start + length) - first)};
}

export type ProxyPlan = {
	// Size to decode the source at.
	decode: Size;
	// Turns an image of that size into one of the target size.
	transform: SourceTransform;
};

/**
 The smallest decode that still fills a proxy of `target` size, and the
 transform moved onto it. `target` is a downscale of the effective size, and
 `transform` must fit the source.
 */
export function planProxy(
	sourceWidth: number,
	sourceHeight: number,
	transform: SourceTransform,
	target: Size,
): ProxyPlan {
	const {rotation, crop, resize} = transform;
	if (crop === null && resize === null) {
		// Orientation maps pixels one to one, so exchanging the sides inverts it.
		return {
			decode: orientedDimensions(target.width, target.height, rotation),
			transform,
		};
	}

	const oriented = orientedDimensions(sourceWidth, sourceHeight, rotation);
	const cropped = crop ?? oriented;
	const k = Math.min(
		1,
		Math.max(target.width / cropped.width, target.height / cropped.height),
	);
	const decode =
		k === 1
			? {width: sourceWidth, height: sourceHeight}
			: {
					width: Math.min(sourceWidth, Math.ceil(sourceWidth * k)),
					height: Math.min(sourceHeight, Math.ceil(sourceHeight * k)),
				};
	const decoded = orientedDimensions(decode.width, decode.height, rotation);

	let scaled: CropRect | null = null;
	if (crop) {
		const x = scaleSpan(crop.x, crop.width, oriented.width, decoded.width);
		const y = scaleSpan(crop.y, crop.height, oriented.height, decoded.height);
		scaled = {x: x.start, y: y.start, width: x.length, height: y.length};
	}

	return {
		decode,
		transform: {
			...transform,
			crop: scaled,
			resize: {
				width: target.width,
				height: target.height,
				filter: resize?.filter ?? 'lanczos3',
			},
		},
	};
}

// The transform the export applies to the full decode: one resample, straight to `size`.
export function exportTransform(
	transform: SourceTransform,
	size: Size,
): SourceTransform {
	return {
		...transform,
		resize: {
			width: size.width,
			height: size.height,
			filter: transform.resize?.filter ?? 'lanczos3',
		},
	};
}
