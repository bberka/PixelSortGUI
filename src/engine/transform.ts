import {LANCZOS_TABLE} from './lanczos-table.ts';
import {clamp, floorDiv, roundHalfAway} from './math.ts';
import {boxDownscale} from './resample.ts';
import {createImage, type RgbaImage} from './types.ts';

export type RotationDegrees = 0 | 90 | 180 | 270;
export type ResizeFilter = 'lanczos3' | 'bilinear' | 'nearest';

export type Size = {readonly width: number; readonly height: number};

export type CropRect = {
	// Integer, 0 <= x < oriented width.
	readonly x: number;
	// Integer, 0 <= y < oriented height.
	readonly y: number;
	// Integer, 1 <= width <= oriented width - x.
	readonly width: number;
	// Integer, 1 <= height <= oriented height - y.
	readonly height: number;
};

export type ResizeSpec = {
	// Integer, 1..16384.
	readonly width: number;
	// Integer, 1..16384.
	readonly height: number;
	readonly filter: ResizeFilter;
};

export type SourceTransform = {
	// Clockwise.
	readonly rotation: RotationDegrees;
	// Mirrors left-right, after the rotation.
	readonly flipX: boolean;
	// Mirrors top-bottom, after the rotation.
	readonly flipY: boolean;
	// In oriented pixels; null keeps the whole oriented image.
	readonly crop: CropRect | null;
	// Null keeps the cropped size.
	readonly resize: ResizeSpec | null;
};

export const IDENTITY_TRANSFORM: SourceTransform = Object.freeze({
	rotation: 0,
	flipX: false,
	flipY: false,
	crop: null,
	resize: null,
});

export const MAX_OUTPUT_SIDE = 16_384;
// A larger cropped image may keep or reduce its own pixel count.
export const MAX_OUTPUT_PIXELS = 50_000_000;

// `a:b`, both positive integers.
export type AspectRatio = {readonly a: number; readonly b: number};

export type CropDrag = {
	// Requested length of the dragged axis, before clamping.
	readonly length: number;
} & (
	| {readonly handle: 'n' | 'e' | 's' | 'w'}
	| {
			readonly handle: 'ne' | 'se' | 'sw' | 'nw';
			readonly axis: 'width' | 'height';
	  }
);

export function orientedDimensions(
	sourceWidth: number,
	sourceHeight: number,
	rotation: RotationDegrees,
): Size {
	return rotation === 90 || rotation === 270
		? {width: sourceHeight, height: sourceWidth}
		: {width: sourceWidth, height: sourceHeight};
}

// `roundHalfAway(n / m)` in integers, for `n >= 0` and `m > 0`.
function roundRatio(n: number, m: number): number {
	return floorDiv(2 * n + m, 2 * m);
}

function assertRatio({a, b}: AspectRatio): void {
	if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < 1) {
		throw new RangeError(`Invalid aspect ratio ${a}:${b}`);
	}
}

function roundField(value: number, lo: number, hi: number): number {
	if (!Number.isFinite(value)) {
		throw new RangeError(`Crop value is not a finite number: ${value}`);
	}

	return clamp(roundHalfAway(value), lo, hi);
}

// The largest centred box of ratio `a:b` inside `bounds`.
export function initialCrop(bounds: Size, ratio: AspectRatio): CropRect {
	assertRatio(ratio);
	const {a, b} = ratio;
	let {width, height} = bounds;
	if (width * b <= height * a) {
		height = clamp(roundRatio(width * b, a), 1, bounds.height);
	} else {
		width = clamp(roundRatio(height * a, b), 1, bounds.width);
	}

	return {
		x: Math.floor((bounds.width - width) / 2),
		y: Math.floor((bounds.height - height) / 2),
		width,
		height,
	};
}

type Axis = {
	start: number;
	length: number;
	side: number;
	// -1 when the handle moves the low side, 1 the high side, 0 neither.
	moves: -1 | 0 | 1;
};

function availableLength({start, length, side, moves}: Axis): number {
	if (moves === 0) {
		return side;
	}

	return moves < 0 ? start + length : side - start;
}

function placeAxis(axis: Axis, length: number): number {
	const {start, side, moves} = axis;
	if (moves === 0) {
		return clamp(
			floorDiv(2 * start + axis.length - length, 2),
			0,
			side - length,
		);
	}

	return moves < 0 ? start + axis.length - length : start;
}

/**
 The crop box after dragging one handle of `start` with the ratio locked
 (engine.md section 16.3). `start` must lie inside `bounds`.
 */
export function dragCrop(
	start: CropRect,
	drag: CropDrag,
	ratio: AspectRatio,
	bounds: Size,
): CropRect {
	assertRatio(ratio);
	const {handle} = drag;
	const horizontal: Axis = {
		start: start.x,
		length: start.width,
		side: bounds.width,
		moves: handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0,
	};
	const vertical: Axis = {
		start: start.y,
		length: start.height,
		side: bounds.height,
		moves: handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0,
	};
	// An edge handle moves one axis; only a corner needs the caller to name it.
	const dragsWidth =
		vertical.moves === 0 ||
		(horizontal.moves !== 0 && 'axis' in drag && drag.axis === 'width');
	const [dragged, paired] = dragsWidth
		? [horizontal, vertical]
		: [vertical, horizontal];
	// Paired length = dragged length * to / from.
	const [to, from] = dragsWidth ? [ratio.b, ratio.a] : [ratio.a, ratio.b];

	const maxDragged = availableLength(dragged);
	const maxPaired = availableLength(paired);
	let d = roundField(drag.length, 1, maxDragged);
	let p = Math.max(1, roundRatio(d * to, from));
	if (p > maxPaired) {
		p = maxPaired;
		d = clamp(roundRatio(p * from, to), 1, maxDragged);
	}

	const draggedStart = placeAxis(dragged, d);
	const pairedStart = placeAxis(paired, p);
	return dragsWidth
		? {x: draggedStart, y: pairedStart, width: d, height: p}
		: {x: pairedStart, y: draggedStart, width: p, height: d};
}

// Typed crop fields: round each, clamp the size, then keep the box inside.
export function normalizeCrop(crop: CropRect, bounds: Size): CropRect {
	const width = roundField(crop.width, 1, bounds.width);
	const height = roundField(crop.height, 1, bounds.height);
	return {
		x: roundField(crop.x, 0, bounds.width - width),
		y: roundField(crop.y, 0, bounds.height - height),
		width,
		height,
	};
}

// Percent-mode resize. The result can exceed the limits.
export function percentSize(cropped: Size, percent: number): Size {
	const scale = (side: number) =>
		Math.max(1, roundHalfAway((side * percent) / 100));
	return {width: scale(cropped.width), height: scale(cropped.height)};
}

function isSide(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 1 && value <= MAX_OUTPUT_SIDE;
}

export function isResizeWithinLimits(cropped: Size, target: Size): boolean {
	return (
		isSide(target.width) &&
		isSide(target.height) &&
		target.width * target.height <=
			Math.max(MAX_OUTPUT_PIXELS, cropped.width * cropped.height)
	);
}

function isCropInside({x, y, width, height}: CropRect, bounds: Size): boolean {
	return (
		[x, y, width, height].every((value) => Number.isSafeInteger(value)) &&
		x >= 0 &&
		y >= 0 &&
		width >= 1 &&
		height >= 1 &&
		x + width <= bounds.width &&
		y + height <= bounds.height
	);
}

const ROTATIONS: ReadonlySet<number> = new Set([0, 90, 180, 270]);
const FILTERS: ReadonlySet<string> = new Set([
	'lanczos3',
	'bilinear',
	'nearest',
]);

// Validates the transform against the source size and fills in the nulls.
function resolveTransform(
	sourceWidth: number,
	sourceHeight: number,
	{rotation, crop, resize}: SourceTransform,
): {crop: CropRect; size: Size} {
	if (!ROTATIONS.has(rotation)) {
		throw new RangeError(`Invalid rotation ${rotation}`);
	}

	const oriented = orientedDimensions(sourceWidth, sourceHeight, rotation);
	const rect = crop ?? {x: 0, y: 0, ...oriented};
	if (!isCropInside(rect, oriented)) {
		throw new RangeError(
			`Crop ${rect.x},${rect.y} ${rect.width}x${rect.height} is outside ${oriented.width}x${oriented.height}`,
		);
	}

	if (resize === null) {
		return {crop: rect, size: {width: rect.width, height: rect.height}};
	}

	if (!FILTERS.has(resize.filter)) {
		throw new RangeError(`Unknown resize filter ${resize.filter}`);
	}

	if (!isResizeWithinLimits(rect, resize)) {
		throw new RangeError(
			`Cannot resize ${rect.width}x${rect.height} to ${resize.width}x${resize.height}`,
		);
	}

	return {crop: rect, size: {width: resize.width, height: resize.height}};
}

// The size `applyTransform` returns for a source of this size.
export function effectiveDimensions(
	sourceWidth: number,
	sourceHeight: number,
	transform: SourceTransform,
): Size {
	return resolveTransform(sourceWidth, sourceHeight, transform).size;
}

// Copies the crop rectangle of the oriented image straight out of the source.
function orientAndCrop(
	source: RgbaImage,
	{rotation, flipX, flipY}: SourceTransform,
	crop: CropRect,
): RgbaImage {
	const sw = source.width;
	const sh = source.height;
	const oriented = orientedDimensions(sw, sh, rotation);

	// Source pixel index of oriented pixel (u, v): undo the flips, then the rotation.
	const sourceIndex = (u: number, v: number): number => {
		const ru = flipX ? oriented.width - 1 - u : u;
		const rv = flipY ? oriented.height - 1 - v : v;
		switch (rotation) {
			case 0: {
				return rv * sw + ru;
			}

			case 90: {
				return (sh - 1 - ru) * sw + rv;
			}

			case 180: {
				return (sh - 1 - rv) * sw + (sw - 1 - ru);
			}

			case 270: {
				return ru * sw + (sw - 1 - rv);
			}
		}
	};

	// The mapping is affine, so one step per axis covers every pixel.
	const origin = sourceIndex(crop.x, crop.y);
	const stepU = sourceIndex(crop.x + 1, crop.y) - origin;
	const stepV = sourceIndex(crop.x, crop.y + 1) - origin;

	const target = createImage(crop.width, crop.height);
	const from = source.data;
	const to = target.data;
	let t = 0;
	for (let v = 0; v < crop.height; v++) {
		let s = (origin + v * stepV) * 4;
		if (stepU === 1) {
			to.set(from.subarray(s, s + crop.width * 4), t);
			t += crop.width * 4;
			continue;
		}

		for (let u = 0; u < crop.width; u++) {
			to[t] = from[s];
			to[t + 1] = from[s + 1];
			to[t + 2] = from[s + 2];
			to[t + 3] = from[s + 3];
			t += 4;
			s += stepU * 4;
		}
	}

	return target;
}

// Source index under the centre of each destination pixel.
function nearestAxis(sourceSize: number, targetSize: number): Int32Array {
	return Int32Array.from({length: targetSize}, (_, d) =>
		floorDiv((2 * d + 1) * sourceSize, 2 * targetSize),
	);
}

function resizeNearest(source: RgbaImage, size: Size): RgbaImage {
	const target = createImage(size.width, size.height);
	const xs = nearestAxis(source.width, size.width);
	const ys = nearestAxis(source.height, size.height);
	const from = source.data;
	const to = target.data;
	let t = 0;
	for (const sy of ys) {
		for (const sx of xs) {
			const s = (sy * source.width + sx) * 4;
			to[t] = from[s];
			to[t + 1] = from[s + 1];
			to[t + 2] = from[s + 2];
			to[t + 3] = from[s + 3];
			t += 4;
		}
	}

	return target;
}

type BilinearAxis = {
	low: Int32Array;
	high: Int32Array;
	// Weight of `high` out of `2 * targetSize`.
	fraction: Int32Array;
};

function bilinearAxis(sourceSize: number, targetSize: number): BilinearAxis {
	const low = new Int32Array(targetSize);
	const high = new Int32Array(targetSize);
	const fraction = new Int32Array(targetSize);
	const unit = 2 * targetSize;
	for (let d = 0; d < targetSize; d++) {
		const n = clamp(
			(2 * d + 1) * sourceSize - targetSize,
			0,
			(sourceSize - 1) * unit,
		);
		low[d] = floorDiv(n, unit);
		high[d] = Math.min(low[d] + 1, sourceSize - 1);
		fraction[d] = n - low[d] * unit;
	}

	return {low, high, fraction};
}

// Adds one premultiplied sample to `sums` (R * A, G * A, B * A, A).
function addSample(
	sums: Float64Array,
	data: Uint8ClampedArray,
	pixel: number,
	weight: number,
): void {
	const s = pixel * 4;
	const wa = weight * data[s + 3];
	sums[0] += wa * data[s];
	sums[1] += wa * data[s + 1];
	sums[2] += wa * data[s + 2];
	sums[3] += wa;
}

function resizeBilinear(source: RgbaImage, size: Size): RgbaImage {
	const {width, height} = size;
	const target = createImage(width, height);
	const xs = bilinearAxis(source.width, width);
	const ys = bilinearAxis(source.height, height);
	const from = source.data;
	const to = target.data;
	const total = 4 * width * height;
	const sums = new Float64Array(4);
	let t = 0;
	for (let dy = 0; dy < height; dy++) {
		const top = ys.low[dy] * source.width;
		const bottom = ys.high[dy] * source.width;
		const wy1 = ys.fraction[dy];
		const wy0 = 2 * height - wy1;
		for (let dx = 0; dx < width; dx++, t += 4) {
			const left = xs.low[dx];
			const right = xs.high[dx];
			const wx1 = xs.fraction[dx];
			const wx0 = 2 * width - wx1;
			sums.fill(0);
			addSample(sums, from, top + left, wy0 * wx0);
			addSample(sums, from, top + right, wy0 * wx1);
			addSample(sums, from, bottom + left, wy1 * wx0);
			addSample(sums, from, bottom + right, wy1 * wx1);

			const sumA = sums[3];
			if (sumA === 0) {
				continue;
			}

			to[t] = floorDiv(2 * sums[0] + sumA, 2 * sumA);
			to[t + 1] = floorDiv(2 * sums[1] + sumA, 2 * sumA);
			to[t + 2] = floorDiv(2 * sums[2] + sumA, 2 * sumA);
			to[t + 3] = floorDiv(2 * sumA + total, 2 * total);
		}
	}

	return target;
}

const WEIGHT_ONE = 2 ** 22;
// The horizontal pass keeps 8 fraction bits: `WEIGHT_ONE / 2 ** 8`.
const ROW_DIVISOR = 2 ** 14;
const OUTPUT_DIVISOR = 2 ** 30;

type LanczosAxis = {
	// Per destination index: first source index, tap count, offset into `weights`.
	first: Int32Array;
	count: Int32Array;
	offset: Int32Array;
	// Each destination's weights sum to 2^22.
	weights: Int32Array;
	maxCount: number;
};

/**
 Fixed-point Lanczos-3 weights for one axis (engine.md section 16.3). Distances
 are exact integers `n`, in units where the kernel's support is `n < 6 * M`.
 */
function lanczosAxis(sourceSize: number, targetSize: number): LanczosAxis {
	const m = Math.max(sourceSize, targetSize);
	const support = 6 * m;
	const step = 2 * targetSize;
	const first = new Int32Array(targetSize);
	const count = new Int32Array(targetSize);
	const offset = new Int32Array(targetSize);
	let total = 0;
	let maxCount = 0;
	for (let d = 0; d < targetSize; d++) {
		const centre = (2 * d + 1) * sourceSize - targetSize;
		first[d] = Math.max(0, floorDiv(centre - support, step) + 1);
		const end = Math.min(sourceSize, floorDiv(centre + support - 1, step) + 1);
		count[d] = end - first[d];
		offset[d] = total;
		total += count[d];
		maxCount = Math.max(maxCount, count[d]);
	}

	const weights = new Int32Array(total);
	const raw = new Float64Array(maxCount);
	for (let d = 0; d < targetSize; d++) {
		const centre = (2 * d + 1) * sourceSize - targetSize;
		let sum = 0;
		let largest = 0;
		for (let k = 0; k < count[d]; k++) {
			const n = Math.abs((first[d] + k) * step - centre);
			const q = floorDiv(1023 * n, support);
			const f = 1023 * n - q * support;
			raw[k] = floorDiv(
				LANCZOS_TABLE[q] * (support - f) + LANCZOS_TABLE[q + 1] * f + 3 * m,
				support,
			);
			sum += raw[k];
			if (raw[k] > raw[largest]) {
				largest = k;
			}
		}

		let rest = WEIGHT_ONE;
		for (let k = 0; k < count[d]; k++) {
			const weight = roundHalfAway((raw[k] * WEIGHT_ONE) / sum);
			weights[offset[d] + k] = weight;
			rest -= weight;
		}

		weights[offset[d] + largest] += rest;
	}

	return {first, count, offset, weights, maxCount};
}

// Filters source row `sy` horizontally into `out`, premultiplied.
function filterRow(
	source: RgbaImage,
	sy: number,
	axis: LanczosAxis,
	out: Int32Array,
): void {
	const from = source.data;
	const {first, count, offset, weights} = axis;
	const row = sy * source.width;
	for (const [dx, element] of first.entries()) {
		let r = 0;
		let g = 0;
		let b = 0;
		let a = 0;
		let s = (row + element) * 4;
		const end = offset[dx] + count[dx];
		for (let k = offset[dx]; k < end; k++, s += 4) {
			const wa = weights[k] * from[s + 3];
			r += wa * from[s];
			g += wa * from[s + 1];
			b += wa * from[s + 2];
			a += wa;
		}

		const o = dx * 4;
		out[o] = Math.floor((r + ROW_DIVISOR / 2) / ROW_DIVISOR);
		out[o + 1] = Math.floor((g + ROW_DIVISOR / 2) / ROW_DIVISOR);
		out[o + 2] = Math.floor((b + ROW_DIVISOR / 2) / ROW_DIVISOR);
		out[o + 3] = Math.floor((a + ROW_DIVISOR / 2) / ROW_DIVISOR);
	}
}

// Adds one filtered row, times its vertical weight, into a destination row.
function addRow(sums: Float64Array, row: Int32Array, weight: number): void {
	for (let i = 0; i < sums.length; i++) {
		sums[i] += weight * row[i];
	}
}

// Unpremultiplies the vertical sums into destination row `dy`.
function writeRow(sums: Float64Array, target: RgbaImage, dy: number): void {
	const to = target.data;
	const out = dy * sums.length;
	for (let o = 0; o < sums.length; o += 4) {
		const sumA = sums[o + 3];
		const alpha = Math.floor((sumA + OUTPUT_DIVISOR / 2) / OUTPUT_DIVISOR);
		if (alpha <= 0) {
			continue;
		}

		// `Uint8ClampedArray` clamps the negative-lobe overshoot to 0..255.
		to[out + o] = floorDiv(2 * sums[o] + sumA, 2 * sumA);
		to[out + o + 1] = floorDiv(2 * sums[o + 1] + sumA, 2 * sumA);
		to[out + o + 2] = floorDiv(2 * sums[o + 2] + sumA, 2 * sumA);
		to[out + o + 3] = alpha;
	}
}

/**
 Vertical pass for a shrinking height, where one window spans up to the whole
 source. Source rows are read once and added into every open window, at most 6,
 so no filtered row has to be kept.
 */
function accumulateRows(
	source: RgbaImage,
	xs: LanczosAxis,
	ys: LanczosAxis,
	target: RgbaImage,
): void {
	const stride = target.width * 4;
	const row = new Int32Array(stride);
	// Sums of destination rows `done`, `done + 1`, ...
	const open: Float64Array[] = [];
	const spare: Float64Array[] = [];
	let done = 0;
	for (let sy = 0; done < target.height; sy++) {
		for (
			let dy = done + open.length;
			dy < target.height && ys.first[dy] <= sy;
			dy++
		) {
			open.push(spare.pop()?.fill(0) ?? new Float64Array(stride));
		}

		filterRow(source, sy, xs, row);
		for (const [i, sums] of open.entries()) {
			const dy = done + i;
			addRow(sums, row, ys.weights[ys.offset[dy] + sy - ys.first[dy]]);
		}

		// Windows end in destination order.
		while (open.length > 0 && ys.first[done] + ys.count[done] === sy + 1) {
			const sums = open.shift()!;
			writeRow(sums, target, done);
			spare.push(sums);
			done++;
		}
	}
}

// Vertical pass for a height that does not shrink: a window spans at most 6 rows.
function ringRows(
	source: RgbaImage,
	xs: LanczosAxis,
	ys: LanczosAxis,
	target: RgbaImage,
): void {
	const stride = target.width * 4;
	// Only the rows under the vertical window are kept, as a ring.
	const rows = Array.from({length: ys.maxCount}, () => new Int32Array(stride));
	const sums = new Float64Array(stride);
	let filtered = 0;
	for (let dy = 0; dy < target.height; dy++) {
		const first = ys.first[dy];
		const end = first + ys.count[dy];
		for (let sy = Math.max(filtered, first); sy < end; sy++) {
			filterRow(source, sy, xs, rows[sy % rows.length]);
		}

		filtered = end;
		sums.fill(0);
		for (let sy = first; sy < end; sy++) {
			const weight = ys.weights[ys.offset[dy] + sy - first];
			addRow(sums, rows[sy % rows.length], weight);
		}

		writeRow(sums, target, dy);
	}
}

function resizeLanczos(source: RgbaImage, size: Size): RgbaImage {
	const target = createImage(size.width, size.height);
	const xs = lanczosAxis(source.width, size.width);
	const ys = lanczosAxis(source.height, size.height);
	const vertical = size.height < source.height ? accumulateRows : ringRows;
	vertical(source, xs, ys, target);
	return target;
}

function resizeImage(
	source: RgbaImage,
	size: Size,
	filter: ResizeFilter,
): RgbaImage {
	switch (filter) {
		case 'nearest': {
			return resizeNearest(source, size);
		}

		case 'bilinear': {
			return size.width <= source.width && size.height <= source.height
				? boxDownscale(source, size.width, size.height)
				: resizeBilinear(source, size);
		}

		case 'lanczos3': {
			return resizeLanczos(source, size);
		}
	}
}

/**
 Orientation, crop, then resize (engine.md section 16.3). Never writes `source`
 and always returns a new buffer.
 */
export function applyTransform(
	source: RgbaImage,
	transform: SourceTransform,
): RgbaImage {
	const {crop, size} = resolveTransform(source.width, source.height, transform);
	const cropped = orientAndCrop(source, transform, crop);
	const {resize} = transform;
	return resize === null ||
		(size.width === crop.width && size.height === crop.height)
		? cropped
		: resizeImage(cropped, size, resize.filter);
}
