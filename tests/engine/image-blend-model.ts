/**
 The placement, sampling and compositing rules of engine.md section 16.5 written
 out one formula at a time, with no shortcuts, as an oracle for `imageBlend`.
 The blend functions are passed in; their own test covers every channel pair.
 */
import {DIRECTION_TABLE} from '../../src/engine/direction-table.ts';
import type {ImageBlendParams} from '../../src/engine/effects/image-blend.ts';
import {
	copyImage,
	type ExtraSource,
	type RgbaImage,
} from '../../src/engine/types.ts';

const mod = (v: number, n: number) => ((v % n) + n) % n;

export function modelImageBlend(
	base: RgbaImage,
	overlay: ExtraSource,
	params: Omit<ImageBlendParams, 'image'>,
	sourceWidth: number,
	blend: (i: number, f: number) => number,
): RgbaImage {
	const {width: W, height: H} = base;
	const {width: Ow, height: Oh} = overlay;
	const scale = W / sourceWidth;
	const original: [number, number] = [
		(scale * overlay.sourceWidth) / Ow,
		(scale * overlay.sourceHeight) / Oh,
	];
	const fits: Record<ImageBlendParams['fit'], [number, number]> = {
		cover: [Math.max(W / Ow, H / Oh), Math.max(W / Ow, H / Oh)],
		contain: [Math.min(W / Ow, H / Oh), Math.min(W / Ow, H / Oh)],
		stretch: [W / Ow, H / Oh],
		tile: original,
		none: original,
	};
	const sx = fits[params.fit][0] * params.scale;
	const sy = fits[params.fit][1] * params.scale;
	const cx = W / 2 + params.offsetX * W;
	const cy = H / 2 + params.offsetY * H;
	const [DX, DY] = DIRECTION_TABLE[mod(Math.round(params.rotation * 10), 3600)];
	const cos = DX / 4096;
	const sin = -DY / 4096;
	const tile = params.fit === 'tile';
	const op = Math.round(params.opacity * 100);
	const result = copyImage(base);

	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const dx = x + 0.5 - cx;
			const dy = y + 0.5 - cy;
			const rx = dx * cos + dy * sin;
			const ry = -dx * sin + dy * cos;
			let ux = rx / sx + Ow / 2 - 0.5;
			let uy = ry / sy + Oh / 2 - 0.5;
			if (tile) {
				ux = mod(ux, Ow);
				uy = mod(uy, Oh);
			} else if (ux < -0.5 || ux > Ow - 0.5 || uy < -0.5 || uy > Oh - 0.5) {
				continue;
			}

			const qx = Math.floor(ux * 256 + 0.5);
			const qy = Math.floor(uy * 256 + 0.5);
			const x0 = Math.floor(qx / 256);
			const y0 = Math.floor(qy / 256);
			const tx = qx - 256 * x0;
			const ty = qy - 256 * y0;
			const index = (v: number, n: number) =>
				tile ? mod(v, n) : Math.min(Math.max(v, 0), n - 1);
			const taps = [
				{x: x0, y: y0, w: (256 - tx) * (256 - ty)},
				{x: x0 + 1, y: y0, w: tx * (256 - ty)},
				{x: x0, y: y0 + 1, w: (256 - tx) * ty},
				{x: x0 + 1, y: y0 + 1, w: tx * ty},
			].map((tap) => {
				const p = (index(tap.y, Oh) * Ow + index(tap.x, Ow)) * 4;
				return {w: tap.w, rgba: overlay.data.subarray(p, p + 4)};
			});
			let sumA = 0;
			for (const {w, rgba} of taps) {
				sumA += w * rgba[3];
			}

			const sA = Math.floor((2 * sumA + 65_536) / 131_072);
			const sample = [0, 1, 2].map((c) => {
				let sum = 0;
				for (const {w, rgba} of taps) {
					sum += w * rgba[3] * rgba[c];
				}

				return sumA === 0 ? 0 : Math.floor((2 * sum + sumA) / (2 * sumA));
			});

			const effA = Math.floor((2 * sA * op + 100) / 200);
			if (effA === 0) {
				continue;
			}

			const p = (y * W + x) * 4;
			const iA = base.data[p + 3];
			const outNum = effA * 255 + iA * (255 - effA);
			for (let c = 0; c < 3; c++) {
				const iC = base.data[p + c];
				const premul =
					effA * ((255 - iA) * sample[c] + iA * blend(iC, sample[c])) +
					iA * (255 - effA) * iC;
				result.data[p + c] = Math.floor((2 * premul + outNum) / (2 * outNum));
			}

			result.data[p + 3] = Math.floor((2 * outNum + 255) / 510);
		}
	}

	return result;
}
