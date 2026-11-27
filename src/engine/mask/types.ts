import type {SourceTransform} from '../transform.ts';

// A mask limits where one effect instance applies (engine.md section 16.6).
export type InstanceMask = {
	invert: boolean;
	// Integer 0..256, in effective-image px.
	feather: number;
} & (
	| {
			kind: 'paint';
			// Mask hash as 64 lowercase hex digits, or '' for nothing painted.
			asset: string;
	  }
	| {
			kind: 'luma';
			// 0..1 in steps of 0.001.
			range: readonly [number, number];
			softness: number;
	  }
	| {
			kind: 'image';
			// SHA-256 of an extra source, or '' for none.
			source: string;
			fit: MaskImageFit;
	  }
);

export type MaskKind = InstanceMask['kind'];

export type MaskImageFit = 'cover' | 'contain' | 'stretch';

// One byte per pixel, row-major. 255 applies the effect, 0 keeps its input.
export type MaskBitmap = {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
};

// How a painted mask's grid, which lies on the stored source, maps onto the effective image.
export type MaskGeometry = {
	// Size of the stored source, before the transform.
	sourceWidth: number;
	sourceHeight: number;
	transform: SourceTransform;
};
