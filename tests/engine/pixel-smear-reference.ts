/**
 The line-by-line `pixelSmear` walk, one pixel at a time over the offsets of the
 line partition: the reference for the row-order path at 90 and 270 degrees.
 */
import type {PixelSmearParams} from '../../src/engine/effects/pixel-smear.ts';
import {
	fillKeys,
	thresholdBound,
} from '../../src/engine/effects/pixel-sort/select.ts';
import {createLinePartition} from '../../src/engine/lines.ts';
import {createImage, type RgbaImage} from '../../src/engine/types.ts';

// Engine.md section 16.1: the decay blend, `d` in thousandths.
function blend(carry: number[], rgb: number[], d: number): number[] {
	return rgb.map((v, c) =>
		Math.floor((2 * (carry[c] * d + v * (1000 - d)) + 1000) / 2000),
	);
}

export function modelPixelSmear(
	input: RgbaImage,
	params: PixelSmearParams,
	trail: number,
): RgbaImage {
	const {width, height, data} = input;
	const output = createImage(width, height);
	output.data.set(data);
	const keys = new Uint16Array(width * height);
	fillKeys(params.selectKey, new Uint8Array(data), 0, width * height, keys);
	const lo16 = thresholdBound(params.threshold[0]);
	const hi16 = thresholdBound(params.threshold[1]);
	const d = Math.round(params.decay * 1000);
	const partition = createLinePartition(width, height, params.angle, {
		disableFastPath: true,
	});
	const offsets = new Int32Array(partition.maxLineLength);
	const walker = partition.createWalker();
	while (walker.next()) {
		const length = walker.fillOffsets(offsets);
		let carry = [0, 0, 0];
		let remaining = 0;
		for (const at of offsets.subarray(0, length)) {
			const rgb = [...data.subarray(4 * at, 4 * at + 3)];
			const visible = data[4 * at + 3] > 0;
			const inBand = keys[at] >= lo16 && keys[at] <= hi16;
			if (visible && inBand !== params.invert) {
				carry = rgb;
				remaining = trail;
			} else if (visible && remaining > 0) {
				carry = blend(carry, rgb, d);
				output.data.set(carry, 4 * at);
				remaining--;
			}
		}
	}

	return output;
}
