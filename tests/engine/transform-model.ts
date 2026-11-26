// Naive transcriptions of engine.md section 16.3 with BigInt sums and no shared
// code with src/engine/transform.ts.
import {LANCZOS_TABLE} from '../../src/engine/lanczos-table.ts';
import type {RgbaImage} from '../../src/engine/types.ts';

function floorDivBig(a: bigint, b: bigint): bigint {
	const q = a / b;
	return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

const clampByte = (v: bigint) => Number(v < 0n ? 0n : v > 255n ? 255n : v);

function premultiplied(source: RgbaImage, x: number, y: number): bigint[] {
	const p = (y * source.width + x) * 4;
	const [r, g, b, a] = source.data.subarray(p, p + 4);
	return [BigInt(r * a), BigInt(g * a), BigInt(b * a), BigInt(a)];
}

type Tap = {index: number; weight: bigint};

function lanczosTaps(sourceSize: number, targetSize: number, d: number): Tap[] {
	const m = Math.max(sourceSize, targetSize);
	const raws: Array<{index: number; raw: number}> = [];
	for (let i = 0; i < sourceSize; i++) {
		const n = Math.abs(
			2 * targetSize * i - ((2 * d + 1) * sourceSize - targetSize),
		);
		if (n >= 6 * m) {
			continue;
		}

		const q = Math.floor((1023 * n) / (6 * m));
		const f = 1023 * n - q * 6 * m;
		const sum =
			BigInt(LANCZOS_TABLE[q]) * BigInt(6 * m - f) +
			BigInt(LANCZOS_TABLE[q + 1]) * BigInt(f) +
			BigInt(3 * m);
		raws.push({index: i, raw: Number(floorDivBig(sum, BigInt(6 * m)))});
	}

	const total = raws.reduce((sum, {raw}) => sum + raw, 0);
	const taps = raws.map(({index, raw}) => {
		const x = (raw * 2 ** 22) / total;
		return {
			index,
			weight: BigInt(Math.sign(x) * Math.floor(Math.abs(x) + 0.5)),
		};
	});
	const largest = raws.findIndex(
		({raw}) => raw === Math.max(...raws.map((tap) => tap.raw)),
	);
	taps[largest].weight +=
		2n ** 22n - taps.reduce((sum, {weight}) => sum + weight, 0n);
	return taps;
}

export function modelLanczos(
	source: RgbaImage,
	width: number,
	height: number,
): number[] {
	const xs = Array.from({length: width}, (_, d) =>
		lanczosTaps(source.width, width, d),
	);
	// Every source row filtered up front, unlike the ring in the engine.
	const rows = Array.from({length: source.height}, (_, y) =>
		xs.map((taps) =>
			[0, 1, 2, 3].map((c) => {
				let sum = 0n;
				for (const {index, weight} of taps) {
					sum += weight * premultiplied(source, index, y)[c];
				}

				return floorDivBig(sum + 2n ** 13n, 2n ** 14n);
			}),
		),
	);
	const out: number[] = [];
	for (let dy = 0; dy < height; dy++) {
		const taps = lanczosTaps(source.height, height, dy);
		for (let dx = 0; dx < width; dx++) {
			const v = [0, 1, 2, 3].map((c) => {
				let sum = 0n;
				for (const {index, weight} of taps) {
					sum += weight * rows[index][dx][c];
				}

				return sum;
			});
			const alpha = clampByte(floorDivBig(v[3] + 2n ** 29n, 2n ** 30n));
			if (alpha === 0) {
				out.push(0, 0, 0, 0);
				continue;
			}

			for (let c = 0; c < 3; c++) {
				out.push(clampByte(floorDivBig(2n * v[c] + v[3], 2n * v[3])));
			}

			out.push(alpha);
		}
	}

	return out;
}

// Premultiplied bilinear, for sizes where at least one axis grows.
export function modelBilinear(
	source: RgbaImage,
	width: number,
	height: number,
): number[] {
	const axis = (sourceSize: number, targetSize: number, d: number) => {
		const unit = 2 * targetSize;
		const n = Math.min(
			Math.max((2 * d + 1) * sourceSize - targetSize, 0),
			(sourceSize - 1) * unit,
		);
		const i0 = Math.floor(n / unit);
		const f = n - i0 * unit;
		return [
			{index: i0, weight: BigInt(unit - f)},
			{index: Math.min(i0 + 1, sourceSize - 1), weight: BigInt(f)},
		];
	};

	const total = BigInt(4 * width * height);
	const out: number[] = [];
	for (let dy = 0; dy < height; dy++) {
		for (let dx = 0; dx < width; dx++) {
			const sums = [0n, 0n, 0n, 0n];
			for (const y of axis(source.height, height, dy)) {
				for (const x of axis(source.width, width, dx)) {
					const sample = premultiplied(source, x.index, y.index);
					for (let c = 0; c < 4; c++) {
						sums[c] += x.weight * y.weight * sample[c];
					}
				}
			}

			if (sums[3] === 0n) {
				out.push(0, 0, 0, 0);
				continue;
			}

			for (let c = 0; c < 3; c++) {
				out.push(Number(floorDivBig(2n * sums[c] + sums[3], 2n * sums[3])));
			}

			out.push(Number(floorDivBig(2n * sums[3] + total, 2n * total)));
		}
	}

	return out;
}

// Textbook Lanczos-3 in doubles on one opaque channel, with no table.
export function idealLanczos(
	source: RgbaImage,
	width: number,
	height: number,
): number[] {
	const kernel = (t: number) => {
		if (t === 0) {
			return 1;
		}

		const x = Math.PI * t;
		return t < 3 ? (3 * Math.sin(x) * Math.sin(x / 3)) / (x * x) : 0;
	};

	const taps = (sourceSize: number, targetSize: number, d: number) => {
		const centre = ((d + 0.5) * sourceSize) / targetSize - 0.5;
		const stretch = Math.min(1, targetSize / sourceSize);
		const weights = Array.from({length: sourceSize}, (_, i) =>
			kernel(Math.abs(i - centre) * stretch),
		);
		const sum = weights.reduce((a, b) => a + b, 0);
		return weights.map((w) => w / sum);
	};

	const xs = Array.from({length: width}, (_, d) =>
		taps(source.width, width, d),
	);
	const out: number[] = [];
	for (let dy = 0; dy < height; dy++) {
		const wy = taps(source.height, height, dy);
		for (let dx = 0; dx < width; dx++) {
			for (let c = 0; c < 3; c++) {
				let sum = 0;
				for (let y = 0; y < source.height; y++) {
					for (let x = 0; x < source.width; x++) {
						sum +=
							wy[y] * xs[dx][x] * source.data[(y * source.width + x) * 4 + c];
					}
				}

				out.push(Math.min(255, Math.max(0, Math.round(sum))));
			}

			out.push(255);
		}
	}

	return out;
}
