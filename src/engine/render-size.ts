import {roundHalfAway} from './math.ts';

// Render dimensions (engine.md section 8.1).

export type RenderSize = {
	readonly width: number;
	readonly height: number;
	readonly scale: number;
};

export function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive integer, got ${value}`);
	}
}

export function renderSize(
	sourceWidth: number,
	sourceHeight: number,
	scale: number,
): RenderSize {
	assertPositiveInteger(sourceWidth, 'sourceWidth');
	assertPositiveInteger(sourceHeight, 'sourceHeight');
	if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
		throw new RangeError(`scale must be in (0, 1], got ${scale}`);
	}

	const width = Math.max(1, Math.floor(sourceWidth * scale));
	const height = Math.max(1, Math.floor(sourceHeight * scale));
	return {width, height, scale: width / sourceWidth};
}

export function renderSizeForPixelCap(
	sourceWidth: number,
	sourceHeight: number,
	pixelCap: number,
): RenderSize {
	assertPositiveInteger(sourceWidth, 'sourceWidth');
	assertPositiveInteger(sourceHeight, 'sourceHeight');
	if (!Number.isFinite(pixelCap) || pixelCap <= 0) {
		throw new RangeError(`pixelCap must be positive, got ${pixelCap}`);
	}

	const scale = Math.min(1, Math.sqrt(pixelCap / (sourceWidth * sourceHeight)));
	return renderSize(sourceWidth, sourceHeight, scale);
}

// A source-pixel length at render `scale`. A positive length never becomes 0.
export function scaledLength(sourcePx: number, scale: number): number {
	return sourcePx <= 0 ? 0 : Math.max(1, roundHalfAway(sourcePx * scale));
}
