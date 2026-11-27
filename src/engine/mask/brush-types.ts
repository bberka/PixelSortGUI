// Shapes of engine.md section 16.6 that the brush and the mask asset use.

import type {SourceTransform} from '../transform.ts';

export type MaskBitmap = {
	readonly width: number;
	readonly height: number;
	// Row-major, one byte per pixel.
	readonly data: Uint8Array;
};

// The stored source (section 16.3) a painted mask's grid lies on.
export type MaskGeometry = {
	sourceWidth: number;
	sourceHeight: number;
	transform: SourceTransform;
};

export type BrushStroke = {
	mode: 'paint' | 'erase';
	// Integer 0..100.
	hardness: number;
	// Integer 1..100.
	strength: number;
};

// Integers in 1/16 mask pixels; `rx` and `ry` are at least 8.
export type BrushSample = {x: number; y: number; rx: number; ry: number};

// Whole mask pixels.
export type MaskRect = {x: number; y: number; width: number; height: number};
