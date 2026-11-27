import type {Pace} from '../blur.ts';
import {place, sample} from '../effects/image-blend.ts';
import {floorDiv} from '../math.ts';
import {scaledLength} from '../render-size.ts';
import {IDENTITY_TRANSFORM} from '../transform.ts';
import type {ExtraSource, RgbaImage} from '../types.ts';
import {featherMask} from './feather.ts';
import {fitPaintedMask} from './fit.ts';
import {maskGridSize} from './grid.ts';
import {createPacer} from './pace.ts';
import type {
	InstanceMask,
	MaskBitmap,
	MaskGeometry,
	MaskImageFit,
} from './types.ts';
import {validateMask} from './validate.ts';

export type MaskInputs = {
	// The effective image at render size, before any instance. Only read.
	source: RgbaImage;
	// Size of the effective image.
	sourceWidth: number;
	sourceHeight: number;
	// Absent: the identity transform on a source of `sourceWidth x sourceHeight`.
	geometry?: MaskGeometry;
	// Painted masks by mask hash. Only read.
	masks?: ReadonlyMap<string, MaskBitmap>;
	// Mask images by SHA-256. Only read.
	extraSources?: ReadonlyMap<string, ExtraSource>;
};

// Writes the base mask of one kind into `target`, one byte per render pixel.
type BaseMask = (target: Uint8Array, pace: Pace) => Promise<void>;

export type MaskWarning = 'missing-mask' | 'missing-source';

// A mask whose inputs are all present, ready to render.
export type ReadyMask = {
	status: 'ready';
	mask: InstanceMask;
	base: BaseMask;
};

export type ResolvedMask = ReadyMask | {status: 'missing'; code: MaskWarning};

// Rec. 709 luma of an 8-bit colour, 0..255.
function luma(r: number, g: number, b: number): number {
	return floorDiv(2126 * r + 7152 * g + 722 * b + 5000, 10_000);
}

const empty: BaseMask = async (target) => {
	target.fill(0);
};

// The mask value of every luma 0..255 for a brightness range and softness.
function lumaTable(
	range: readonly [number, number],
	softness: number,
): Uint8Array {
	const low = Math.floor(range[0] * 255 + 0.5);
	const high = Math.floor(range[1] * 255 + 0.5);
	const soft = Math.floor(softness * 255 + 0.5);
	return Uint8Array.from({length: 256}, (_, level) => {
		const distance = Math.max(low - level, level - high, 0);
		if (distance === 0) {
			return 255;
		}

		return distance > soft
			? 0
			: floorDiv(510 * (soft + 1 - distance) + (soft + 1), 2 * (soft + 1));
	});
}

function brightnessBase(
	{width, height, data}: RgbaImage,
	table: Uint8Array,
): BaseMask {
	return async (target, pace) => {
		for (let y = 0; y < height; y++) {
			const pending = pace(width);
			if (pending) {
				await pending;
			}

			const end = (y + 1) * width;
			for (let i = y * width, p = i * 4; i < end; i++, p += 4) {
				target[i] = table[luma(data[p], data[p + 1], data[p + 2])];
			}
		}
	};
}

// Luma times alpha of the image, placed over the frame like `imageBlend` places it.
function imageBase(
	{width, height}: RgbaImage,
	image: ExtraSource,
	fit: MaskImageFit,
): BaseMask {
	// The render scale only matters for the `tile` and `none` fits.
	const {scaleX, scaleY, centerX, centerY} = place(width, height, 1, image, {
		fit,
		scale: 1,
		offsetX: 0,
		offsetY: 0,
		rotation: 0,
	});
	return async (target, pace) => {
		const sampled = new Int32Array(4);
		for (let y = 0; y < height; y++) {
			const pending = pace(width);
			if (pending) {
				await pending;
			}

			const uy = (y + 0.5 - centerY) / scaleY + image.height / 2 - 0.5;
			const insideY = uy >= -0.5 && uy <= image.height - 0.5;
			for (let x = 0; x < width; x++) {
				const ux = (x + 0.5 - centerX) / scaleX + image.width / 2 - 0.5;
				if (!insideY || ux < -0.5 || ux > image.width - 0.5) {
					target[y * width + x] = 0;
					continue;
				}

				sample(image, ux, uy, false, sampled);
				const level = luma(sampled[0], sampled[1], sampled[2]);
				target[y * width + x] = floorDiv(2 * level * sampled[3] + 255, 510);
			}
		}
	};
}

function paintedBase(
	asset: string,
	{source, sourceWidth, sourceHeight, geometry, masks}: MaskInputs,
): BaseMask | undefined {
	if (asset === '') {
		return empty;
	}

	const placement = geometry ?? {
		sourceWidth,
		sourceHeight,
		transform: IDENTITY_TRANSFORM,
	};
	const grid = masks?.get(asset);
	const size = maskGridSize(placement.sourceWidth, placement.sourceHeight);
	if (
		!grid ||
		grid.width !== size.width ||
		grid.height !== size.height ||
		grid.data.length !== size.width * size.height
	) {
		return undefined;
	}

	return (target, pace) =>
		fitPaintedMask(grid, placement, source.width, source.height, target, pace);
}

/**
 Validates an instance's stored mask and finds what it reads. A mask that cannot
 be validated, or whose painted asset or image was not supplied, is missing: the
 caller skips the instance. `value` is only read.
 */
export function resolveMask(value: unknown, inputs: MaskInputs): ResolvedMask {
	const mask = validateMask(value);
	if (!mask) {
		return {status: 'missing', code: 'missing-mask'};
	}

	switch (mask.kind) {
		case 'paint': {
			const base = paintedBase(mask.asset, inputs);
			return base
				? {status: 'ready', mask, base}
				: {status: 'missing', code: 'missing-mask'};
		}

		case 'luma': {
			const table = lumaTable(mask.range, mask.softness);
			return {
				status: 'ready',
				mask,
				base: brightnessBase(inputs.source, table),
			};
		}

		case 'image': {
			if (mask.source === '') {
				return {status: 'ready', mask, base: empty};
			}

			const image = inputs.extraSources?.get(mask.source);
			return image
				? {
						status: 'ready',
						mask,
						base: imageBase(inputs.source, image, mask.fit),
					}
				: {status: 'missing', code: 'missing-source'};
		}
	}
}

export type MaskRender = {
	// Render size and the size of the effective image it is a render of.
	width: number;
	height: number;
	sourceWidth: number;
	// Receives the mask: `width * height` bytes.
	target: Uint8Array;
	// A buffer of `width * height` bytes, asked for only when the mask is feathered.
	spare: () => Uint8Array;
	checkpoint: () => void | Promise<void>;
};

/**
 The final mask of one instance at render size: base, then feather, then invert
 (engine.md section 16.6). Writes it into `target` and returns `target`.
 */
export async function renderMask(
	{mask, base}: ReadyMask,
	{width, height, sourceWidth, target, spare, checkpoint}: MaskRender,
): Promise<Uint8Array> {
	const pace = createPacer(checkpoint);
	await base(target, pace);

	const radius = scaledLength(mask.feather, width / sourceWidth);
	if (radius > 0) {
		await featherMask(target, spare(), width, height, radius, pace);
	}

	if (mask.invert) {
		for (let y = 0; y < height; y++) {
			const pending = pace(width);
			if (pending) {
				await pending;
			}

			const end = (y + 1) * width;
			for (let i = y * width; i < end; i++) {
				target[i] = 255 - target[i];
			}
		}
	}

	return target;
}
