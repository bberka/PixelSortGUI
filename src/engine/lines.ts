import {DIRECTION_TABLE} from './direction-table.ts';
import {floorDiv, wrap} from './math.ts';

export type MajorAxis = 'horizontal' | 'vertical';
export type FastPathKind = 'none' | '0' | '90' | '180' | '270';

export type LinePartitionOptions = {
	disableFastPath?: boolean;
};

export type LineWalker = {
	k: number;
	length: number;
	posStart: number;
	readonly posStep: 1 | -1;
	startOffset: number;
	readonly stride: number;
	next(): boolean;
	fillOffsets(out: Int32Array): number;
	gather32(in32: Uint32Array, out: Uint32Array): number;
	scatter32(src: Uint32Array, out32: Uint32Array): void;
};

export type LinePartition = {
	readonly width: number;
	readonly height: number;
	readonly angleIndex: number;
	readonly dx: number;
	readonly dy: number;
	readonly major: MajorAxis;
	readonly posStep: 1 | -1;
	readonly fastPath: FastPathKind;
	readonly stride: number;
	readonly lineCount: number;
	readonly maxLineLength: number;
	readonly kStart: number;
	readonly kEnd: number;
	createWalker(): LineWalker;
};

export function normalizeAngleIndex(angle: number): number {
	return wrap(Math.round(angle * 10), 3600);
}

export function directionForAngle(angle: number): readonly [number, number] {
	return DIRECTION_TABLE[normalizeAngleIndex(angle)];
}

function createFastRowWalker(
	width: number,
	height: number,
	forward: boolean,
): LineWalker {
	let nextK = 0;
	const walker: LineWalker = {
		k: 0,
		length: width,
		posStart: forward ? 0 : width - 1,
		posStep: forward ? 1 : -1,
		startOffset: 0,
		stride: forward ? 1 : -1,
		next() {
			if (nextK >= height) {
				return false;
			}

			const k = nextK++;
			walker.k = k;
			walker.startOffset = forward ? k * width : k * width + width - 1;
			return true;
		},
		fillOffsets(out) {
			const start = walker.startOffset;
			if (forward) {
				for (let i = 0; i < width; i++) {
					out[i] = start + i;
				}
			} else {
				for (let i = 0; i < width; i++) {
					out[i] = start - i;
				}
			}

			return width;
		},
		gather32(in32, out) {
			const start = walker.startOffset;
			if (forward) {
				out.set(in32.subarray(start, start + width), 0);
			} else {
				for (let i = 0; i < width; i++) {
					out[i] = in32[start - i];
				}
			}

			return width;
		},
		scatter32(src, out32) {
			const start = walker.startOffset;
			if (forward) {
				out32.set(src.subarray(0, width), start);
			} else {
				for (let i = 0; i < width; i++) {
					out32[start - i] = src[i];
				}
			}
		},
	};
	return walker;
}

function createFastColumnWalker(
	width: number,
	height: number,
	downward: boolean,
): LineWalker {
	let nextK = 0;
	const stride = downward ? width : -width;
	const bottomRowOffset = (height - 1) * width;
	const walker: LineWalker = {
		k: 0,
		length: height,
		posStart: downward ? 0 : height - 1,
		posStep: downward ? 1 : -1,
		startOffset: 0,
		stride,
		next() {
			if (nextK >= width) {
				return false;
			}

			const k = nextK++;
			walker.k = k;
			walker.startOffset = downward ? k : bottomRowOffset + k;
			return true;
		},
		fillOffsets(out) {
			let offset = walker.startOffset;
			for (let i = 0; i < height; i++) {
				out[i] = offset;
				offset += stride;
			}

			return height;
		},
		gather32(in32, out) {
			let offset = walker.startOffset;
			for (let i = 0; i < height; i++) {
				out[i] = in32[offset];
				offset += stride;
			}

			return height;
		},
		scatter32(src, out32) {
			let offset = walker.startOffset;
			for (let i = 0; i < height; i++) {
				out32[offset] = src[i];
				offset += stride;
			}
		},
	};
	return walker;
}

function createGeneralWalker(
	width: number,
	isHorizontal: boolean,
	majorLength: number,
	minorLength: number,
	posStep: 1 | -1,
	kStart: number,
	kEnd: number,
	nonIncreasing: boolean,
	offsets: Int32Array,
	baseOffsets: Int32Array,
): LineWalker {
	let nextK = kStart;
	let uStart = nonIncreasing ? 0 : majorLength;
	let uEnd = nonIncreasing ? -1 : majorLength - 1;
	let lineBase = 0;

	const walker: LineWalker = {
		k: kStart,
		length: 0,
		posStart: 0,
		posStep,
		startOffset: 0,
		stride: 0,
		next() {
			while (nextK <= kEnd) {
				const k = nextK++;
				if (nonIncreasing) {
					while (uStart < majorLength && k + offsets[uStart] >= minorLength) {
						uStart++;
					}

					while (uEnd + 1 < majorLength && k + offsets[uEnd + 1] >= 0) {
						uEnd++;
					}
				} else {
					while (uStart > 0 && k + offsets[uStart - 1] >= 0) {
						uStart--;
					}

					while (uEnd >= 0 && k + offsets[uEnd] >= minorLength) {
						uEnd--;
					}
				}

				const length = uEnd - uStart + 1;
				if (length <= 0) {
					continue;
				}

				const posStart = posStep === 1 ? uStart : uEnd;
				lineBase = isHorizontal ? k * width : k;
				walker.k = k;
				walker.length = length;
				walker.posStart = posStart;
				walker.startOffset = lineBase + baseOffsets[posStart];
				return true;
			}

			return false;
		},
		fillOffsets(out) {
			const {length, posStart} = walker;
			if (posStep === 1) {
				for (let i = 0; i < length; i++) {
					out[i] = lineBase + baseOffsets[posStart + i];
				}
			} else {
				for (let i = 0; i < length; i++) {
					out[i] = lineBase + baseOffsets[posStart - i];
				}
			}

			return length;
		},
		gather32(in32, out) {
			const {length, posStart} = walker;
			if (posStep === 1) {
				for (let i = 0; i < length; i++) {
					out[i] = in32[lineBase + baseOffsets[posStart + i]];
				}
			} else {
				for (let i = 0; i < length; i++) {
					out[i] = in32[lineBase + baseOffsets[posStart - i]];
				}
			}

			return length;
		},
		scatter32(src, out32) {
			const {length, posStart} = walker;
			if (posStep === 1) {
				for (let i = 0; i < length; i++) {
					out32[lineBase + baseOffsets[posStart + i]] = src[i];
				}
			} else {
				for (let i = 0; i < length; i++) {
					out32[lineBase + baseOffsets[posStart - i]] = src[i];
				}
			}
		},
	};
	return walker;
}

export function createLinePartition(
	width: number,
	height: number,
	angle: number,
	options?: LinePartitionOptions,
): LinePartition {
	if (!Number.isSafeInteger(width) || width < 1) {
		throw new RangeError(`width must be a positive integer, got ${width}`);
	}

	if (!Number.isSafeInteger(height) || height < 1) {
		throw new RangeError(`height must be a positive integer, got ${height}`);
	}

	const angleIndex = normalizeAngleIndex(angle);
	const [dx, dy] = DIRECTION_TABLE[angleIndex];
	const disableFastPath = options?.disableFastPath === true;

	if (!disableFastPath) {
		if (angleIndex === 0) {
			return {
				width,
				height,
				angleIndex,
				dx,
				dy,
				major: 'horizontal',
				posStep: 1,
				fastPath: '0',
				stride: 1,
				lineCount: height,
				maxLineLength: width,
				kStart: 0,
				kEnd: height - 1,
				createWalker: () => createFastRowWalker(width, height, true),
			};
		}

		if (angleIndex === 1800) {
			return {
				width,
				height,
				angleIndex,
				dx,
				dy,
				major: 'horizontal',
				posStep: -1,
				fastPath: '180',
				stride: -1,
				lineCount: height,
				maxLineLength: width,
				kStart: 0,
				kEnd: height - 1,
				createWalker: () => createFastRowWalker(width, height, false),
			};
		}

		if (angleIndex === 900) {
			return {
				width,
				height,
				angleIndex,
				dx,
				dy,
				major: 'vertical',
				posStep: -1,
				fastPath: '90',
				stride: -width,
				lineCount: width,
				maxLineLength: height,
				kStart: 0,
				kEnd: width - 1,
				createWalker: () => createFastColumnWalker(width, height, false),
			};
		}

		if (angleIndex === 2700) {
			return {
				width,
				height,
				angleIndex,
				dx,
				dy,
				major: 'vertical',
				posStep: 1,
				fastPath: '270',
				stride: width,
				lineCount: width,
				maxLineLength: height,
				kStart: 0,
				kEnd: width - 1,
				createWalker: () => createFastColumnWalker(width, height, true),
			};
		}
	}

	const absDx = Math.abs(dx);
	const absDy = Math.abs(dy);
	const isHorizontal = absDx >= absDy;
	const majorLength = isHorizontal ? width : height;
	const minorLength = isHorizontal ? height : width;
	const majorDelta = isHorizontal ? dx : dy;
	const minorDelta = isHorizontal ? dy : dx;
	const posStep: 1 | -1 = majorDelta > 0 ? 1 : -1;
	const absMajor = isHorizontal ? absDx : absDy;
	const slopeNum = minorDelta * posStep;
	const denom = 2 * absMajor;

	const offsets = new Int32Array(majorLength);
	const baseOffsets = new Int32Array(majorLength);
	if (isHorizontal) {
		for (let x = 0; x < width; x++) {
			const o = floorDiv(2 * x * slopeNum + absMajor, denom);
			offsets[x] = o;
			baseOffsets[x] = o * width + x;
		}
	} else {
		for (let y = 0; y < height; y++) {
			const o = floorDiv(2 * y * slopeNum + absMajor, denom);
			offsets[y] = o;
			baseOffsets[y] = y * width + o;
		}
	}

	const nonIncreasing = slopeNum <= 0;
	const minO = nonIncreasing ? offsets[majorLength - 1] : offsets[0];
	const maxO = nonIncreasing ? offsets[0] : offsets[majorLength - 1];
	const kStart = maxO === 0 ? 0 : -maxO;
	const kEnd = minorLength - 1 - minO;

	return {
		width,
		height,
		angleIndex,
		dx,
		dy,
		major: isHorizontal ? 'horizontal' : 'vertical',
		posStep,
		fastPath: 'none',
		stride: 0,
		lineCount: kEnd - kStart + 1,
		maxLineLength: majorLength,
		kStart,
		kEnd,
		createWalker: () =>
			createGeneralWalker(
				width,
				isHorizontal,
				majorLength,
				minorLength,
				posStep,
				kStart,
				kEnd,
				nonIncreasing,
				offsets,
				baseOffsets,
			),
	};
}
