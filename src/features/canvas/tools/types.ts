// The on-canvas tool slot (engine.md section 4.7, DESIGN.md section 7.1).
import type {KeyboardEvent, PointerEvent, RefObject} from 'react';
import type {MaskOverlayImage} from '../draw.ts';
import type {CanvasView, Point, Size} from '../view.ts';

export type CanvasToolbarProps = {
	// A vertical strip over the canvas, or a row in place of a phone's effect strip.
	readonly layout: 'strip' | 'row';
};

// What the canvas stage lends a tool.
export type ToolStage = {
	canvas(): HTMLCanvasElement | null;
	readView(): {view: CanvasView; viewport: Size} | null;
	redraw(): void;
};

// How the canvas stage hands input to the tool that is on.
export type CanvasToolHandle = {
	// Drawn between the photo and the pointer layer.
	readonly overlayRef: RefObject<MaskOverlayImage | null>;
	// The element the tool's cursor lives in.
	readonly cursorRef: RefObject<HTMLDivElement | null>;
	// A tool is on and not suspended.
	engaged(): boolean;
	// Moves the cursor after the view changed.
	place(): void;
	// 'tool': the tool takes this pointer and every other one is dropped.
	// 'ignore': nobody does. 'canvas': it pans and zooms. `others` counts the
	// pointers already down.
	pointerDown(
		event: PointerEvent<HTMLCanvasElement>,
		position: Point,
		others: number,
	): 'tool' | 'ignore' | 'canvas';
	// `true` when the pointer is the tool's.
	pointerMove(event: PointerEvent<HTMLCanvasElement>, position: Point): boolean;
	pointerUp(pointerId: number, commit: boolean, pointerType: string): boolean;
	pointerLeave(pointerType: string): void;
	// `true` when the tool used the key.
	keyDown(event: KeyboardEvent<HTMLCanvasElement>): boolean;
};
