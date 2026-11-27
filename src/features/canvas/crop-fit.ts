import {fitZoom, type CanvasView, type Size} from './view.ts';

// Room around the fitted image for the crop handles and the zoom control.
const MARGIN_X = 28;
const MARGIN_Y = 60;
const MAX_MARGIN_SHARE = 0.15;
// Under a coarse pointer the zoom control is 44 px tall, and the lower handles
// have to clear it.
const COARSE_MARGIN_Y = 76;
const COARSE_MAX_MARGIN_SHARE_Y = 0.25;

// Fit for crop mode: centred, with a margin that shrinks on a small stage.
export function cropFitView(
	source: Size,
	viewport: Size,
	coarsePointer = globalThis.matchMedia?.('(pointer: coarse)').matches,
): CanvasView {
	const margin = (length: number, wanted: number, share = MAX_MARGIN_SHARE) =>
		Math.min(wanted, length * share);
	const marginY = coarsePointer
		? margin(viewport.height, COARSE_MARGIN_Y, COARSE_MAX_MARGIN_SHARE_Y)
		: margin(viewport.height, MARGIN_Y);
	return {
		zoom: fitZoom(source, {
			width: viewport.width - 2 * margin(viewport.width, MARGIN_X),
			height: viewport.height - 2 * marginY,
		}),
		centerX: source.width / 2,
		centerY: source.height / 2,
		fitMode: 'fit',
	};
}
