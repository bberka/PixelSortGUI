import {clamp} from '../math.ts';
import {intIn, unit} from '../random.ts';
import type {EffectDefinition} from '../types.ts';
import {
	blockShuffleSpec,
	type BlockShuffleParams,
} from './block-shuffle-spec.ts';

const CHECKPOINT_PIXELS = 16_384;

// Purpose codes for the random draws (engine.md section 16.1).
const P_ACTIVE = 1;
const P_PARTNER = 2;

// `result[t]` is the source tile shown at grid position `t`.
function permutation(
	count: number,
	{amount, seed}: BlockShuffleParams,
): Int32Array {
	const tiles = new Int32Array(count);
	for (let t = 0; t < count; t++) {
		tiles[t] = t;
	}

	for (let t = 0; t < count; t++) {
		if (!(unit(seed, P_ACTIVE, t) < amount)) {
			continue;
		}

		const other = intIn(0, count - 1, seed, P_PARTNER, t);
		const held = tiles[t];
		tiles[t] = tiles[other];
		tiles[other] = held;
	}

	return tiles;
}

export const blockShuffleEffect: EffectDefinition<BlockShuffleParams> = {
	...blockShuffleSpec,
	async render(input, output, params, ctx) {
		const {width, height, data: src} = input;
		const dst = output.data;
		const {scale} = ctx;
		const size = params.tileSize;
		// Only full source tiles move; the right and bottom remainders stay.
		const cols = Math.floor(ctx.sourceWidth / size);
		const rows = Math.floor(ctx.sourceHeight / size);
		const tiles = permutation(cols * rows, params);

		// Tile column of each render column, and where each run of one column ends.
		const columns = new Int32Array(width);
		const columnEnds: number[] = [];
		for (let x = 0; x < width; x++) {
			columns[x] = Math.floor((x + 0.5) / scale / size);
			if (x > 0 && columns[x] !== columns[x - 1]) {
				columnEnds.push(x);
			}
		}

		columnEnds.push(width);

		const rowsPerChunk = Math.max(1, Math.floor(CHECKPOINT_PIXELS / width));

		for (let yStart = 0; yStart < height; yStart += rowsPerChunk) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const yEnd = Math.min(height, yStart + rowsPerChunk);
			for (let y = yStart; y < yEnd; y++) {
				const rowStart = y * width * 4;
				const ys = (y + 0.5) / scale;
				const ty = Math.floor(ys / size);

				let start = 0;
				for (const end of columnEnds) {
					const tx = columns[start];
					const tile = ty * cols + tx;
					const from = tx < cols && ty < rows ? tiles[tile] : tile;
					if (from === tile) {
						dst.set(
							src.subarray(rowStart + start * 4, rowStart + end * 4),
							rowStart + start * 4,
						);
						start = end;
						continue;
					}

					const dx = ((from % cols) - tx) * size;
					const dy = (Math.floor(from / cols) - ty) * size;
					const sy = clamp(Math.floor((ys + dy) * scale), 0, height - 1);
					for (let x = start; x < end; x++) {
						const xs = (x + 0.5) / scale;
						const sx = clamp(Math.floor((xs + dx) * scale), 0, width - 1);
						const read = (sy * width + sx) * 4;
						const write = rowStart + x * 4;
						dst[write] = src[read];
						dst[write + 1] = src[read + 1];
						dst[write + 2] = src[read + 2];
						dst[write + 3] = src[read + 3];
					}

					start = end;
				}
			}

			ctx.progress(yEnd / height);
		}
	},
};

export {type BlockShuffleParams} from './block-shuffle-spec.ts';
