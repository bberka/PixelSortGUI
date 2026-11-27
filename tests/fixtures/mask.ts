import type {MaskBitmap} from '../../src/engine/mask/types.ts';
import {floorDiv} from '../../src/engine/math.ts';
import {hash32} from '../../src/engine/random.ts';

export type MaskFixtureName = 'shapes';

const SEED_SHAPES = 0x50_05;

/**
 A painted grid of any size with every kind of value: a soft disc on the left, a
 hard rectangle on the right, a speckled strip along the bottom and 0 elsewhere.
 */
function shapes(width: number, height: number): MaskBitmap {
	const data = new Uint8Array(width * height);
	const cx = floorDiv(width, 3);
	const cy = floorDiv(height, 2);
	const radius = Math.max(1, floorDiv(Math.min(width, height), 2) - 2);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const squared = (x - cx) ** 2 + (y - cy) ** 2;
			if (y >= height - floorDiv(height, 8)) {
				data[i] = hash32(SEED_SHAPES, x, y) % 256;
			} else if (squared < radius ** 2) {
				data[i] = 255 - floorDiv(255 * squared, radius ** 2);
			} else if (
				x >= floorDiv(width * 2, 3) &&
				x < width - 4 &&
				y >= floorDiv(height, 6) &&
				y < floorDiv(height * 2, 3)
			) {
				data[i] = 255;
			}
		}
	}

	return {width, height, data};
}

export function getMaskFixture(
	name: MaskFixtureName,
	width: number,
	height: number,
): MaskBitmap {
	switch (name) {
		case 'shapes': {
			return shapes(width, height);
		}
	}
}
