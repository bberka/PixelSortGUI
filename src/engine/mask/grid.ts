import {renderSizeForPixelCap} from '../render-size.ts';
import type {Size} from '../transform.ts';

export const MASK_PIXEL_CAP = 4_194_304;

// The grid size of a painted mask on a stored source of this size.
export function maskGridSize(sourceWidth: number, sourceHeight: number): Size {
	const {width, height} = renderSizeForPixelCap(
		sourceWidth,
		sourceHeight,
		MASK_PIXEL_CAP,
	);
	return {width, height};
}
