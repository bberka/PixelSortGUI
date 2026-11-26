/* eslint-disable no-bitwise -- the film grain takes bytes out of a uint32 hash */
import {hash32} from '@/engine/random.ts';
import type {RgbaImage} from '@/engine/types.ts';

export const SAMPLE_WIDTH = 1200;
export const SAMPLE_HEIGHT = 900;

type Colour = readonly [number, number, number];

const SKY: ReadonlyArray<readonly [number, Colour]> = [
	[0, [14, 18, 52]],
	[0.34, [66, 38, 108]],
	[0.62, [190, 62, 122]],
	[0.84, [247, 126, 88]],
	[1, [255, 201, 120]],
];

// Back to front: each ridge covers the one before it.
const RIDGES = [
	{base: 0.55, height: 0.17, peaks: 2.3, phase: 0.9, colour: [104, 58, 128]},
	{base: 0.6, height: 0.13, peaks: 3.4, phase: 2.6, colour: [58, 36, 98]},
	{base: 0.64, height: 0.09, peaks: 5.2, phase: 4.1, colour: [20, 20, 50]},
] as const;

const HORIZON = 0.66;
const SUN = {x: 0.66, y: 0.37, radius: 0.19} as const;
const GRAIN_SEED = 0x5a_11;

function mix(from: Colour, to: Colour, amount: number): Colour {
	return [
		from[0] + (to[0] - from[0]) * amount,
		from[1] + (to[1] - from[1]) * amount,
		from[2] + (to[2] - from[2]) * amount,
	];
}

function skyAt(t: number): Colour {
	const upper = SKY.findIndex(([stop]) => t <= stop);
	if (upper <= 0) {
		return upper === 0 ? SKY[0][1] : SKY.at(-1)![1];
	}

	const [from, fromColour] = SKY[upper - 1];
	const [to, toColour] = SKY[upper];
	return mix(fromColour, toColour, (t - from) / (to - from));
}

// 0..1, higher at a peak. Two folded sine waves give sharp summits.
function ridgeProfile(u: number, peaks: number, phase: number): number {
	const wide = 1 - Math.abs(Math.sin(u * Math.PI * peaks + phase));
	const fine = 1 - Math.abs(Math.sin(u * Math.PI * peaks * 3.1 + phase * 2));
	return wide * 0.75 + fine * 0.25;
}

/**
 The scene above the horizon at `(u, v)`, both 0..1 of the full picture.
 `aspect` is width over height, so the sun stays round.
 */
function landAt(u: number, v: number, aspect: number): Colour {
	for (let index = RIDGES.length - 1; index >= 0; index--) {
		const ridge = RIDGES[index];
		const top =
			ridge.base - ridge.height * ridgeProfile(u, ridge.peaks, ridge.phase);
		if (v >= top) {
			// Haze lifts the foot of each ridge.
			return mix(ridge.colour, [168, 82, 128], Math.max(0, v - top) * 1.2);
		}
	}

	const sky = skyAt(v / HORIZON);
	const dx = (u - SUN.x) * aspect;
	const dy = v - SUN.y;
	const distance = Math.hypot(dx, dy) / SUN.radius;
	if (distance <= 1) {
		// Slits that widen toward the bottom of the sun.
		const lower = (dy / SUN.radius + 1) / 2;
		const slit = lower > 0.52 && (lower * 15) % 1 < (lower - 0.5) * 1.1;
		if (!slit) {
			return mix([255, 240, 170], [255, 92, 112], lower);
		}
	}

	const glow = Math.max(0, 1 - (distance - 1) / 1.4);
	return mix(sky, [255, 150, 120], distance > 1 ? glow * glow * 0.45 : 0);
}

function waterAt(u: number, v: number, aspect: number): Colour {
	const depth = (v - HORIZON) / (1 - HORIZON);
	const ripple =
		Math.sin(depth * depth * 90 + Math.sin(u * 17) * 1.6) *
		(0.004 + depth * 0.02);
	const mirrored = landAt(
		u + ripple,
		HORIZON - (v - HORIZON) * 1.15 + ripple * 0.5,
		aspect,
	);
	const water = mix(mirrored, [10, 24, 54], 0.28 + depth * 0.5);
	const glint = Math.sin(depth * 150 + u * 9) > 0.86 ? 1 : 0;
	const beam = Math.max(0, 1 - Math.abs(u - SUN.x) / (0.06 + depth * 0.16));
	return mix(water, [255, 214, 160], glint * beam * 0.85);
}

/**
 The picture behind "Try a sample" and the effect previews (product.md F2): an
 original dusk landscape drawn from numbers, so no photo file is bundled. Its
 edges and bright bands give every effect something to work on. It is the same
 for the same size every time.
 */
export function renderSampleImage(
	width: number = SAMPLE_WIDTH,
	height: number = SAMPLE_HEIGHT,
): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	const aspect = width / height;
	for (let y = 0; y < height; y++) {
		const v = (y + 0.5) / height;
		for (let x = 0; x < width; x++) {
			const u = (x + 0.5) / width;
			const colour = v < HORIZON ? landAt(u, v, aspect) : waterAt(u, v, aspect);
			const grain = (hash32(GRAIN_SEED, x, y) & 7) - 3.5;
			const offset = (y * width + x) * 4;
			data[offset] = colour[0] + grain;
			data[offset + 1] = colour[1] + grain;
			data[offset + 2] = colour[2] + grain;
			data[offset + 3] = 255;
		}
	}

	return {width, height, data};
}

/**
Encodes the full-size sample as a PNG, like any imported photo.
*/
export async function createSampleBlob(): Promise<Blob> {
	const image = renderSampleImage();
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = image.width;
	canvas.height = image.height;
	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('2D context unavailable');
	}

	const pixels = context.createImageData(image.width, image.height);
	pixels.data.set(image.data);
	context.putImageData(pixels, 0, 0);
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error('The browser could not encode the sample'));
			}
		}, 'image/png');
	});
}
