import {describe, expect, it} from 'vite-plus/test';
import type {ViewState} from '../../storage/types.ts';
import {
	PAN_MARGIN_PX,
	ZOOM_PRESETS,
	clampCenter,
	clampZoom,
	fitView,
	fitZoom,
	formatZoomPercent,
	imageRect,
	minZoomFor,
	panBy,
	panByKey,
	resolveView,
	sourceAt,
	zoomAt,
	zoomTo,
	type CanvasView,
	type Rect,
	type Size,
} from './view.ts';

const SOURCE = {width: 4000, height: 3000};
const VIEWPORT = {width: 1000, height: 700};
const SMALL_SOURCE = {width: 400, height: 300};

function customView(
	zoom: number,
	centerX: number,
	centerY: number,
): CanvasView {
	return {zoom, centerX, centerY, fitMode: 'custom'};
}

function viewState(patch: Partial<ViewState>): ViewState {
	return {
		fitMode: 'custom',
		zoom: 1,
		centerX: 200,
		centerY: 150,
		splitPosition: 0.5,
		...patch,
	};
}

function overlap(rect: Rect, viewport: Size): Size {
	return {
		width:
			Math.min(rect.left + rect.width, viewport.width) - Math.max(rect.left, 0),
		height:
			Math.min(rect.top + rect.height, viewport.height) - Math.max(rect.top, 0),
	};
}

describe('canvas view: zoom bounds', () => {
	it('fits a large source inside the viewport without upscaling a small one', () => {
		expect(fitZoom(SOURCE, VIEWPORT)).toBeCloseTo(700 / 3000, 10);
		expect(fitZoom({width: 100, height: 100}, VIEWPORT)).toBe(1);
		expect(fitZoom({width: 0, height: 0}, VIEWPORT)).toBe(1);
		expect(fitZoom(SOURCE, {width: 0, height: 0})).toBe(1);
	});

	it('clamps zoom between 10% of fit and 3200%', () => {
		const fit = fitZoom(SOURCE, VIEWPORT);
		expect(minZoomFor(fit)).toBeCloseTo(0.1 * fit, 10);
		expect(clampZoom(0.0001, fit)).toBeCloseTo(0.1 * fit, 10);
		expect(clampZoom(1000, fit)).toBe(32);
		expect(clampZoom(2, fit)).toBe(2);
	});

	it('never goes below the stored minimum zoom when 10% of fit is smaller', () => {
		expect(minZoomFor(0.01)).toBe(0.01);
	});

	it('offers the zoom presets of AC-F13.2', () => {
		expect(ZOOM_PRESETS).toEqual([0.5, 1, 2, 4]);
		expect(formatZoomPercent(1)).toBe('100%');
		expect(formatZoomPercent(0.2334)).toBe('23%');
		expect(formatZoomPercent(2.5)).toBe('250%');
	});
});

describe('canvas view: stored state', () => {
	it('resolves a fit view to the contain scale and centres the image', () => {
		const view = resolveView(viewState({fitMode: 'fit'}), SOURCE, VIEWPORT);
		expect(view.fitMode).toBe('fit');
		expect(view.zoom).toBeCloseTo(fitZoom(SOURCE, VIEWPORT), 10);
		expect(view.centerX).toBe(2000);
		expect(view.centerY).toBe(1500);
	});

	it('keeps a stored custom zoom and centre that are inside the pan limits', () => {
		const view = resolveView(
			viewState({zoom: 2, centerX: 2100, centerY: 1600}),
			SOURCE,
			VIEWPORT,
		);
		expect(view).toEqual(customView(2, 2100, 1600));
	});

	it('clamps a stored centre that would push the image out of view', () => {
		const view = resolveView(
			viewState({zoom: 1, centerX: 99_999, centerY: -4000}),
			SMALL_SOURCE,
			VIEWPORT,
		);
		const rect = imageRect(view, SMALL_SOURCE, VIEWPORT);
		expect(rect.left + rect.width).toBeCloseTo(PAN_MARGIN_PX, 10);
		expect(rect.top).toBeCloseTo(VIEWPORT.height - PAN_MARGIN_PX, 10);
	});
});

describe('canvas view: pan clamp (AC-F13.3)', () => {
	it('stops a horizontal pan with exactly 64 CSS px of image visible', () => {
		const toLeft = imageRect(
			clampCenter(customView(1, 5000, 150), SMALL_SOURCE, VIEWPORT),
			SMALL_SOURCE,
			VIEWPORT,
		);
		expect(toLeft.left + toLeft.width).toBeCloseTo(PAN_MARGIN_PX, 10);
		expect(overlap(toLeft, VIEWPORT).width).toBeCloseTo(PAN_MARGIN_PX, 10);

		const toRight = imageRect(
			clampCenter(customView(1, -5000, 150), SMALL_SOURCE, VIEWPORT),
			SMALL_SOURCE,
			VIEWPORT,
		);
		expect(toRight.left).toBeCloseTo(VIEWPORT.width - PAN_MARGIN_PX, 10);
		expect(overlap(toRight, VIEWPORT).width).toBeCloseTo(PAN_MARGIN_PX, 10);
	});

	it('stops a vertical pan with exactly 64 CSS px of image visible', () => {
		const down = imageRect(
			clampCenter(customView(2, 200, -5000), SMALL_SOURCE, VIEWPORT),
			SMALL_SOURCE,
			VIEWPORT,
		);
		expect(down.top).toBeCloseTo(VIEWPORT.height - PAN_MARGIN_PX, 10);
		expect(overlap(down, VIEWPORT).height).toBeCloseTo(PAN_MARGIN_PX, 10);

		const up = imageRect(
			clampCenter(customView(2, 200, 5000), SMALL_SOURCE, VIEWPORT),
			SMALL_SOURCE,
			VIEWPORT,
		);
		expect(up.top + up.height).toBeCloseTo(PAN_MARGIN_PX, 10);
		expect(overlap(up, VIEWPORT).height).toBeCloseTo(PAN_MARGIN_PX, 10);
	});

	it('leaves a view unchanged when the image already stays inside the limits', () => {
		const view = customView(1, 200, 150);
		expect(clampCenter(view, SMALL_SOURCE, VIEWPORT)).toBe(view);
	});

	it('centres the image when the viewport is narrower than the 64 px margins', () => {
		const view = clampCenter(customView(1, 9000, 150), SMALL_SOURCE, {
			width: 100,
			height: 700,
		});
		expect(view.centerX).toBe(200);
	});

	it('does not clamp before the stage has been measured', () => {
		const view = customView(1, 9000, 150);
		expect(clampCenter(view, SMALL_SOURCE, {width: 0, height: 0})).toBe(view);
	});
});

describe('canvas view: pointer and keyboard zoom', () => {
	it('keeps the source point under the pointer while zooming', () => {
		const before = customView(1, 200, 150);
		const anchor = {x: 750, y: 350};
		const anchorSource = sourceAt(before, anchor, VIEWPORT);
		const after = zoomAt(before, anchor, 2, SMALL_SOURCE, VIEWPORT);

		expect(after.zoom).toBe(2);
		const moved = sourceAt(after, anchor, VIEWPORT);
		expect(moved.x).toBeCloseTo(anchorSource.x, 10);
		expect(moved.y).toBeCloseTo(anchorSource.y, 10);
	});

	it('keeps the centre of the view when only the zoom changes', () => {
		const after = zoomTo(customView(1, 200, 150), 4, SMALL_SOURCE, VIEWPORT);
		expect(after).toEqual(customView(4, 200, 150));
	});

	it('stops zooming at the input limits', () => {
		expect(zoomTo(customView(32, 200, 150), 64, SOURCE, VIEWPORT).zoom).toBe(
			32,
		);
		expect(
			zoomTo(customView(0.05, 200, 150), 0.001, SOURCE, VIEWPORT).zoom,
		).toBeCloseTo(minZoomFor(fitZoom(SOURCE, VIEWPORT)), 10);
	});

	it('pans by the dragged distance divided by the zoom', () => {
		expect(
			panBy(customView(2, 200, 150), 40, -20, SMALL_SOURCE, VIEWPORT),
		).toEqual(customView(2, 180, 160));
	});

	it('pans by 10% of the viewport on an arrow key (DESIGN.md section 8.3)', () => {
		const view = customView(1, 200, 150);
		expect(panByKey(view, 'ArrowRight', SMALL_SOURCE, VIEWPORT).centerX).toBe(
			300,
		);
		expect(panByKey(view, 'ArrowLeft', SMALL_SOURCE, VIEWPORT).centerX).toBe(
			100,
		);
		expect(panByKey(view, 'ArrowDown', SMALL_SOURCE, VIEWPORT).centerY).toBe(
			220,
		);
		expect(panByKey(view, 'ArrowUp', SMALL_SOURCE, VIEWPORT).centerY).toBe(80);
		expect(
			panByKey(customView(2, 200, 150), 'ArrowRight', SMALL_SOURCE, VIEWPORT)
				.centerX,
		).toBe(250);
	});
});

describe('canvas view: image rectangle', () => {
	it('maps the source into the viewport around the centre', () => {
		expect(imageRect(customView(2, 200, 150), SMALL_SOURCE, VIEWPORT)).toEqual({
			left: 100,
			top: 50,
			width: 800,
			height: 600,
		});
	});

	it('centres a fit view of a large source with equal margins', () => {
		const rect = imageRect(fitView(SOURCE, VIEWPORT), SOURCE, VIEWPORT);
		expect(rect.height).toBeCloseTo(VIEWPORT.height, 10);
		expect(rect.width).toBeCloseTo((4000 * VIEWPORT.height) / 3000, 10);
		expect(rect.left).toBeCloseTo((VIEWPORT.width - rect.width) / 2, 10);
		expect(rect.top).toBeCloseTo(0, 10);
	});
});
