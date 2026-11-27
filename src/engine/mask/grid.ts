import {renderSizeForPixelCap, type RenderSize} from '../render-size.ts';

export const MASK_PIXEL_CAP = 4_194_304;

// The grid size of a painted mask on a stored source of this size.
export function maskGridSize(
	sourceWidth: number,
	sourceHeight: number,
): RenderSize {
	return renderSizeForPixelCap(sourceWidth, sourceHeight, MASK_PIXEL_CAP);
}
