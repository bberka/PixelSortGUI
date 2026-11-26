import {effectiveDimensions, type Size} from '../engine/transform.ts';
import type {ProjectRecord, SourceRecord} from '../storage/types.ts';
import type {RenderSource} from './coordinator.ts';

export function renderSourceFor(
	project: ProjectRecord,
	source: SourceRecord,
): RenderSource {
	return {
		key: source.sha256,
		blob: source.blob,
		width: source.width,
		height: source.height,
		transform: project.transform,
	};
}

// The size of the image the editor shows and exports (engine.md section 16.3).
export function projectDimensions(project: ProjectRecord): Size {
	const {sourceWidth, sourceHeight, transform} = project;
	return transform
		? effectiveDimensions(sourceWidth, sourceHeight, transform)
		: {width: sourceWidth, height: sourceHeight};
}
