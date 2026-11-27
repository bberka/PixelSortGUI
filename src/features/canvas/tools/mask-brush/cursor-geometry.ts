// Where the brush cursor lies on screen and how large it is.
import {brushSample, maskToEffective} from '@/engine/mask/coords.ts';
import type {MaskGeometry} from '@/engine/mask/types.ts';
import type {CanvasView, Point, Size} from '@/features/canvas/view.ts';
import type {BrushTool} from '@/state/brush.ts';

export type CursorInput = {
	readonly view: CanvasView;
	readonly viewport: Size;
	readonly geometry: MaskGeometry;
	// In effective-image pixels.
	readonly point: Point;
	// Brush diameter in effective-image pixels, before pressure.
	readonly size: number;
	readonly factor: number;
	readonly hardness: number;
	readonly tool: BrushTool;
};

/**
 The half axes, in effective-image pixels, of the dab the brush stamps at
 `point`. They differ from `size / 2` only where the smallest dab of half a mask
 pixel is wider.
 */
export function dabRadii({
	geometry,
	point,
	size,
	factor,
}: Pick<CursorInput, 'geometry' | 'point' | 'size' | 'factor'>): Point {
	const {x, y, rx, ry} = brushSample(geometry, point, size, factor);
	const centre = {x: x / 16, y: y / 16};
	const origin = maskToEffective(geometry, centre);
	const across = maskToEffective(geometry, {
		x: centre.x + rx / 16,
		y: centre.y,
	});
	const down = maskToEffective(geometry, {x: centre.x, y: centre.y + ry / 16});
	// A quarter turn swaps the axes, so each takes whichever one moves it.
	return {
		x: Math.abs(across.x - origin.x) + Math.abs(down.x - origin.x),
		y: Math.abs(across.y - origin.y) + Math.abs(down.y - origin.y),
	};
}

// Writes the cursor into the elements of `BrushCursor`; `null` hides it.
export function placeCursor(
	element: HTMLElement,
	input: CursorInput | null,
): void {
	element.hidden = input === null;
	if (!input) {
		return;
	}

	const {view, viewport, point, hardness, tool} = input;
	const radii = dabRadii(input);
	const left = viewport.width / 2 + (point.x - view.centerX) * view.zoom;
	const top = viewport.height / 2 + (point.y - view.centerY) * view.zoom;
	const rx = radii.x * view.zoom;
	const ry = radii.y * view.zoom;
	element.style.transform = `translate(${left}px, ${top}px)`;
	element.dataset.tool = tool;
	element.dataset.x = String(left);
	element.dataset.y = String(top);
	element.dataset.radius = String(rx);
	for (const ring of element.querySelectorAll<SVGElement>('[data-ring]')) {
		const scale = ring.dataset.ring === 'hard' ? hardness / 100 : 1;
		ring.setAttribute('rx', String(rx * scale));
		ring.setAttribute('ry', String(ry * scale));
	}
}
