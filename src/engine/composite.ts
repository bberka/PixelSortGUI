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

/**
 Mixes rows `rowStart` (inclusive) to `rowEnd` (exclusive) of the effect
 result in `output` with the instance input in `input`, writing `output` in
 place (engine.md section 4.5). An unknown blend mode behaves as `normal`.
 */
export function compositeRows(
	input: RgbaImage,
	output: RgbaImage,
	mix: number,
	blend: BlendMode,
	rowStart: number,
	rowEnd: number,
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
): RgbaImage {
	compositeRows(input, output, mix, blend, 0, input.height);
	return output;
}
