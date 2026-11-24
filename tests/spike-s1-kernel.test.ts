import {describe, expect, it} from 'vite-plus/test';
import {
	computeAngle30Offsets,
	KernelScratch,
	lumaKey16,
	pixelSortKernel,
} from '../spikes/s1/kernel.ts';
import {generateSyntheticPhoto} from '../spikes/s1/synthetic.ts';

describe('spike s1 pixelSort kernel', () => {
	it('computes exact Rec. 709 lumaKey16 per engine.md section 5.3', () => {
		expect(lumaKey16(0, 0, 0)).toBe(0);
		expect(lumaKey16(255, 255, 255)).toBe(65_535);
		expect(lumaKey16(255, 0, 0)).toBe(
			Math.floor((2126 * 255 * 131_070 + 2_550_000) / 5_100_000),
		);
		expect(lumaKey16(0, 255, 0)).toBe(
			Math.floor((7152 * 255 * 131_070 + 2_550_000) / 5_100_000),
		);
		expect(lumaKey16(0, 0, 255)).toBe(
			Math.floor((722 * 255 * 131_070 + 2_550_000) / 5_100_000),
		);
	});

	it('visits every pixel exactly once in the angle 30 integer line partition', () => {
		const width = 97;
		const height = 61;
		const offsets = computeAngle30Offsets(width);
		const visited = new Uint8Array(width * height);

		let xStart = 0;
		let xEnd = -1;
		for (let k = -offsets[0]; k <= height - 1 - offsets[width - 1]; k++) {
			while (xStart < width && k + offsets[xStart] >= height) {
				xStart++;
			}

			while (xEnd + 1 < width && k + offsets[xEnd + 1] >= 0) {
				xEnd++;
			}

			for (let x = xStart; x <= xEnd; x++) {
				const y = k + offsets[x];
				expect(y).toBeGreaterThanOrEqual(0);
				expect(y).toBeLessThan(height);
				visited[y * width + x]++;
			}
		}

		for (const count of visited) {
			expect(count).toBe(1);
		}
	});

	it('produces bit-exact identical output for typed-array and radix-16 at angle 0 and 30', async () => {
		const width = 128;
		const height = 96;
		const input = generateSyntheticPhoto(width, height, 12_345);
		const scratch = new KernelScratch(Math.max(width, height));

		for (const angle of [0, 30] as const) {
			const outTyped = new Uint8ClampedArray(
				new ArrayBuffer(width * height * 4),
			);
			const outRadix = new Uint8ClampedArray(
				new ArrayBuffer(width * height * 4),
			);

			await pixelSortKernel(
				input,
				outTyped,
				width,
				height,
				{angle, algorithm: 'typed-array'},
				scratch,
			);
			await pixelSortKernel(
				input,
				outRadix,
				width,
				height,
				{angle, algorithm: 'radix-16'},
				scratch,
			);

			expect(outRadix).toEqual(outTyped);

			const inSorted = new Uint32Array(
				input.buffer,
				input.byteOffset,
				input.byteLength / 4,
			)
				.slice()
				.toSorted();
			const outSorted = new Uint32Array(
				outRadix.buffer,
				outRadix.byteOffset,
				outRadix.byteLength / 4,
			)
				.slice()
				.toSorted();
			expect(outSorted).toEqual(inSorted);
		}
	});
});
