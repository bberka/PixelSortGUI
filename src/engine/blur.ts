// Called before each row with the row's pixel count; the caller checkpoints from it.
export type Pace = (pixels: number) => void | Promise<void>;

/**
 One row of a box blur of `radius`, coordinates clamped to the row. Each output
 is `floorDiv(2 * sum + n, 2 * n)` with `n = 2 * radius + 1`.
 */
export function blurRow(
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

// The same blur down every column, one row at a time. `sums` holds `width` entries.
export async function blurColumns(
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
