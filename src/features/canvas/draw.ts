import type {SplitOrientation} from '../../storage/types.ts';
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
	globalAlpha: number;
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
	save(): void;
	restore(): void;
	beginPath(): void;
	rect(x: number, y: number, width: number, height: number): void;
	clip(): void;
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

export type CompareDraw =
	| {readonly mode: 'none'}
	| {readonly mode: 'original'; readonly useSideA?: boolean}
	| {
			readonly mode: 'split';
			readonly position: number;
			readonly orientation?: SplitOrientation;
	  };

// A rendered result: the preview frame and any full-resolution tiles over it.
// `size`, when set and different from the canvas `source`, contain-fits the
// side centered inside the canvas image bounds without stretching (F31).
export type RenderedSide = {
	readonly frame: FrameImage | null;
	readonly tiles: readonly TileImage[] | null;
	readonly size?: Size | null;
};

export type DrawInput = {
	readonly surface: CanvasSurface;
	// Viewport size in CSS px.
	readonly viewport: Size;
	readonly view: CanvasView | null;
	readonly source: Size | null;
	readonly original?: FrameImage | null;
	readonly frame: FrameImage | null;
	readonly tiles: readonly TileImage[] | null;
	// Split side A. Without a frame, side A shows `original`.
	readonly sideA?: RenderedSide | null;
	readonly compare?: CompareDraw;
	// The mask overlay, over the side it belongs to. Never over the original.
	readonly overlay?: MaskOverlayImage | null;
	// Backdrop for transparent pixels; null leaves the area cleared.
	readonly checker: CanvasPattern | null;
	readonly dpr: number;
};

// A tinted mask covering the whole edited image.
export type MaskOverlayImage = FrameImage & {
	readonly side: 'a' | 'b';
	// 0..1.
	readonly opacity: number;
};

export type Region = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/**
 Uniformly contain-fits `inner` centered inside `outer`, preserving aspect
 ratio so a history snapshot with a different transform never stretches (F31).
 */
export function containRegion(outer: Size, inner: Size): Region {
	if (
		!(inner.width > 0) ||
		!(inner.height > 0) ||
		(inner.width === outer.width && inner.height === outer.height)
	) {
		return {x: 0, y: 0, width: outer.width, height: outer.height};
	}

	const scale = Math.min(
		outer.width / inner.width,
		outer.height / inner.height,
	);
	const width = inner.width * scale;
	const height = inner.height * scale;
	return {
		x: (outer.width - width) / 2,
		y: (outer.height - height) / 2,
		width,
		height,
	};
}

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

	const fullRegion: Region = {
		x: 0,
		y: 0,
		width: source.width,
		height: source.height,
	};
	const drawEdited = ({frame, tiles, size}: RenderedSide) => {
		const target = size ? containRegion(source, size) : fullRegion;
		const tileScaleX = size && size.width > 0 ? target.width / size.width : 1;
		const tileScaleY =
			size && size.height > 0 ? target.height / size.height : 1;

		if (frame) {
			drawRegion(surface, frame, target, view, viewport);
		}

		for (const tile of tiles ?? []) {
			drawRegion(
				surface,
				tile,
				{
					x: target.x + tile.x * tileScaleX,
					y: target.y + tile.y * tileScaleY,
					width: tile.width * tileScaleX,
					height: tile.height * tileScaleY,
				},
				view,
				viewport,
			);
		}
	};

	const drawOverlay = (side: 'a' | 'b') => {
		const {overlay} = input;
		if (overlay?.side !== side) {
			return;
		}

		surface.globalAlpha = overlay.opacity;
		drawRegion(surface, overlay, fullRegion, view, viewport);
		surface.globalAlpha = 1;
	};

	const {compare} = input;
	if (compare?.mode === 'original') {
		if (compare.useSideA && input.sideA?.frame) {
			drawEdited(input.sideA);
		} else if (input.original) {
			drawRegion(surface, input.original, fullRegion, view, viewport);
		}

		return;
	}

	if (compare?.mode === 'split') {
		const ratio = Number.isFinite(compare.position)
			? Math.min(1, Math.max(0, compare.position))
			: 0.5;
		const horizontal = compare.orientation === 'horizontal';
		const extent = horizontal ? viewport.height : viewport.width;
		const split = ratio * extent;
		const clipped = (from: number, length: number, paint: () => void) => {
			surface.save();
			surface.beginPath();
			if (horizontal) {
				surface.rect(0, from, viewport.width, length);
			} else {
				surface.rect(from, 0, length, viewport.height);
			}

			surface.clip();
			paint();
			surface.restore();
		};

		const sideA = input.sideA?.frame ? input.sideA : null;
		if (split > 0 && (sideA || input.original)) {
			clipped(0, split, () => {
				if (sideA) {
					drawEdited(sideA);
				} else if (input.original) {
					drawRegion(surface, input.original, fullRegion, view, viewport);
				}

				drawOverlay('a');
			});
		}

		if (split < extent) {
			clipped(split, extent - split, () => {
				drawEdited(input);
				drawOverlay('b');
			});
		}

		return;
	}

	drawEdited(input);
	drawOverlay('b');
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
