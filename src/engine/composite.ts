import type {BlendMode, RgbaImage} from './types.ts';

function mixPercent(mix: number): number {
	const percent = Math.round(mix * 100);
	return Number.isNaN(percent) ? 100 : Math.min(Math.max(percent, 0), 100);
}

// MIXED[i * (100 - m) + b * m] is floorDiv(2 * (i * (100 - m) + b * m) + 100, 200),
// the formula of engine.md section 4.5. The index never exceeds 255 * 100, and
// a lookup is faster than a division per channel.
const MIXED = new Uint8Array(255 * 100 + 1);
for (let weighted = 0; weighted < MIXED.length; weighted++) {
	MIXED[weighted] = Math.floor((2 * weighted + 100) / 200);
}

// Replaces R, G and B of the effect result with the blended value of section 4.5.
function blendColours(
	from: Uint8ClampedArray,
	to: Uint8ClampedArray,
	blend: BlendMode,
	start: number,
	end: number,
): void {
	if (blend !== 'lighten' && blend !== 'darken' && blend !== 'difference') {
		return;
	}

	for (let p = start; p < end; p += 4) {
		for (let c = p; c < p + 3; c++) {
			to[c] =
				blend === 'lighten'
					? Math.max(from[c], to[c])
					: blend === 'darken'
						? Math.min(from[c], to[c])
						: Math.abs(from[c] - to[c]);
		}
	}
}

// 255 (mask) times 100 (mix).
const FULL_WEIGHT = 25_500;

// Section 4.5 with a mask: each pixel's weight is `m * mask`.
function compositeMasked(
	from: Uint8ClampedArray,
	to: Uint8ClampedArray,
	m: number,
	blend: BlendMode,
	mask: Uint8Array,
	start: number,
	end: number,
): void {
	blendColours(from, to, blend, start, end);
	for (let p = start; p < end; p += 4) {
		const weight = m * mask[p / 4];
		if (weight === FULL_WEIGHT) {
			continue;
		}

		const keep = FULL_WEIGHT - weight;
		for (let c = p; c < p + 4; c++) {
			to[c] = Math.floor(
				(2 * (from[c] * keep + to[c] * weight) + FULL_WEIGHT) /
					(2 * FULL_WEIGHT),
			);
		}
	}
}

/**
 Mixes rows `rowStart` (inclusive) to `rowEnd` (exclusive) of the effect
 result in `output` with the instance input in `input`, writing `output` in
 place (engine.md section 4.5). An unknown blend mode behaves as `normal`.
 `mask` holds one weight per pixel of the whole image; 0 keeps the input.
 */
export function compositeRows(
	input: RgbaImage,
	output: RgbaImage,
	mix: number,
	blend: BlendMode,
	rowStart: number,
	rowEnd: number,
	mask: Uint8Array | null = null,
): void {
	const m = mixPercent(mix);
	const keep = 100 - m;
	const from = input.data;
	const to = output.data;
	const start = rowStart * input.width * 4;
	const end = rowEnd * input.width * 4;

	if (m === 0) {
		to.set(from.subarray(start, end), start);
		return;
	}

	if (mask) {
		compositeMasked(from, to, m, blend, mask, start, end);
		return;
	}

	switch (blend) {
		case 'lighten': {
			for (let p = start; p < end; p += 4) {
				const r0 = from[p];
				const g0 = from[p + 1];
				const b0 = from[p + 2];
				const a0 = from[p + 3];
				const r1 = to[p];
				const g1 = to[p + 1];
				const b1 = to[p + 2];
				const a1 = to[p + 3];
				to[p] = MIXED[r0 * keep + Math.max(r0, r1) * m];
				to[p + 1] = MIXED[g0 * keep + Math.max(g0, g1) * m];
				to[p + 2] = MIXED[b0 * keep + Math.max(b0, b1) * m];
				to[p + 3] = MIXED[a0 * keep + a1 * m];
			}

			break;
		}

		case 'darken': {
			for (let p = start; p < end; p += 4) {
				const r0 = from[p];
				const g0 = from[p + 1];
				const b0 = from[p + 2];
				const a0 = from[p + 3];
				const r1 = to[p];
				const g1 = to[p + 1];
				const b1 = to[p + 2];
				const a1 = to[p + 3];
				to[p] = MIXED[r0 * keep + Math.min(r0, r1) * m];
				to[p + 1] = MIXED[g0 * keep + Math.min(g0, g1) * m];
				to[p + 2] = MIXED[b0 * keep + Math.min(b0, b1) * m];
				to[p + 3] = MIXED[a0 * keep + a1 * m];
			}

			break;
		}

		case 'difference': {
			for (let p = start; p < end; p += 4) {
				const r0 = from[p];
				const g0 = from[p + 1];
				const b0 = from[p + 2];
				const a0 = from[p + 3];
				const r1 = to[p];
				const g1 = to[p + 1];
				const b1 = to[p + 2];
				const a1 = to[p + 3];
				to[p] = MIXED[r0 * keep + Math.abs(r0 - r1) * m];
				to[p + 1] = MIXED[g0 * keep + Math.abs(g0 - g1) * m];
				to[p + 2] = MIXED[b0 * keep + Math.abs(b0 - b1) * m];
				to[p + 3] = MIXED[a0 * keep + a1 * m];
			}

			break;
		}

		default: {
			if (m < 100) {
				for (let p = start; p < end; p++) {
					to[p] = MIXED[from[p] * keep + to[p] * m];
				}
			}
		}
	}
}

// `compositeRows` over the whole image. Returns `output`.
export function composite(
	input: RgbaImage,
	output: RgbaImage,
	mix: number,
	blend: BlendMode,
	mask: Uint8Array | null = null,
): RgbaImage {
	compositeRows(input, output, mix, blend, 0, input.height, mask);
	return output;
}
