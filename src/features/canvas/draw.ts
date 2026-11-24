import {
	SMOOTHING_MAX_ZOOM,
	imageRect,
	type CanvasView,
	type Size,
} from './view.ts';

/**
 The primitive calls `drawCanvas` makes, so a test can pass a recording stand-in
 for the 2D context.
 */
export type CanvasSurface = {
	imageSmoothingEnabled: boolean;
	fillStyle: CanvasRenderingContext2D['fillStyle'];
	setTransform(
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
	): void;
	clearRect(x: number, y: number, width: number, height: number): void;
	fillRect(x: number, y: number, width: number, height: number): void;
	drawImage(
		image: CanvasImageSource,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void;
};

export type FrameImage = {
	readonly bitmap: CanvasImageSource;
	readonly width: number;
	readonly height: number;
};

export type TileImage = FrameImage & {
	// Source-pixel offset of the tile.
	readonly x: number;
	readonly y: number;
};

export type DrawInput = {
	readonly surface: CanvasSurface;
	// Viewport size in CSS px.
	readonly viewport: Size;
	readonly view: CanvasView | null;
	readonly source: Size | null;
	readonly frame: FrameImage | null;
	readonly tiles: readonly TileImage[] | null;
	// Backdrop for transparent pixels; null leaves the area cleared.
	readonly checker: CanvasPattern | null;
	readonly dpr: number;
};

type Region = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/**
 Draws the newest frame over the whole image rectangle, then each full-resolution
 tile on top of it, in CSS px after a device-pixel-ratio transform.
 */
export function drawCanvas(input: DrawInput): void {
	const {surface, viewport, dpr} = input;
	if (!(dpr > 0) || !(viewport.width > 0) || !(viewport.height > 0)) {
		return;
	}

	surface.setTransform(dpr, 0, 0, dpr, 0, 0);
	surface.clearRect(0, 0, viewport.width, viewport.height);

	const {view, source} = input;
	if (!view || !source || source.width <= 0 || source.height <= 0) {
		return;
	}

	const rect = imageRect(view, source, viewport);
	const left = Math.max(0, rect.left);
	const top = Math.max(0, rect.top);
	const right = Math.min(viewport.width, rect.left + rect.width);
	const bottom = Math.min(viewport.height, rect.top + rect.height);
	if (!(right > left) || !(bottom > top)) {
		return;
	}

	if (input.checker) {
		surface.fillStyle = input.checker;
		surface.fillRect(left, top, right - left, bottom - top);
	}

	surface.imageSmoothingEnabled = !(view.zoom > SMOOTHING_MAX_ZOOM);

	if (input.frame) {
		drawRegion(
			surface,
			input.frame,
			{x: 0, y: 0, width: source.width, height: source.height},
			view,
			viewport,
		);
	}

	for (const tile of input.tiles ?? []) {
		drawRegion(
			surface,
			tile,
			{x: tile.x, y: tile.y, width: tile.width, height: tile.height},
			view,
			viewport,
		);
	}
}

/**
 `image` covers the source rectangle `region`; only the part of it inside the
 viewport is drawn, snapped to whole image pixels so a pixel edge never lands
 between two device pixels.
 */
function drawRegion(
	surface: CanvasSurface,
	image: FrameImage,
	region: Region,
	view: CanvasView,
	viewport: Size,
): void {
	const scaleX = image.width / region.width;
	const scaleY = image.height / region.height;
	if (!(scaleX > 0) || !(scaleY > 0)) {
		return;
	}

	const imageLeft = viewport.width / 2 - view.centerX * view.zoom;
	const imageTop = viewport.height / 2 - view.centerY * view.zoom;
	const {zoom} = view;

	const visibleLeft = Math.max(region.x, -imageLeft / zoom);
	const visibleTop = Math.max(region.y, -imageTop / zoom);
	const visibleRight = Math.min(
		region.x + region.width,
		(viewport.width - imageLeft) / zoom,
	);
	const visibleBottom = Math.min(
		region.y + region.height,
		(viewport.height - imageTop) / zoom,
	);
	if (!(visibleRight > visibleLeft) || !(visibleBottom > visibleTop)) {
		return;
	}

	const pixelLeft = Math.max(0, Math.floor((visibleLeft - region.x) * scaleX));
	const pixelTop = Math.max(0, Math.floor((visibleTop - region.y) * scaleY));
	const pixelRight = Math.min(
		image.width,
		Math.ceil((visibleRight - region.x) * scaleX),
	);
	const pixelBottom = Math.min(
		image.height,
		Math.ceil((visibleBottom - region.y) * scaleY),
	);
	if (!(pixelRight > pixelLeft) || !(pixelBottom > pixelTop)) {
		return;
	}

	const sourceX = region.x + pixelLeft / scaleX;
	const sourceY = region.y + pixelTop / scaleY;
	const sourceWidth = (pixelRight - pixelLeft) / scaleX;
	const sourceHeight = (pixelBottom - pixelTop) / scaleY;
	surface.drawImage(
		image.bitmap,
		pixelLeft,
		pixelTop,
		pixelRight - pixelLeft,
		pixelBottom - pixelTop,
		imageLeft + sourceX * zoom,
		imageTop + sourceY * zoom,
		sourceWidth * zoom,
		sourceHeight * zoom,
	);
}
