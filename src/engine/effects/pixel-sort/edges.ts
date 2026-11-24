import type {RgbaImage} from '../../types.ts';

// Called before each row with the row's pixel count; the caller checkpoints from it.
export type Pace = (pixels: number) => void | Promise<void>;

function blurRow(
	from: Uint8Array,
	to: Uint8Array,
	row: number,
	width: number,
	radius: number,
): void {
	const window = 2 * radius + 1;
	const den = 2 * window;
	const last = width - 1;
	let sum = (radius + 1) * from[row];
	for (let d = 1; d <= radius; d++) {
		sum += from[row + Math.min(d, last)];
	}

	for (let x = 0; x < width; x++) {
		to[row + x] = Math.floor((2 * sum + window) / den);
		sum +=
			from[row + Math.min(x + radius + 1, last)] -
			from[row + Math.max(x - radius, 0)];
	}
}

async function blurColumns(
	from: Uint8Array,
	to: Uint8Array,
	width: number,
	height: number,
	radius: number,
	sums: Int32Array,
	pace: Pace,
): Promise<void> {
	const window = 2 * radius + 1;
	const den = 2 * window;
	const last = height - 1;
	for (let x = 0; x < width; x++) {
		sums[x] = (radius + 1) * from[x];
	}

	for (let d = 1; d <= radius; d++) {
		const row = Math.min(d, last) * width;
		for (let x = 0; x < width; x++) {
			sums[x] += from[row + x];
		}
	}

	for (let y = 0; y < height; y++) {
		const pending = pace(width);
		if (pending) {
			await pending;
		}

		const row = y * width;
		const entering = Math.min(y + radius + 1, last) * width;
		const leaving = Math.max(y - radius, 0) * width;
		for (let x = 0; x < width; x++) {
			const sum = sums[x];
			to[row + x] = Math.floor((2 * sum + window) / den);
			sums[x] = sum + from[entering + x] - from[leaving + x];
		}
	}
}

/**
 The edge selection of engine.md section 5.4: one byte per pixel in `second`,
 1 where the pixel is selected. `first` and `second` hold `width * height`
 bytes each and `sums` holds `width` entries; all three are overwritten.
 `radius` is the blur radius in render pixels.
 */
export async function computeEdgeSelection(
	input: RgbaImage,
	edgeThreshold: number,
	radius: number,
	invert: boolean,
	first: Uint8Array,
	second: Uint8Array,
	sums: Int32Array,
	pace: Pace,
): Promise<Uint8Array> {
	const {width, height, data} = input;

	for (let y = 0; y < height; y++) {
		const pending = pace(width);
		if (pending) {
			await pending;
		}

		let p = y * width * 4;
		const end = (y + 1) * width;
		for (let i = y * width; i < end; i++, p += 4) {
			first[i] = Math.floor(
				(2126 * data[p] + 7152 * data[p + 1] + 722 * data[p + 2] + 5000) /
					10_000,
			);
		}
	}

	if (radius > 0) {
		for (let y = 0; y < height; y++) {
			const pending = pace(width);
			if (pending) {
				await pending;
			}

			blurRow(first, second, y * width, width, radius);
		}

		await blurColumns(second, first, width, height, radius, sums, pace);
	}

	const t = Math.round(edgeThreshold * 1000);
	const limit = 1020 * t * (1020 * t);
	const lastX = width - 1;
	const lastY = height - 1;
	const selectedEdge = invert ? 1 : 0;
	for (let y = 0; y < height; y++) {
		const pending = pace(width);
		if (pending) {
			await pending;
		}

		const row = y * width;
		const above = (y > 0 ? y - 1 : 0) * width;
		const below = (y < lastY ? y + 1 : lastY) * width;
		for (let x = 0; x < width; x++) {
			const left = x > 0 ? x - 1 : 0;
			const right = x < lastX ? x + 1 : lastX;
			const gx =
				first[above + right] +
				2 * first[row + right] +
				first[below + right] -
				(first[above + left] + 2 * first[row + left] + first[below + left]);
			const gy =
				first[below + left] +
				2 * first[below + x] +
				first[below + right] -
				(first[above + left] + 2 * first[above + x] + first[above + right]);
			const isEdge = 1_000_000 * (gx * gx + gy * gy) >= limit ? 1 : 0;
			second[row + x] =
				data[4 * (row + x) + 3] !== 0 && isEdge === selectedEdge ? 1 : 0;
		}
	}

	return second;
}
