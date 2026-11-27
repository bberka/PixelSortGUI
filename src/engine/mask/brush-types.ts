// Shapes of engine.md section 16.6 that the brush and the mask asset use.

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
