// Deterministic brush painting on a mask grid (engine.md section 16.6).

import {floorDiv, roundHalfAway} from '../math.ts';
import type {BrushSample, BrushStroke, MaskRect} from './brush-types.ts';
import type {MaskBitmap} from './types.ts';

export type MaskEdit = {
	bitmap: MaskBitmap;
	// False when no byte differs, so there is nothing to commit.
	changed: boolean;
};

export function createMask(
	width: number,
	height: number,
	value = 0,
): MaskBitmap {
	const data = new Uint8Array(width * height);
	if (value !== 0) {
		data.fill(value);
	}

	return {width, height, data};
}

// The dabs after `previous` up to and including `next`.
export function placeDabs(
	previous: BrushSample | undefined,
	next: BrushSample,
): BrushSample[] {
	if (previous === undefined) {
		return [next];
	}

	const sx = Math.max(16, floorDiv(Math.min(previous.rx, next.rx), 4));
	const sy = Math.max(16, floorDiv(Math.min(previous.ry, next.ry), 4));
	const n = Math.max(
		1,
		floorDiv(Math.abs(next.x - previous.x) + sx - 1, sx),
		floorDiv(Math.abs(next.y - previous.y) + sy - 1, sy),
	);
	return Array.from({length: n}, (_, index) => {
		const at = (key: keyof BrushSample): number =>
			previous[key] +
			roundHalfAway(((next[key] - previous[key]) * (index + 1)) / n);
		return {x: at('x'), y: at('y'), rx: at('rx'), ry: at('ry')};
	});
}

/**
 Raises `cover`, the stroke's coverage buffer, to at least this dab's value at
 each pixel. Returns the clipped bounding box it visited, or undefined when the
 dab misses the grid.
 */
export function stampDab(
	cover: MaskBitmap,
	{x, y, rx, ry}: BrushSample,
	hardness: number,
): MaskRect | undefined {
	const {width, height, data} = cover;
	const left = Math.max(0, floorDiv(x - rx - 8, 16));
	const top = Math.max(0, floorDiv(y - ry - 8, 16));
	const right = Math.min(width - 1, floorDiv(x + rx - 8, 16));
	const bottom = Math.min(height - 1, floorDiv(y + ry - 8, 16));
	if (left > right || top > bottom) {
		return undefined;
	}

	const h = hardness / 100;
	// Leaves about one mask pixel of soft edge on a hard brush.
	const h2 = Math.min(h * h, Math.max(0, 1 - 32 / Math.max(rx, ry)));
	for (let py = top; py <= bottom; py++) {
		const dv = (16 * py + 8 - y) / ry;
		for (let px = left; px <= right; px++) {
			const du = (16 * px + 8 - x) / rx;
			const q = du * du + dv * dv;
			if (q >= 1) {
				continue;
			}

			const u = q <= h2 ? 1 : (1 - q) / (1 - h2);
			const a = Math.floor(u * u * (3 - 2 * u) * 255 + 0.5);
			const p = py * width + px;
			if (a > data[p]) {
				data[p] = a;
			}
		}
	}

	return {x: left, y: top, width: right - left + 1, height: bottom - top + 1};
}

/**
 Writes into `target` the pixels of `rect` as `base` with the stroke's coverage
 applied. It always starts from `base`, so applying again as `cover` grows never
 builds up. Returns whether any pixel of `rect` differs from `base`.
 */
export function applyStroke(
	base: MaskBitmap,
	cover: MaskBitmap,
	{mode, strength}: BrushStroke,
	target: MaskBitmap,
	rect: MaskRect = {x: 0, y: 0, width: base.width, height: base.height},
): boolean {
	const s = floorDiv(510 * strength + 100, 200);
	let changed = false;
	for (let py = rect.y; py < rect.y + rect.height; py++) {
		const end = py * base.width + rect.x + rect.width;
		for (let p = end - rect.width; p < end; p++) {
			const b = base.data[p];
			const c = floorDiv(2 * cover.data[p] * s + 255, 510);
			const m =
				mode === 'paint'
					? b + floorDiv(2 * (255 - b) * c + 255, 510)
					: b - floorDiv(2 * b * c + 255, 510);
			target.data[p] = m;
			changed ||= m !== b;
		}
	}

	return changed;
}

// One whole stroke, from press to release, on a copy of `base`.
export function paintStroke(
	base: MaskBitmap,
	stroke: BrushStroke,
	samples: readonly BrushSample[],
): MaskEdit {
	const cover = createMask(base.width, base.height);
	let previous: BrushSample | undefined;
	for (const sample of samples) {
		for (const dab of placeDabs(previous, sample)) {
			stampDab(cover, dab, stroke.hardness);
		}

		previous = sample;
	}

	const bitmap = createMask(base.width, base.height);
	const changed = applyStroke(base, cover, stroke, bitmap);
	return {bitmap, changed};
}

// Every byte 255.
export function fillMask({width, height, data}: MaskBitmap): MaskEdit {
	return {
		bitmap: createMask(width, height, 255),
		changed: data.some((value) => value !== 255),
	};
}

// Every byte 0. A cleared mask is stored as `asset: ''`, not as an asset.
export function clearMask({width, height, data}: MaskBitmap): MaskEdit {
	return {
		bitmap: createMask(width, height),
		changed: data.some((value) => value !== 0),
	};
}
