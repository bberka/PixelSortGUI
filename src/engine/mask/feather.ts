import {blurColumns, blurRow, type Pace} from '../blur.ts';

const PASSES = 2;

/**
 Feathers `mask` in place (engine.md section 16.6): two box blurs of `radius`,
 each horizontal then vertical, coordinates clamped to the image. `spare` holds
 `width * height` bytes and is overwritten.
 */
export async function featherMask(
	mask: Uint8Array,
	spare: Uint8Array,
	width: number,
	height: number,
	radius: number,
	pace: Pace,
): Promise<void> {
	if (radius <= 0) {
		return;
	}

	const sums = new Int32Array(width);
	for (let pass = 0; pass < PASSES; pass++) {
		for (let y = 0; y < height; y++) {
			const pending = pace(width);
			if (pending) {
				await pending;
			}

			blurRow(mask, spare, y * width, width, radius);
		}

		await blurColumns(spare, mask, width, height, radius, sums, pace);
	}
}
