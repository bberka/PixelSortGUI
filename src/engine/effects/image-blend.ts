/* eslint-disable no-bitwise -- exact rounded division by 65536 */
import {DIRECTION_TABLE} from '../direction-table.ts';
import {clamp, floorDiv, wrap} from '../math.ts';
import type {EffectDefinition, ExtraSource, RgbaImage} from '../types.ts';
import {
	imageBlendSpec,
	type ImageBlendMode,
	type ImageBlendParams,
} from './image-blend-spec.ts';

const CHECKPOINT_PIXELS = 16_384;
// Alpha sum of a sample whose four taps are opaque.
const OPAQUE_SUM = 65_536 * 255;

type ChannelBlend = (base: number, over: number) => number;

// Separable blend functions on integer channels (engine.md section 16.5).
export const BLEND_CHANNEL: Readonly<Record<ImageBlendMode, ChannelBlend>> = {
	normal: (_i, f) => f,
	multiply: (i, f) => floorDiv(2 * i * f + 255, 510),
	screen: (i, f) => 255 - floorDiv(2 * (255 - i) * (255 - f) + 255, 510),
	overlay: (i, f) =>
		i < 128
			? floorDiv(4 * i * f + 255, 510)
			: 255 - floorDiv(4 * (255 - i) * (255 - f) + 255, 510),
	lighten: (i, f) => Math.max(i, f),
	darken: (i, f) => Math.min(i, f),
	difference: (i, f) => Math.abs(i - f),
	exclusion: (i, f) => clamp(i + f - floorDiv(4 * i * f + 255, 510), 0, 255),
	add: (i, f) => Math.min(255, i + f),
	subtract: (i, f) => Math.max(0, i - f),
};

type Placement = {
	// Overlay pixels to render pixels.
	scaleX: number;
	scaleY: number;
	// Overlay centre in render pixels.
	centerX: number;
	centerY: number;
	cos: number;
	sin: number;
};

// Where `overlay` lies on a `width x height` render (engine.md section 16.5).
export function place(
	width: number,
	height: number,
	renderScale: number,
	overlay: ExtraSource,
	params: Pick<
		ImageBlendParams,
		'fit' | 'scale' | 'offsetX' | 'offsetY' | 'rotation'
	>,
): Placement {
	const {fit} = params;
	let fitX: number;
	let fitY: number;
	if (fit === 'cover' || fit === 'contain') {
		const pick = fit === 'cover' ? Math.max : Math.min;
		fitX = pick(width / overlay.width, height / overlay.height);
		fitY = fitX;
	} else if (fit === 'stretch') {
		fitX = width / overlay.width;
		fitY = height / overlay.height;
	} else {
		fitX = (renderScale * overlay.sourceWidth) / overlay.width;
		fitY = (renderScale * overlay.sourceHeight) / overlay.height;
	}

	const [dirX, dirY] =
		DIRECTION_TABLE[wrap(Math.round(params.rotation * 10), 3600)];
	return {
		scaleX: fitX * params.scale,
		scaleY: fitY * params.scale,
		centerX: width / 2 + params.offsetX * width,
		centerY: height / 2 + params.offsetY * height,
		cos: dirX / 4096,
		sin: -dirY / 4096,
	};
}

/**
 Premultiplied-alpha bilinear sample of `image` at `(ux, uy)`, in pixel-centre
 coordinates, with 1/256 pixel steps. Writes straight RGBA into `into`. Taps
 outside the image wrap when `tile` is set and clamp to the edge otherwise.
 */
export function sample(
	image: RgbaImage,
	ux: number,
	uy: number,
	tile: boolean,
	into: Int32Array,
): void {
	const {width, height, data} = image;
	const qx = Math.floor(ux * 256 + 0.5);
	const qy = Math.floor(uy * 256 + 0.5);
	let x0 = floorDiv(qx, 256);
	let y0 = floorDiv(qy, 256);
	const tx = qx - 256 * x0;
	const ty = qy - 256 * y0;
	let x1 = x0 + 1;
	let y1 = y0 + 1;
	if (tile) {
		x0 = wrap(x0, width);
		x1 = wrap(x1, width);
		y0 = wrap(y0, height);
		y1 = wrap(y1, height);
	} else {
		x0 = clamp(x0, 0, width - 1);
		x1 = clamp(x1, 0, width - 1);
		y0 = clamp(y0, 0, height - 1);
		y1 = clamp(y1, 0, height - 1);
	}

	const p00 = (y0 * width + x0) * 4;
	const p10 = (y0 * width + x1) * 4;
	const p01 = (y1 * width + x0) * 4;
	const p11 = (y1 * width + x1) * 4;
	// Weight times alpha of each tap. The weights sum to 65536.
	const a00 = (256 - tx) * (256 - ty) * data[p00 + 3];
	const a10 = tx * (256 - ty) * data[p10 + 3];
	const a01 = (256 - tx) * ty * data[p01 + 3];
	const a11 = tx * ty * data[p11 + 3];
	const sumA = a00 + a10 + a01 + a11;
	if (sumA === OPAQUE_SUM) {
		// All taps opaque: the general formulas reduce to a rounded shift.
		for (let c = 0; c < 3; c++) {
			const sum =
				(256 - tx) * ((256 - ty) * data[p00 + c] + ty * data[p01 + c]) +
				tx * ((256 - ty) * data[p10 + c] + ty * data[p11 + c]);
			into[c] = (sum + 32_768) >> 16;
		}

		into[3] = 255;
		return;
	}

	into[3] = floorDiv(2 * sumA + 65_536, 131_072);
	for (let c = 0; c < 3; c++) {
		const sum =
			a00 * data[p00 + c] +
			a10 * data[p10 + c] +
			a01 * data[p01 + c] +
			a11 * data[p11 + c];
		into[c] = sumA === 0 ? 0 : floorDiv(2 * sum + sumA, 2 * sumA);
	}
}

export const imageBlendEffect: EffectDefinition<ImageBlendParams> = {
	...imageBlendSpec,
	async render(input, output, params, ctx) {
		const {width, height, data: src} = input;
		const dst = output.data;
		const overlay =
			params.image === '' ? undefined : ctx.getSource(params.image);
		const placement =
			overlay && place(width, height, ctx.scale, overlay, params);
		const blend = BLEND_CHANNEL[params.blendMode];
		const opacity = Math.round(params.opacity * 100);
		const tile = params.fit === 'tile';
		const sampled = new Int32Array(4);
		const total = width * height;

		for (let start = 0; start < total; start += CHECKPOINT_PIXELS) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const end = Math.min(total, start + CHECKPOINT_PIXELS);
			// The base shows wherever the overlay leaves a pixel alone.
			dst.set(src.subarray(start * 4, end * 4), start * 4);
			if (overlay && placement) {
				const {scaleX, scaleY, centerX, centerY, cos, sin} = placement;
				for (let i = start; i < end; i++) {
					const dx = (i % width) + 0.5 - centerX;
					const dy = Math.floor(i / width) + 0.5 - centerY;
					const rx = dx * cos + dy * sin;
					const ry = -dx * sin + dy * cos;
					let ux = rx / scaleX + overlay.width / 2 - 0.5;
					let uy = ry / scaleY + overlay.height / 2 - 0.5;
					if (tile) {
						ux = wrap(ux, overlay.width);
						uy = wrap(uy, overlay.height);
					} else if (
						ux < -0.5 ||
						ux > overlay.width - 0.5 ||
						uy < -0.5 ||
						uy > overlay.height - 0.5
					) {
						continue;
					}

					sample(overlay, ux, uy, tile, sampled);
					const alpha = floorDiv(2 * sampled[3] * opacity + 100, 200);
					if (alpha === 0) {
						continue;
					}

					// W3C Compositing source-over with a separable blend mode, on
					// straight alpha. `outScaled` is the output alpha times 255.
					const p = i * 4;
					const baseAlpha = src[p + 3];
					if (alpha === 255 && baseAlpha === 255) {
						// Opaque over opaque is the blended colour itself.
						for (let c = 0; c < 3; c++) {
							dst[p + c] = blend(src[p + c], sampled[c]);
						}

						continue;
					}

					const outScaled = alpha * 255 + baseAlpha * (255 - alpha);
					for (let c = 0; c < 3; c++) {
						const base = src[p + c];
						const over = sampled[c];
						const premultiplied =
							alpha *
								((255 - baseAlpha) * over + baseAlpha * blend(base, over)) +
							baseAlpha * (255 - alpha) * base;
						dst[p + c] = floorDiv(2 * premultiplied + outScaled, 2 * outScaled);
					}

					dst[p + 3] = floorDiv(2 * outScaled + 255, 510);
				}
			}

			ctx.progress(end / total);
		}
	},
};

export {
	type ImageBlendFit,
	type ImageBlendMode,
	type ImageBlendParams,
} from './image-blend-spec.ts';
