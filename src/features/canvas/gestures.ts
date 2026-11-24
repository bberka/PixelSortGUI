import {
	clampCenter,
	clampZoom,
	fitZoom,
	sourceAt,
	zoomAt,
	zoomTo,
	fitView,
	panBy,
	panByKey,
	type CanvasView,
	type Point,
	type Size,
} from './view.ts';

/**
 Two-finger pinch in progress: the zoom and the source point under the midpoint
 when it started. Moving the fingers then scales and pans from that anchor.
 */
export type Pinch = {
	readonly startZoom: number;
	readonly anchorSource: Point;
	readonly startDistance: number;
};

/**
A tap stays within this distance, in CSS px, or it counts as a drag.
*/
export const TAP_SLOP_PX = 12;
/**
Two taps closer together than this, in ms, toggle fit and 100%.
*/
export const TAP_TIMEOUT_MS = 300;

export function beginPinch(
	view: CanvasView,
	points: readonly Point[],
	viewport: Size,
): Pinch | null {
	const [first, second] = points;
	if (!first || !second) {
		return null;
	}

	const midpoint = {
		x: (first.x + second.x) / 2,
		y: (first.y + second.y) / 2,
	};
	return {
		startZoom: view.zoom,
		anchorSource: sourceAt(view, midpoint, viewport),
		startDistance: Math.hypot(second.x - first.x, second.y - first.y),
	};
}

export function pinchView(
	pinch: Pinch,
	points: readonly Point[],
	source: Size,
	viewport: Size,
): CanvasView | null {
	const [first, second] = points;
	if (!first || !second) {
		return null;
	}

	const distance = Math.hypot(second.x - first.x, second.y - first.y);
	if (!(pinch.startDistance > 0) || !(distance > 0)) {
		return null;
	}

	const zoom = clampZoom(
		(pinch.startZoom * distance) / pinch.startDistance,
		fitZoom(source, viewport),
	);
	const midpoint = {
		x: (first.x + second.x) / 2,
		y: (first.y + second.y) / 2,
	};
	return clampCenter(
		{
			zoom,
			centerX: pinch.anchorSource.x - (midpoint.x - viewport.width / 2) / zoom,
			centerY: pinch.anchorSource.y - (midpoint.y - viewport.height / 2) / zoom,
			fitMode: 'custom',
		},
		source,
		viewport,
	);
}

/**
The next view for one wheel event: anchored zoom with ctrl or meta, pan otherwise.
*/
export function wheelView(
	view: CanvasView,
	event: {deltaX: number; deltaY: number; ctrlKey: boolean; shiftKey: boolean},
	anchor: Point,
	source: Size,
	viewport: Size,
	zoomRate: number,
): CanvasView {
	if (event.ctrlKey) {
		const zoom = clampZoom(
			view.zoom * Math.exp(-event.deltaY * zoomRate),
			fitZoom(source, viewport),
		);
		return zoomAt(view, anchor, zoom, source, viewport);
	}

	const shiftSwaps = event.shiftKey && event.deltaX === 0;
	const horizontal = shiftSwaps ? event.deltaY : event.deltaX;
	const vertical = shiftSwaps ? 0 : event.deltaY;
	return panBy(view, -horizontal, -vertical, source, viewport);
}

/**
Keys that change the view from anywhere outside a text field.
*/
export type ViewCommand = 'zoomIn' | 'zoomOut' | 'fit' | 'actual';

const VIEW_COMMANDS: Readonly<Record<string, ViewCommand>> = {
	'+': 'zoomIn',
	'=': 'zoomIn',
	'-': 'zoomOut',
	_: 'zoomOut',
	'0': 'fit',
	'1': 'actual',
};

export function viewCommandFor(key: string): ViewCommand | null {
	return VIEW_COMMANDS[key] ?? null;
}

export function commandView(
	command: ViewCommand,
	view: CanvasView,
	source: Size,
	viewport: Size,
): CanvasView {
	switch (command) {
		case 'zoomIn': {
			return zoomTo(view, view.zoom * 2, source, viewport);
		}

		case 'zoomOut': {
			return zoomTo(view, view.zoom / 2, source, viewport);
		}

		case 'fit': {
			return fitView(source, viewport);
		}

		case 'actual': {
			return zoomTo(view, 1, source, viewport);
		}

		default: {
			return view;
		}
	}
}

export function arrowPan(
	key: string,
	view: CanvasView,
	source: Size,
	viewport: Size,
): CanvasView | null {
	if (
		key !== 'ArrowLeft' &&
		key !== 'ArrowRight' &&
		key !== 'ArrowUp' &&
		key !== 'ArrowDown'
	) {
		return null;
	}

	return panByKey(view, key, source, viewport);
}

/**
True when a release is close enough to its press to count as a tap.
*/
export function isTap(position: Point, start: Point | null): boolean {
	return (
		start !== null &&
		Math.hypot(position.x - start.x, position.y - start.y) <= TAP_SLOP_PX
	);
}

/**
True when this tap repeats the previous one quickly and in place.
*/
export function isDoubleTap(
	last: {readonly time: number; readonly position: Point} | null,
	position: Point,
	now: number,
): boolean {
	return (
		last !== null &&
		now - last.time <= TAP_TIMEOUT_MS &&
		Math.hypot(position.x - last.position.x, position.y - last.position.y) <=
			TAP_SLOP_PX
	);
}
