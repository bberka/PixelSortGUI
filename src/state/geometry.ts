import {
	IDENTITY_TRANSFORM,
	orientedDimensions,
	transformKey,
	type CropRect,
	type Size,
	type SourceTransform,
} from '../engine/transform.ts';
import type {ProjectRecord} from '../storage/types.ts';

// The unsaved state of the Geometry panel and crop mode (DESIGN.md section 7.2).

export const ASPECT_IDS = [
	'free',
	'original',
	'1:1',
	'4:3',
	'3:4',
	'3:2',
	'2:3',
	'16:9',
	'9:16',
	'4:5',
] as const;

export type AspectId = (typeof ASPECT_IDS)[number];

export type CropDraft = {
	// The saved geometry the box was drawn over; a different one drops the box.
	key: string;
	crop: CropRect;
};

export type GeometryState = {
	open: boolean;
	cropping: boolean;
	aspect: AspectId;
	draft: CropDraft | null;
	// A pointer is moving the box or one of its handles.
	dragging: boolean;
};

export const CLOSED_GEOMETRY: GeometryState = Object.freeze({
	open: false,
	cropping: false,
	aspect: 'free',
	draft: null,
	dragging: false,
});

export function projectTransform(project: ProjectRecord): SourceTransform {
	return project.transform ?? IDENTITY_TRANSFORM;
}

// The size of the rotated and flipped source, which crop boxes are measured in.
export function projectOrientedDimensions(project: ProjectRecord): Size {
	return orientedDimensions(
		project.sourceWidth,
		project.sourceHeight,
		projectTransform(project).rotation,
	);
}

export function cropDraftKey(
	projectId: string,
	transform: SourceTransform,
): string {
	return `${projectId}:${transformKey(transform)}`;
}

// The saved crop, with the whole image for none.
export function savedCrop(project: ProjectRecord): CropRect {
	return (
		projectTransform(project).crop ?? {
			x: 0,
			y: 0,
			...projectOrientedDimensions(project),
		}
	);
}

// The box shown while cropping: the unsaved one while it still applies.
export function draftCrop(
	project: ProjectRecord,
	draft: CropDraft | null,
): CropRect {
	return draft?.key === cropDraftKey(project.id, projectTransform(project))
		? draft.crop
		: savedCrop(project);
}

export function sameCrop(a: CropRect, b: CropRect): boolean {
	return (
		a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
	);
}
