import {SORT_KEYS, type SortKey} from '../../keys.ts';
import {createLinePartition} from '../../lines.ts';
import type {
	EffectDefinition,
	ParamSpecs,
	RenderContext,
	RgbaImage,
} from '../../types.ts';
import {computeEdgeSelection} from './edges.ts';
import {
	fillAverage,
	fillGradient,
	fillSort,
	packKeys,
	packedExtremes,
	shuffleIndices,
	sortPacked,
	type Sorter,
} from './fill.ts';
import {
	fillKeys,
	intervalCap,
	P_CAP,
	P_ORDER,
	P_SKIP,
	selectFromMap,
	selectThreshold,
	selectWhole,
	thresholdBound,
	unit3,
	writeSelectionView,
} from './select.ts';

export type IntervalMode = 'threshold' | 'edges' | 'whole';
export type SortOrder = 'ascending' | 'descending' | 'shuffle' | 'random';
export type FillMode = 'sort' | 'average' | 'gradient';

export type PixelSortParams = {
	angle: number;
	intervalMode: IntervalMode;
	selectKey: SortKey;
	threshold: readonly [number, number];
	edgeThreshold: number;
	edgeBlur: number;
	invert: boolean;
	maxLength: number;
	lengthJitter: number;
	skipChance: number;
	sortKey: SortKey;
	order: SortOrder;
	discretize: number;
	fill: FillMode;
	seed: number;
};

const KEY_LABELS: Readonly<Record<SortKey, string>> = {
	luma: 'Luma',
	lightness: 'Lightness',
	value: 'Value',
	saturation: 'Saturation',
	hue: 'Hue',
	red: 'Red',
	green: 'Green',
	blue: 'Blue',
};

const keyOptions = SORT_KEYS.map((value) => ({
	value,
	label: KEY_LABELS[value],
}));

const paramSpecs: ParamSpecs<PixelSortParams> = {
	angle: {
		kind: 'angle',
		label: 'Angle',
		group: 'Direction',
		help: 'Degrees counter-clockwise from rightward: 0 sorts left to right, 90 bottom to top, 180 right to left, 270 top to bottom.',
		default: 0,
		snaps: [0, 45, 90, 135, 180, 225, 270, 315],
	},
	intervalMode: {
		kind: 'enum',
		label: 'Interval mode',
		group: 'Selection',
		help: 'How pixels are selected for sorting: by a threshold on a key, between edges, or the whole line.',
		options: [
			{value: 'threshold', label: 'Threshold'},
			{value: 'edges', label: 'Edges'},
			{value: 'whole', label: 'Whole line'},
		],
		default: 'threshold',
	},
	selectKey: {
		kind: 'enum',
		label: 'Selection key',
		group: 'Selection',
		help: 'The key the threshold range is compared against.',
		options: keyOptions,
		default: 'luma',
		visibleWhen: {param: 'intervalMode', equals: ['threshold']},
	},
	threshold: {
		kind: 'range',
		label: 'Threshold range',
		group: 'Selection',
		help: 'Pixels whose selection key lies in this range, inclusive at both ends, are selected.',
		min: 0,
		max: 1,
		step: 0.001,
		default: [0.25, 0.8],
		visibleWhen: {param: 'intervalMode', equals: ['threshold']},
	},
	edgeThreshold: {
		kind: 'number',
		label: 'Edge threshold',
		group: 'Selection',
		help: 'Edge strength, as a fraction of the maximum single-axis gradient, at which a pixel counts as an edge. Pixels that are not edges are selected.',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.2,
		unit: 'ratio',
		visibleWhen: {param: 'intervalMode', equals: ['edges']},
	},
	edgeBlur: {
		kind: 'integer',
		label: 'Edge blur',
		group: 'Selection',
		help: 'Box blur radius applied before edge detection.',
		min: 0,
		max: 8,
		default: 1,
		unit: 'px',
		visibleWhen: {param: 'intervalMode', equals: ['edges']},
	},
	invert: {
		kind: 'boolean',
		label: 'Invert',
		group: 'Selection',
		help: 'Select the pixels that would not be selected, and the other way round.',
		default: false,
		visibleWhen: {param: 'intervalMode', notEquals: ['whole']},
	},
	maxLength: {
		kind: 'integer',
		label: 'Maximum interval length',
		group: 'Length',
		help: 'Splits each run into intervals of at most this length. 0 means no limit.',
		min: 0,
		max: 16_384,
		default: 0,
		unit: 'px',
	},
	lengthJitter: {
		kind: 'number',
		label: 'Length jitter',
		group: 'Length',
		help: 'Random variation of each interval length around the maximum.',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0,
		unit: 'ratio',
		visibleWhen: {param: 'maxLength', notEquals: [0]},
	},
	skipChance: {
		kind: 'number',
		label: 'Skip chance',
		group: 'Length',
		help: 'Chance that an interval is left unchanged.',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0,
		unit: 'ratio',
	},
	sortKey: {
		kind: 'enum',
		label: 'Sort key',
		group: 'Order',
		help: 'The key each interval is sorted by.',
		options: keyOptions,
		default: 'luma',
	},
	order: {
		kind: 'enum',
		label: 'Order',
		group: 'Order',
		help: 'Ascending puts the smallest key first along the line direction. Random direction picks ascending or descending per interval.',
		options: [
			{value: 'ascending', label: 'Ascending'},
			{value: 'descending', label: 'Descending'},
			{value: 'shuffle', label: 'Shuffle'},
			{value: 'random', label: 'Random direction'},
		],
		default: 'ascending',
	},
	discretize: {
		kind: 'integer',
		label: 'Discretize',
		group: 'Order',
		help: 'Colours within about this many 8-bit steps compare equal and keep their order, giving clumpier streaks. 0 turns it off.',
		min: 0,
		max: 64,
		default: 0,
		visibleWhen: {param: 'fill', notEquals: ['average']},
	},
	fill: {
		kind: 'enum',
		label: 'Fill',
		group: 'Output',
		help: 'Sort moves the pixels; average paints each interval with its mean colour; gradient blends from its first ordered pixel to its last.',
		options: [
			{value: 'sort', label: 'Sort'},
			{value: 'average', label: 'Average'},
			{value: 'gradient', label: 'Gradient'},
		],
		default: 'sort',
	},
	seed: {
		kind: 'seed',
		label: 'Seed',
		group: 'Seed',
		help: 'Drives length jitter, skipping, shuffle and random direction.',
	},
};

const SLOT_PIXELS = 0;
const SLOT_OUT = 1;
const SLOT_PACKED = 2;
const SLOT_SPARE = 3;
const SLOT_KEYS = 4;
const SLOT_SELECTED = 5;
const SLOT_COUNTS = 6;
const SLOT_OFFSETS = 7;
const SLOT_EDGE_FIRST = 8;
const SLOT_EDGE_SECOND = 9;
const SLOT_EDGE_SUMS = 10;

const CHECKPOINT_PIXELS = 16_384;

function scratch32(
	ctx: RenderContext,
	slot: number,
	length: number,
): Uint32Array {
	const bytes = ctx.scratch(slot, length * 4);
	return bytes.byteOffset % 4 === 0
		? new Uint32Array(bytes.buffer, bytes.byteOffset, length)
		: new Uint32Array(length);
}

function scratchInt32(
	ctx: RenderContext,
	slot: number,
	length: number,
): Int32Array {
	const words = scratch32(ctx, slot, length);
	return new Int32Array(words.buffer, words.byteOffset, length);
}

function scratch16(
	ctx: RenderContext,
	slot: number,
	length: number,
): Uint16Array {
	const bytes = ctx.scratch(slot, length * 2);
	return bytes.byteOffset % 2 === 0
		? new Uint16Array(bytes.buffer, bytes.byteOffset, length)
		: new Uint16Array(length);
}

function byteView(words: Uint32Array): Uint8Array {
	return new Uint8Array(words.buffer, words.byteOffset, words.byteLength);
}

type LineBuffers = {
	// The line's pixels in line order, and the same memory as RGBA bytes.
	readonly pixels: Uint32Array;
	readonly bytes: Uint8Array;
	readonly out: Uint32Array;
	readonly outBytes: Uint8Array;
	readonly keys: Uint16Array;
	readonly selected: Uint8Array;
	readonly packed: Uint32Array;
	readonly spare: Uint32Array;
	readonly counts: Int32Array;
};

type SortSettings = {
	readonly seed: number;
	// `ctx.pxLength(maxLength)`; 0 means no limit.
	readonly scaledMaxLength: number;
	readonly lengthJitter: number;
	readonly skipChance: number;
	readonly sortKey: SortKey;
	// True when `keys` already holds the sort key for the whole line.
	readonly keysReady: boolean;
	readonly order: SortOrder;
	// `discretize * 257`, or 0.
	readonly divisor: number;
	readonly fill: FillMode;
	readonly sorter: Sorter;
};

function copyPixels(
	pixels: Uint32Array,
	out: Uint32Array,
	start: number,
	end: number,
): void {
	for (let i = start; i < end; i++) {
		out[i] = pixels[i];
	}
}

function renderInterval(
	line: LineBuffers,
	settings: SortSettings,
	start: number,
	length: number,
	lineId: number,
	sourcePosition: number,
): void {
	const {pixels, out, packed} = line;
	const {seed, order, fill} = settings;
	if (
		length === 1 ||
		(settings.skipChance > 0 &&
			unit3(seed, P_SKIP, lineId, sourcePosition) < settings.skipChance)
	) {
		copyPixels(pixels, out, start, start + length);
		return;
	}

	if (fill === 'average') {
		fillAverage(line.bytes, line.outBytes, start, length);
		return;
	}

	if (order === 'shuffle') {
		shuffleIndices(packed, length, seed, lineId, sourcePosition);
		if (fill === 'sort') {
			fillSort(pixels, out, start, length, packed);
		} else {
			fillGradient(
				line.bytes,
				line.outBytes,
				start,
				length,
				packed[0],
				packed[length - 1],
			);
		}

		return;
	}

	const descending =
		order === 'descending' ||
		(order === 'random' && unit3(seed, P_ORDER, lineId, sourcePosition) >= 0.5);
	if (!settings.keysReady) {
		fillKeys(settings.sortKey, line.bytes, start, start + length, line.keys);
	}

	packKeys(line.keys, start, length, settings.divisor, descending, packed);
	if (fill === 'sort') {
		const ordered = sortPacked(
			packed,
			line.spare,
			line.counts,
			length,
			settings.sorter,
		);
		fillSort(pixels, out, start, length, ordered);
	} else {
		const ends = packedExtremes(packed, length);
		fillGradient(
			line.bytes,
			line.outBytes,
			start,
			length,
			Math.floor(ends / 65_536),
			ends % 65_536,
		);
	}
}

function renderLine(
	line: LineBuffers,
	settings: SortSettings,
	ctx: RenderContext,
	length: number,
	lineId: number,
	positionStart: number,
	positionStep: number,
): void {
	const {pixels, out, selected} = line;
	const {seed, scaledMaxLength, lengthJitter} = settings;
	const needsSource =
		settings.skipChance > 0 ||
		settings.order === 'shuffle' ||
		settings.order === 'random';
	let i = 0;
	while (i < length) {
		if (selected[i] === 0) {
			out[i] = pixels[i];
			i++;
			continue;
		}

		let start = i;
		i++;
		while (i < length && selected[i] !== 0) {
			i++;
		}

		if (i - start === 1) {
			out[start] = pixels[start];
			continue;
		}

		if (scaledMaxLength === 0) {
			renderInterval(
				line,
				settings,
				start,
				i - start,
				lineId,
				needsSource ? ctx.toSource(positionStart + positionStep * start) : 0,
			);
			continue;
		}

		while (start < i) {
			const jittered = lengthJitter > 0;
			const sourcePosition =
				needsSource || jittered
					? ctx.toSource(positionStart + positionStep * start)
					: 0;
			const cap = jittered
				? intervalCap(
						scaledMaxLength,
						lengthJitter,
						unit3(seed, P_CAP, lineId, sourcePosition),
					)
				: scaledMaxLength;
			const intervalLength = Math.min(cap, i - start);
			renderInterval(
				line,
				settings,
				start,
				intervalLength,
				lineId,
				sourcePosition,
			);
			start += intervalLength;
		}
	}
}

function inputWords(image: RgbaImage): Uint32Array {
	const {data} = image;
	const length = image.width * image.height;
	if (data.byteOffset % 4 === 0) {
		return new Uint32Array(data.buffer, data.byteOffset, length);
	}

	const aligned = new Uint8Array(data);
	return new Uint32Array(aligned.buffer, aligned.byteOffset, length);
}

/**
 The `pixelSort` render (engine.md section 5). `sorter` picks the sorting
 implementation; both give the same bytes.
 */
export async function renderPixelSort(
	input: RgbaImage,
	output: RgbaImage,
	params: PixelSortParams,
	ctx: RenderContext,
	sorter: Sorter = 'radix',
): Promise<void> {
	const {width, height} = input;
	const pixelCount = width * height;
	const in32 = inputWords(input);
	const outAligned = output.data.byteOffset % 4 === 0;
	const out32 = outAligned
		? new Uint32Array(output.data.buffer, output.data.byteOffset, pixelCount)
		: new Uint32Array(pixelCount);

	const partition = createLinePartition(width, height, params.angle);
	const capacity = partition.maxLineLength;
	const pixels = scratch32(ctx, SLOT_PIXELS, capacity);
	const out = scratch32(ctx, SLOT_OUT, capacity);
	const line: LineBuffers = {
		pixels,
		bytes: byteView(pixels),
		out,
		outBytes: byteView(out),
		keys: scratch16(ctx, SLOT_KEYS, capacity),
		selected: ctx.scratch(SLOT_SELECTED, capacity),
		packed: scratch32(ctx, SLOT_PACKED, capacity),
		spare: scratch32(ctx, SLOT_SPARE, capacity),
		counts: scratchInt32(ctx, SLOT_COUNTS, 512),
	};

	const mode = params.intervalMode;
	const edgeRadius = mode === 'edges' ? ctx.px(params.edgeBlur) : 0;
	const edgePasses = mode === 'edges' ? (edgeRadius > 0 ? 4 : 2) : 0;
	const totalWork = pixelCount * (edgePasses + 1);
	let paced = 0;
	let sinceCheckpoint = 0;
	const pace = (count: number): void | Promise<void> => {
		paced += count;
		if (sinceCheckpoint > 0 && sinceCheckpoint + count > CHECKPOINT_PIXELS) {
			sinceCheckpoint = count;
			ctx.progress((paced - count) / totalWork);
			return ctx.checkpoint();
		}

		sinceCheckpoint += count;
	};

	const edgeMap =
		mode === 'edges'
			? await computeEdgeSelection(
					input,
					params.edgeThreshold,
					edgeRadius,
					params.invert,
					ctx.scratch(SLOT_EDGE_FIRST, pixelCount),
					ctx.scratch(SLOT_EDGE_SECOND, pixelCount),
					scratchInt32(ctx, SLOT_EDGE_SUMS, width),
					pace,
				)
			: undefined;
	const offsets = edgeMap
		? scratchInt32(ctx, SLOT_OFFSETS, capacity)
		: undefined;

	const lo16 = thresholdBound(params.threshold[0]);
	const hi16 = thresholdBound(params.threshold[1]);
	const showSelection = ctx.debugView === 'selection';
	const settings: SortSettings = {
		seed: params.seed,
		scaledMaxLength: ctx.pxLength(params.maxLength),
		lengthJitter: params.lengthJitter,
		skipChance: params.skipChance,
		sortKey: params.sortKey,
		keysReady: mode === 'threshold' && params.selectKey === params.sortKey,
		order: params.order,
		divisor: params.discretize * 257,
		fill: params.fill,
		sorter,
	};

	const walker = partition.createWalker();
	while (walker.next()) {
		const {length} = walker;
		const pending = pace(length);
		if (pending) {
			await pending;
		}

		walker.gather32(in32, pixels);
		if (edgeMap && offsets) {
			walker.fillOffsets(offsets);
			selectFromMap(edgeMap, offsets, length, line.selected);
		} else if (mode === 'threshold') {
			fillKeys(params.selectKey, line.bytes, 0, length, line.keys);
			selectThreshold(
				line.bytes,
				line.keys,
				length,
				lo16,
				hi16,
				params.invert,
				line.selected,
			);
		} else {
			selectWhole(line.bytes, length, line.selected);
		}

		if (showSelection) {
			writeSelectionView(line.bytes, line.selected, length, line.outBytes);
		} else {
			renderLine(
				line,
				settings,
				ctx,
				length,
				// eslint-disable-next-line no-bitwise -- the source line id is a uint32 hash key (engine.md section 5.2)
				ctx.toSource(walker.k) >>> 0,
				walker.posStart,
				walker.posStep,
			);
		}

		walker.scatter32(out, out32);
	}

	if (!outAligned) {
		output.data.set(byteView(out32));
	}

	ctx.progress(1);
}

export const pixelSortEffect: EffectDefinition<PixelSortParams> = {
	type: 'pixelSort',
	version: 1,
	label: 'Pixel sort',
	description:
		'Sort runs of pixels along a direction by brightness, hue or a channel.',
	category: 'sort',
	params: paramSpecs,
	debugViews: ['selection'],
	render: async (input, output, renderParams, ctx) =>
		renderPixelSort(input, output, renderParams, ctx),
};
