import type {SortKey} from '../../keys.ts';
import {createLinePartition} from '../../lines.ts';
import type {EffectDefinition, RenderContext, RgbaImage} from '../../types.ts';
import {computeEdgeSelection} from './edges.ts';
import {
	fillAverage,
	fillChannelAverage,
	fillChannelGradient,
	fillChannelSort,
	fillGradient,
	fillSort,
	packChannelKeys,
	packKeys,
	packedExtremes,
	shuffleChannelIndices,
	shuffleIndices,
	sortPacked,
	type Sorter,
} from './fill.ts';
import {
	clearMasked,
	fillKeys,
	intervalCap,
	P_CAP,
	P_CHANNEL_ORDER,
	P_ORDER,
	P_SKIP,
	selectFromMap,
	selectThreshold,
	selectWhole,
	thresholdBound,
	unit3,
	unit4,
	writeSelectionView,
} from './select.ts';
import {
	pixelSortSpec,
	type ChannelMode,
	type FillMode,
	type IntervalTransform,
	type PixelSortParams,
	type SortOrder,
} from './spec.ts';

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

const ACTIVE_CHANNELS: Readonly<
	Record<Exclude<ChannelMode, 'rgba'>, readonly number[]>
> = {
	rgb: [0, 1, 2],
	r: [0],
	g: [1],
	b: [2],
};

type SortSettings = {
	readonly seed: number;
	// `ctx.pxLength(maxLength)`; 0 means no limit.
	readonly scaledMaxLength: number;
	readonly lengthJitter: number;
	readonly skipChance: number;
	readonly channelMode: ChannelMode;
	readonly sortKey: SortKey;
	// True when `keys` already holds the sort key for the whole line.
	readonly keysReady: boolean;
	readonly order: SortOrder;
	// `discretize * 257`, or 0.
	readonly divisor: number;
	readonly fill: FillMode;
	readonly intervalTransform: IntervalTransform;
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

function renderChannelInterval(
	line: LineBuffers,
	settings: SortSettings,
	channels: readonly number[],
	start: number,
	length: number,
	lineId: number,
	sourcePosition: number,
): void {
	const {pixels, out, packed} = line;
	const {seed, order, fill, intervalTransform} = settings;
	copyPixels(pixels, out, start, start + length);

	if (fill === 'average') {
		for (const channel of channels) {
			fillChannelAverage(line.bytes, line.outBytes, start, length, channel);
		}

		return;
	}

	if (order === 'shuffle') {
		for (const channel of channels) {
			shuffleChannelIndices(
				packed,
				length,
				seed,
				lineId,
				sourcePosition,
				channel,
			);
			if (fill === 'sort') {
				fillChannelSort(
					line.bytes,
					line.outBytes,
					start,
					length,
					channel,
					packed,
					intervalTransform,
				);
			} else {
				fillChannelGradient(
					line.bytes,
					line.outBytes,
					start,
					length,
					channel,
					packed[0],
					packed[length - 1],
					intervalTransform,
				);
			}
		}

		return;
	}

	for (const channel of channels) {
		const descending =
			order === 'descending' ||
			(order === 'random' &&
				unit4(seed, P_CHANNEL_ORDER, lineId, sourcePosition, channel) >= 0.5);
		packChannelKeys(
			line.bytes,
			start,
			length,
			channel,
			settings.divisor,
			descending,
			packed,
		);
		if (fill === 'sort') {
			const ordered = sortPacked(
				packed,
				line.spare,
				line.counts,
				length,
				settings.sorter,
			);
			fillChannelSort(
				line.bytes,
				line.outBytes,
				start,
				length,
				channel,
				ordered,
				intervalTransform,
			);
		} else {
			const ends = packedExtremes(packed, length);
			fillChannelGradient(
				line.bytes,
				line.outBytes,
				start,
				length,
				channel,
				Math.floor(ends / 65_536),
				ends % 65_536,
				intervalTransform,
			);
		}
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
	const {seed, order, fill, channelMode, intervalTransform} = settings;
	if (
		length === 1 ||
		(settings.skipChance > 0 &&
			unit3(seed, P_SKIP, lineId, sourcePosition) < settings.skipChance)
	) {
		copyPixels(pixels, out, start, start + length);
		return;
	}

	if (channelMode !== 'rgba') {
		renderChannelInterval(
			line,
			settings,
			ACTIVE_CHANNELS[channelMode],
			start,
			length,
			lineId,
			sourcePosition,
		);
		return;
	}

	if (fill === 'average') {
		fillAverage(line.bytes, line.outBytes, start, length);
		return;
	}

	if (order === 'shuffle') {
		shuffleIndices(packed, length, seed, lineId, sourcePosition);
		if (fill === 'sort') {
			fillSort(pixels, out, start, length, packed, intervalTransform);
		} else {
			fillGradient(
				line.bytes,
				line.outBytes,
				start,
				length,
				packed[0],
				packed[length - 1],
				intervalTransform,
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
		fillSort(pixels, out, start, length, ordered, intervalTransform);
	} else {
		const ends = packedExtremes(packed, length);
		fillGradient(
			line.bytes,
			line.outBytes,
			start,
			length,
			Math.floor(ends / 65_536),
			ends % 65_536,
			intervalTransform,
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

// The image as one word per pixel, copied when its bytes are not word aligned.
export function inputWords(image: RgbaImage): Uint32Array {
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
	const {mask} = ctx;
	// Image offsets of the line's pixels, for the maps indexed by image position.
	const offsets =
		edgeMap || mask ? scratchInt32(ctx, SLOT_OFFSETS, capacity) : undefined;

	const lo16 = thresholdBound(params.threshold[0]);
	const hi16 = thresholdBound(params.threshold[1]);
	const showSelection = ctx.debugView === 'selection';
	const settings: SortSettings = {
		seed: params.seed,
		scaledMaxLength: ctx.pxLength(params.maxLength),
		lengthJitter: params.lengthJitter,
		skipChance: params.skipChance,
		channelMode: params.channelMode,
		sortKey: params.sortKey,
		keysReady:
			params.channelMode === 'rgba' &&
			mode === 'threshold' &&
			params.selectKey === params.sortKey,
		order: params.order,
		divisor: params.discretize * 257,
		fill: params.fill,
		intervalTransform: params.intervalTransform,
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
		if (offsets) {
			walker.fillOffsets(offsets);
		}

		if (edgeMap && offsets) {
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

		if (mask && offsets) {
			clearMasked(mask, offsets, length, line.selected);
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
	...pixelSortSpec,
	render: async (input, output, renderParams, ctx) =>
		renderPixelSort(input, output, renderParams, ctx),
};

export {
	type ChannelMode,
	type IntervalMode,
	type IntervalTransform,
	type FillMode,
	type SortOrder,
	type PixelSortParams,
} from './spec.ts';
