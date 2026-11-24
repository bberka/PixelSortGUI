/* eslint-disable no-bitwise -- Bit-packed 32-bit sort keys and radix bucket indexing */
export type SortAlgorithm = 'typed-array' | 'radix-16' | 'counting-8';

export type SortAngle = 0 | 30;

export type PixelSortOptions = {
	angle: SortAngle;
	algorithm: SortAlgorithm;
	thresholdLow?: number;
	thresholdHigh?: number;
	collectBreakdown?: boolean;
	checkpoint?: () => void | Promise<void>;
};

export type PhaseBreakdown = {
	gatherMs: number;
	keySelectMs: number;
	sortMs: number;
	scatterMs: number;
};

export type PixelSortStats = {
	selectedPixels: number;
	totalPixels: number;
	selectedFraction: number;
	runCount: number;
	meanRunLength: number;
	p50RunLength: number;
	p95RunLength: number;
	maxRunLength: number;
};

export type PixelSortResult = {
	breakdown?: PhaseBreakdown;
};

// Exact direction vector for angle 30.0 deg per engine.md section 5.2:
// DX = roundHalfAway(4096 * cos(30 deg)) = 3547
// DY = roundHalfAway(-4096 * sin(30 deg)) = -2048
export const ANGLE_30_DX = 3547;
export const ANGLE_30_DY = -2048;

const CHECKPOINT_PIXEL_INTERVAL = 16_384;
const TYPED_ARRAY_INSERTION_CUTOFF = 24;
const RADIX_INSERTION_CUTOFF = 32;
const COUNTING_INSERTION_CUTOFF = 24;

export function lumaKey16(r: number, g: number, b: number): number {
	const y = 2126 * r + 7152 * g + 722 * b;
	return Math.floor((y * 131_070 + 2_550_000) / 5_100_000);
}

export function computeAngle30Offsets(width: number): Int32Array {
	const offsets = new Int32Array(width);
	const denom = 2 * ANGLE_30_DX;
	for (let x = 0; x < width; x++) {
		offsets[x] = Math.floor((2 * x * ANGLE_30_DY + ANGLE_30_DX) / denom);
	}

	return offsets;
}

function insertionSortUint32(array: Uint32Array, length: number): void {
	for (let i = 1; i < length; i++) {
		const value = array[i];
		let j = i - 1;
		while (j >= 0 && array[j] > value) {
			array[j + 1] = array[j];
			j--;
		}

		array[j + 1] = value;
	}
}

export class KernelScratch {
	linePixels: Uint32Array;
	lineBytes: Uint8Array;
	lineSorted: Uint32Array;
	lineKeys: Uint16Array;
	lineSelected: Uint8Array;
	packed: Uint32Array;
	radixTmp: Uint32Array;
	counts: Int32Array;

	constructor(maxLineLength: number) {
		this.linePixels = new Uint32Array(maxLineLength);
		this.lineBytes = new Uint8Array(
			this.linePixels.buffer,
			this.linePixels.byteOffset,
			this.linePixels.byteLength,
		);
		this.lineSorted = new Uint32Array(maxLineLength);
		this.lineKeys = new Uint16Array(maxLineLength);
		this.lineSelected = new Uint8Array(maxLineLength);
		this.packed = new Uint32Array(maxLineLength);
		this.radixTmp = new Uint32Array(maxLineLength);
		this.counts = new Int32Array(256);
	}

	ensureCapacity(maxLineLength: number): void {
		if (this.linePixels.length >= maxLineLength) {
			return;
		}

		this.linePixels = new Uint32Array(maxLineLength);
		this.lineBytes = new Uint8Array(
			this.linePixels.buffer,
			this.linePixels.byteOffset,
			this.linePixels.byteLength,
		);
		this.lineSorted = new Uint32Array(maxLineLength);
		this.lineKeys = new Uint16Array(maxLineLength);
		this.lineSelected = new Uint8Array(maxLineLength);
		this.packed = new Uint32Array(maxLineLength);
		this.radixTmp = new Uint32Array(maxLineLength);
	}
}

function sortRunTypedArray(
	linePixels: Uint32Array,
	lineKeys: Uint16Array,
	outPixels: Uint32Array,
	outBaseOffset: number,
	start: number,
	length: number,
	packed: Uint32Array,
): void {
	for (let i = 0; i < length; i++) {
		packed[i] = ((lineKeys[start + i] << 16) | i) >>> 0;
	}

	if (length <= TYPED_ARRAY_INSERTION_CUTOFF) {
		insertionSortUint32(packed, length);
	} else {
		packed.subarray(0, length).sort();
	}

	for (let i = 0; i < length; i++) {
		outPixels[outBaseOffset + i] = linePixels[start + (packed[i] & 0xff_ff)];
	}
}

function sortRunRadix16(
	linePixels: Uint32Array,
	lineKeys: Uint16Array,
	outPixels: Uint32Array,
	outBaseOffset: number,
	start: number,
	length: number,
	packed: Uint32Array,
	tmp: Uint32Array,
	counts: Int32Array,
): void {
	for (let i = 0; i < length; i++) {
		packed[i] = ((lineKeys[start + i] << 16) | i) >>> 0;
	}

	if (length <= RADIX_INSERTION_CUTOFF) {
		insertionSortUint32(packed, length);
	} else {
		// Pass 1: low 8 bits of key16 (bits 16..23)
		counts.fill(0);
		for (let i = 0; i < length; i++) {
			counts[(packed[i] >>> 16) & 0xff]++;
		}

		let sum = 0;
		for (let b = 0; b < 256; b++) {
			const c = counts[b];
			counts[b] = sum;
			sum += c;
		}

		for (let i = 0; i < length; i++) {
			const v = packed[i];
			const bucket = (v >>> 16) & 0xff;
			tmp[counts[bucket]++] = v;
		}

		// Pass 2: high 8 bits of key16 (bits 24..31)
		counts.fill(0);
		for (let i = 0; i < length; i++) {
			counts[tmp[i] >>> 24]++;
		}

		sum = 0;
		for (let b = 0; b < 256; b++) {
			const c = counts[b];
			counts[b] = sum;
			sum += c;
		}

		for (let i = 0; i < length; i++) {
			const v = tmp[i];
			const bucket = v >>> 24;
			packed[counts[bucket]++] = v;
		}
	}

	for (let i = 0; i < length; i++) {
		outPixels[outBaseOffset + i] = linePixels[start + (packed[i] & 0xff_ff)];
	}
}

function sortRunCounting8(
	linePixels: Uint32Array,
	lineKeys: Uint16Array,
	outPixels: Uint32Array,
	outBaseOffset: number,
	start: number,
	length: number,
	packed: Uint32Array,
	counts: Int32Array,
): void {
	if (length <= COUNTING_INSERTION_CUTOFF) {
		for (let i = 0; i < length; i++) {
			packed[i] = (((lineKeys[start + i] >>> 8) << 16) | i) >>> 0;
		}

		insertionSortUint32(packed, length);
		for (let i = 0; i < length; i++) {
			outPixels[outBaseOffset + i] = linePixels[start + (packed[i] & 0xff_ff)];
		}

		return;
	}

	counts.fill(0);
	for (let i = 0; i < length; i++) {
		counts[lineKeys[start + i] >>> 8]++;
	}

	let sum = 0;
	for (let b = 0; b < 256; b++) {
		const c = counts[b];
		counts[b] = sum;
		sum += c;
	}

	for (let i = 0; i < length; i++) {
		const bucket = lineKeys[start + i] >>> 8;
		outPixels[outBaseOffset + counts[bucket]++] = linePixels[start + i];
	}
}

function sortSelectedRuns(
	algorithm: SortAlgorithm,
	linePixels: Uint32Array,
	lineKeys: Uint16Array,
	lineSelected: Uint8Array,
	outPixels: Uint32Array,
	outBaseOffset: number,
	lineLength: number,
	scratch: KernelScratch,
): void {
	const {packed, radixTmp, counts} = scratch;
	let i = 0;
	while (i < lineLength) {
		if (lineSelected[i] === 0) {
			outPixels[outBaseOffset + i] = linePixels[i];
			i++;
			continue;
		}

		const start = i;
		i++;
		while (i < lineLength && lineSelected[i] === 1) {
			i++;
		}

		const runLen = i - start;
		if (runLen === 1) {
			outPixels[outBaseOffset + start] = linePixels[start];
			continue;
		}

		if (algorithm === 'typed-array') {
			sortRunTypedArray(
				linePixels,
				lineKeys,
				outPixels,
				outBaseOffset + start,
				start,
				runLen,
				packed,
			);
		} else if (algorithm === 'radix-16') {
			sortRunRadix16(
				linePixels,
				lineKeys,
				outPixels,
				outBaseOffset + start,
				start,
				runLen,
				packed,
				radixTmp,
				counts,
			);
		} else {
			sortRunCounting8(
				linePixels,
				lineKeys,
				outPixels,
				outBaseOffset + start,
				start,
				runLen,
				packed,
				counts,
			);
		}
	}
}

export async function pixelSortKernel(
	input: Uint8ClampedArray,
	output: Uint8ClampedArray,
	width: number,
	height: number,
	options: PixelSortOptions,
	scratch: KernelScratch,
): Promise<PixelSortResult> {
	const {
		angle,
		algorithm,
		thresholdLow = 0.25,
		thresholdHigh = 0.8,
		collectBreakdown = false,
		checkpoint,
	} = options;

	const lo16 = Math.floor(thresholdLow * 65_535 + 0.5);
	const hi16 = Math.floor(thresholdHigh * 65_535 + 0.5);
	const maxLineLen = Math.max(width, height);
	scratch.ensureCapacity(maxLineLen);

	const in32 = new Uint32Array(input.buffer, input.byteOffset, width * height);
	const out32 = new Uint32Array(
		output.buffer,
		output.byteOffset,
		width * height,
	);

	const {linePixels, lineBytes, lineSorted, lineKeys, lineSelected} = scratch;

	let gatherMs = 0;
	let keySelectMs = 0;
	let sortMs = 0;
	let scatterMs = 0;
	let pixelsSinceCheckpoint = 0;

	if (angle === 0) {
		for (let y = 0; y < height; y++) {
			const rowPixelOffset = y * width;
			const rowByteOffset = rowPixelOffset * 4;

			let t0 = collectBreakdown ? performance.now() : 0;
			linePixels.set(in32.subarray(rowPixelOffset, rowPixelOffset + width), 0);
			let t1 = collectBreakdown ? performance.now() : 0;
			if (collectBreakdown) {
				gatherMs += t1 - t0;
				t0 = t1;
			}

			let byteIdx = rowByteOffset;
			for (let x = 0; x < width; x++) {
				const a = input[byteIdx + 3];
				if (a === 0) {
					lineSelected[x] = 0;
				} else {
					const k = lumaKey16(
						input[byteIdx],
						input[byteIdx + 1],
						input[byteIdx + 2],
					);
					lineKeys[x] = k;
					lineSelected[x] = k >= lo16 && k <= hi16 ? 1 : 0;
				}

				byteIdx += 4;
			}

			if (collectBreakdown) {
				t1 = performance.now();
				keySelectMs += t1 - t0;
				t0 = t1;
			}

			sortSelectedRuns(
				algorithm,
				linePixels,
				lineKeys,
				lineSelected,
				lineSorted,
				0,
				width,
				scratch,
			);

			if (collectBreakdown) {
				t1 = performance.now();
				sortMs += t1 - t0;
				t0 = t1;
			}

			out32.set(lineSorted.subarray(0, width), rowPixelOffset);

			if (collectBreakdown) {
				scatterMs += performance.now() - t0;
			}

			pixelsSinceCheckpoint += width;
			if (!checkpoint || pixelsSinceCheckpoint < CHECKPOINT_PIXEL_INTERVAL) {
				continue;
			}

			pixelsSinceCheckpoint = 0;
			const maybePromise = checkpoint();
			if (maybePromise) {
				await maybePromise;
			}
		}
	} else {
		const offsets = computeAngle30Offsets(width);
		const minO = offsets[width - 1];
		const maxO = offsets[0];
		const kStart = -maxO;
		const kEnd = height - 1 - minO;

		let xStart = 0;
		let xEnd = -1;

		for (let k = kStart; k <= kEnd; k++) {
			while (xStart < width && k + offsets[xStart] >= height) {
				xStart++;
			}

			while (xEnd + 1 < width && k + offsets[xEnd + 1] >= 0) {
				xEnd++;
			}

			const lineLen = xEnd - xStart + 1;
			if (lineLen <= 0) {
				continue;
			}

			let t0 = collectBreakdown ? performance.now() : 0;
			for (let i = 0; i < lineLen; i++) {
				const x = xStart + i;
				const y = k + offsets[x];
				linePixels[i] = in32[y * width + x];
			}

			let t1 = collectBreakdown ? performance.now() : 0;
			if (collectBreakdown) {
				gatherMs += t1 - t0;
				t0 = t1;
			}

			let byteIdx = 0;
			for (let i = 0; i < lineLen; i++) {
				const a = lineBytes[byteIdx + 3];
				if (a === 0) {
					lineSelected[i] = 0;
				} else {
					const key = lumaKey16(
						lineBytes[byteIdx],
						lineBytes[byteIdx + 1],
						lineBytes[byteIdx + 2],
					);
					lineKeys[i] = key;
					lineSelected[i] = key >= lo16 && key <= hi16 ? 1 : 0;
				}

				byteIdx += 4;
			}

			if (collectBreakdown) {
				t1 = performance.now();
				keySelectMs += t1 - t0;
				t0 = t1;
			}

			sortSelectedRuns(
				algorithm,
				linePixels,
				lineKeys,
				lineSelected,
				lineSorted,
				0,
				lineLen,
				scratch,
			);

			if (collectBreakdown) {
				t1 = performance.now();
				sortMs += t1 - t0;
				t0 = t1;
			}

			for (let i = 0; i < lineLen; i++) {
				const x = xStart + i;
				const y = k + offsets[x];
				out32[y * width + x] = lineSorted[i];
			}

			if (collectBreakdown) {
				scatterMs += performance.now() - t0;
			}

			pixelsSinceCheckpoint += lineLen;
			if (!checkpoint || pixelsSinceCheckpoint < CHECKPOINT_PIXEL_INTERVAL) {
				continue;
			}

			pixelsSinceCheckpoint = 0;
			const maybePromise = checkpoint();
			if (maybePromise) {
				await maybePromise;
			}
		}
	}

	if (collectBreakdown) {
		return {
			breakdown: {
				gatherMs,
				keySelectMs,
				sortMs,
				scatterMs,
			},
		};
	}

	return {};
}

export function analyzeImageRuns(
	input: Uint8ClampedArray,
	width: number,
	height: number,
	angle: SortAngle,
	thresholdLow = 0.25,
	thresholdHigh = 0.8,
): PixelSortStats {
	const lo16 = Math.floor(thresholdLow * 65_535 + 0.5);
	const hi16 = Math.floor(thresholdHigh * 65_535 + 0.5);
	const runLengths: number[] = [];
	let selectedPixels = 0;

	if (angle === 0) {
		for (let y = 0; y < height; y++) {
			let currentRun = 0;
			let byteIdx = y * width * 4;
			for (let x = 0; x < width; x++) {
				const a = input[byteIdx + 3];
				const selected =
					a !== 0 &&
					(() => {
						const k = lumaKey16(
							input[byteIdx],
							input[byteIdx + 1],
							input[byteIdx + 2],
						);
						return k >= lo16 && k <= hi16;
					})();
				if (selected) {
					selectedPixels++;
					currentRun++;
				} else if (currentRun > 0) {
					runLengths.push(currentRun);
					currentRun = 0;
				}

				byteIdx += 4;
			}

			if (currentRun > 0) {
				runLengths.push(currentRun);
			}
		}
	} else {
		const offsets = computeAngle30Offsets(width);
		const minO = offsets[width - 1];
		const maxO = offsets[0];
		let xStart = 0;
		let xEnd = -1;

		for (let k = -maxO; k <= height - 1 - minO; k++) {
			while (xStart < width && k + offsets[xStart] >= height) {
				xStart++;
			}

			while (xEnd + 1 < width && k + offsets[xEnd + 1] >= 0) {
				xEnd++;
			}

			let currentRun = 0;
			for (let x = xStart; x <= xEnd; x++) {
				const y = k + offsets[x];
				const byteIdx = (y * width + x) * 4;
				const a = input[byteIdx + 3];
				const selected =
					a !== 0 &&
					(() => {
						const key = lumaKey16(
							input[byteIdx],
							input[byteIdx + 1],
							input[byteIdx + 2],
						);
						return key >= lo16 && key <= hi16;
					})();
				if (selected) {
					selectedPixels++;
					currentRun++;
				} else if (currentRun > 0) {
					runLengths.push(currentRun);
					currentRun = 0;
				}
			}

			if (currentRun > 0) {
				runLengths.push(currentRun);
			}
		}
	}

	runLengths.sort((a, b) => a - b);
	const totalPixels = width * height;
	const runCount = runLengths.length;
	const meanRunLength = runCount > 0 ? selectedPixels / runCount : 0;
	const p50RunLength =
		runCount > 0 ? runLengths[Math.floor((runCount - 1) * 0.5)] : 0;
	const p95RunLength =
		runCount > 0 ? runLengths[Math.floor((runCount - 1) * 0.95)] : 0;
	const maxRunLength = runCount > 0 ? runLengths[runCount - 1] : 0;

	return {
		selectedPixels,
		totalPixels,
		selectedFraction: selectedPixels / totalPixels,
		runCount,
		meanRunLength,
		p50RunLength,
		p95RunLength,
		maxRunLength,
	};
}
