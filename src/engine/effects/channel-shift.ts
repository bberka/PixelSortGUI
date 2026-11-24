import {clamp, wrap} from '../math.ts';
import type {EffectDefinition, ParamSpecs} from '../types.ts';

export type ChannelShiftEdge = 'clamp' | 'wrap';

export type ChannelShiftParams = {
	redX: number;
	redY: number;
	greenX: number;
	greenY: number;
	blueX: number;
	blueY: number;
	edge: ChannelShiftEdge;
};

const CHECKPOINT_PIXELS = 16_384;

const channelShiftParams: ParamSpecs<ChannelShiftParams> = {
	redX: {
		kind: 'integer',
		label: 'Red X',
		group: 'Red',
		min: -1024,
		max: 1024,
		default: 6,
		unit: 'px',
	},
	redY: {
		kind: 'integer',
		label: 'Red Y',
		group: 'Red',
		min: -1024,
		max: 1024,
		default: 0,
		unit: 'px',
	},
	greenX: {
		kind: 'integer',
		label: 'Green X',
		group: 'Green',
		min: -1024,
		max: 1024,
		default: 0,
		unit: 'px',
	},
	greenY: {
		kind: 'integer',
		label: 'Green Y',
		group: 'Green',
		min: -1024,
		max: 1024,
		default: 0,
		unit: 'px',
	},
	blueX: {
		kind: 'integer',
		label: 'Blue X',
		group: 'Blue',
		min: -1024,
		max: 1024,
		default: -6,
		unit: 'px',
	},
	blueY: {
		kind: 'integer',
		label: 'Blue Y',
		group: 'Blue',
		min: -1024,
		max: 1024,
		default: 0,
		unit: 'px',
	},
	edge: {
		kind: 'enum',
		label: 'Edge mode',
		group: 'Edges',
		options: [
			{value: 'clamp', label: 'Stretch edge'},
			{value: 'wrap', label: 'Wrap around'},
		],
		default: 'clamp',
	},
};

function mapCoord(value: number, size: number, isWrap: boolean): number {
	return isWrap ? wrap(value, size) : clamp(value, 0, size - 1);
}

export const channelShiftEffect: EffectDefinition<ChannelShiftParams> = {
	type: 'channelShift',
	version: 1,
	label: 'Channel shift',
	description: 'Offset the red, green and blue channels.',
	category: 'glitch',
	params: channelShiftParams,
	async render(input, output, params, ctx) {
		const {width, height, data: src} = input;
		const dst = output.data;
		const rx = ctx.px(params.redX);
		const ry = ctx.px(params.redY);
		const gx = ctx.px(params.greenX);
		const gy = ctx.px(params.greenY);
		const bx = ctx.px(params.blueX);
		const by = ctx.px(params.blueY);

		if (rx === 0 && ry === 0 && gx === 0 && gy === 0 && bx === 0 && by === 0) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			dst.set(src);
			ctx.progress(1);
			return;
		}

		const isWrap = params.edge === 'wrap';
		const rxOffsets = new Int32Array(width);
		const gxOffsets = new Int32Array(width);
		const bxOffsets = new Int32Array(width);
		for (let x = 0; x < width; x++) {
			rxOffsets[x] = mapCoord(x - rx, width, isWrap) * 4;
			gxOffsets[x] = mapCoord(x - gx, width, isWrap) * 4 + 1;
			bxOffsets[x] = mapCoord(x - bx, width, isWrap) * 4 + 2;
		}

		const rowStride = width * 4;
		const rowsPerSlice = Math.max(1, Math.floor(CHECKPOINT_PIXELS / width));

		for (let yStart = 0; yStart < height; yStart += rowsPerSlice) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const yEnd = Math.min(height, yStart + rowsPerSlice);
			for (let y = yStart; y < yEnd; y++) {
				const dstRow = y * rowStride;
				const rRow = mapCoord(y - ry, height, isWrap) * rowStride;
				const gRow = mapCoord(y - gy, height, isWrap) * rowStride;
				const bRow = mapCoord(y - by, height, isWrap) * rowStride;

				for (let x = 0, dstIdx = dstRow; x < width; x++, dstIdx += 4) {
					dst[dstIdx] = src[rRow + rxOffsets[x]];
					dst[dstIdx + 1] = src[gRow + gxOffsets[x]];
					dst[dstIdx + 2] = src[bRow + bxOffsets[x]];
					dst[dstIdx + 3] = src[dstIdx + 3];
				}
			}

			ctx.progress(yEnd / height);
		}
	},
};
