import {fitZoom, type CanvasView, type Size} from './view.ts';

// Room around the fitted image for the crop handles and the zoom control.
const MARGIN_X = 28;
const MARGIN_Y = 60;
const MAX_MARGIN_SHARE = 0.15;

// Fit for crop mode: centred, with a margin that shrinks on a small stage.
export function cropFitView(source: Size, viewport: Size): CanvasView {
	const margin = (length: number, wanted: number) =>
		Math.min(wanted, length * MAX_MARGIN_SHARE);
	return {
		zoom: fitZoom(source, {
			width: viewport.width - 2 * margin(viewport.width, MARGIN_X),
			height: viewport.height - 2 * margin(viewport.height, MARGIN_Y),
		}),
		centerX: source.width / 2,
		centerY: source.height / 2,
		fitMode: 'fit',
	};
}
