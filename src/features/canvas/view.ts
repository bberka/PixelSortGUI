import {MAX_ZOOM, MIN_ZOOM, type ViewState} from '../../storage/types.ts';

/**
 View math for the canvas stage (DESIGN.md sections 7 and 8.1, product.md F13).
 Pure functions over a viewport in CSS px and an image in source px, so the
 pan clamp and the zoom anchoring can be tested without a browser.
 */

// DESIGN.md section 8.1: minZoom = 0.1 * fitZoom, maxZoom = 32 (3200%).
export const MIN_ZOOM_TO_FIT_RATIO = 0.1;
// AC-F13.3: at least 64 CSS px of the image stays inside the viewport per edge.
export const PAN_MARGIN_PX = 64;
// DESIGN.md section 8.3: Arrow keys pan by 10% of the viewport width/height.
export const KEYBOARD_PAN_FRACTION = 0.1;
// DESIGN.md section 7: above 200% zoom, pixels are drawn without smoothing.
export const SMOOTHING_MAX_ZOOM = 2;
// AC-F13.2: the zoom menu offers Fit, 50%, 100%, 200% and 400%.
export const ZOOM_PRESETS: readonly number[] = [0.5, 1, 2, 4];

export type Size = {
	readonly width: number;
	readonly height: number;
};

export type Point = {
	readonly x: number;
	readonly y: number;
};

export type FitMode = ViewState['fitMode'];

export type CanvasView = {
	readonly zoom: number;
	readonly centerX: number;
	readonly centerY: number;
	readonly fitMode: FitMode;
};

export type Rect = {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
};

export function formatZoomPercent(zoom: number): string {
	return `${Math.round(zoom * 100)}%`;
}

/**
 Contain scale, capped at 1: a small photo opens at 100% rather than blown up
 and soft, because the full-resolution render only starts past 1.25x.
 */
export function fitZoom(source: Size, viewport: Size): number {
	if (
		source.width <= 0 ||
		source.height <= 0 ||
		viewport.width <= 0 ||
		viewport.height <= 0
	) {
		return 1;
	}

	return Math.min(
		1,
		viewport.width / source.width,
		viewport.height / source.height,
	);
}

export function minZoomFor(fit: number): number {
	return Math.max(MIN_ZOOM, MIN_ZOOM_TO_FIT_RATIO * fit);
}

export function clampZoom(zoom: number, fit: number): number {
	return Number.isFinite(zoom)
		? Math.min(MAX_ZOOM, Math.max(minZoomFor(fit), zoom))
		: minZoomFor(fit);
}

export function fitView(source: Size, viewport: Size): CanvasView {
	return {
		zoom: fitZoom(source, viewport),
		centerX: source.width / 2,
		centerY: source.height / 2,
		fitMode: 'fit',
	};
}

function clampAxis(
	center: number,
	sourceLength: number,
	viewportLength: number,
	zoom: number,
): number {
	const half = viewportLength / 2;
	if (!(half > PAN_MARGIN_PX) || !(zoom > 0)) {
		return sourceLength / 2;
	}

	const reach = (half - PAN_MARGIN_PX) / zoom;
	return Number.isFinite(center)
		? Math.min(sourceLength + reach, Math.max(-reach, center))
		: sourceLength / 2;
}

export function clampCenter(
	view: CanvasView,
	source: Size,
	viewport: Size,
): CanvasView {
	if (viewport.width <= 0 || viewport.height <= 0) {
		return view;
	}

	const centerX = clampAxis(
		view.centerX,
		source.width,
		viewport.width,
		view.zoom,
	);
	const centerY = clampAxis(
		view.centerY,
		source.height,
		viewport.height,
		view.zoom,
	);
	return centerX === view.centerX && centerY === view.centerY
		? view
		: {...view, centerX, centerY};
}

export function resolveView(
	state: ViewState,
	source: Size,
	viewport: Size,
): CanvasView {
	if (state.fitMode === 'fit') {
		return fitView(source, viewport);
	}

	return clampCenter(
		{
			zoom: clampZoom(state.zoom, fitZoom(source, viewport)),
			centerX: state.centerX,
			centerY: state.centerY,
			fitMode: 'custom',
		},
		source,
		viewport,
	);
}

export function imageRect(
	view: CanvasView,
	source: Size,
	viewport: Size,
): Rect {
	return {
		left: viewport.width / 2 - view.centerX * view.zoom,
		top: viewport.height / 2 - view.centerY * view.zoom,
		width: source.width * view.zoom,
		height: source.height * view.zoom,
	};
}

export function sourceAt(
	view: CanvasView,
	point: Point,
	viewport: Size,
): Point {
	return {
		x: view.centerX + (point.x - viewport.width / 2) / view.zoom,
		y: view.centerY + (point.y - viewport.height / 2) / view.zoom,
	};
}

export function centerForAnchor(
	anchorSource: Point,
	anchor: Point,
	zoom: number,
	viewport: Size,
): CanvasView {
	return {
		zoom,
		centerX: anchorSource.x - (anchor.x - viewport.width / 2) / zoom,
		centerY: anchorSource.y - (anchor.y - viewport.height / 2) / zoom,
		fitMode: 'custom',
	};
}

export function zoomAt(
	view: CanvasView,
	anchor: Point,
	zoom: number,
	source: Size,
	viewport: Size,
): CanvasView {
	const next = clampZoom(zoom, fitZoom(source, viewport));
	return clampCenter(
		centerForAnchor(sourceAt(view, anchor, viewport), anchor, next, viewport),
		source,
		viewport,
	);
}

export function zoomTo(
	view: CanvasView,
	zoom: number,
	source: Size,
	viewport: Size,
): CanvasView {
	return clampCenter(
		{
			...view,
			zoom: clampZoom(zoom, fitZoom(source, viewport)),
			fitMode: 'custom',
		},
		source,
		viewport,
	);
}

/**
`dx` and `dy` move the image in CSS px, as a pointer drag does.
*/
export function panBy(
	view: CanvasView,
	dx: number,
	dy: number,
	source: Size,
	viewport: Size,
): CanvasView {
	if (!(view.zoom > 0)) {
		return view;
	}

	return clampCenter(
		{
			...view,
			fitMode: 'custom',
			centerX: view.centerX - dx / view.zoom,
			centerY: view.centerY - dy / view.zoom,
		},
		source,
		viewport,
	);
}

export type PanKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export function panByKey(
	view: CanvasView,
	key: PanKey,
	source: Size,
	viewport: Size,
): CanvasView {
	const stepX = KEYBOARD_PAN_FRACTION * viewport.width;
	const stepY = KEYBOARD_PAN_FRACTION * viewport.height;
	switch (key) {
		case 'ArrowLeft': {
			return panBy(view, stepX, 0, source, viewport);
		}

		case 'ArrowRight': {
			return panBy(view, -stepX, 0, source, viewport);
		}

		case 'ArrowUp': {
			return panBy(view, 0, stepY, source, viewport);
		}

		case 'ArrowDown': {
			return panBy(view, 0, -stepY, source, viewport);
		}
	}
}
