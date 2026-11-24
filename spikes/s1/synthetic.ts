/* eslint-disable no-bitwise -- Deterministic lowbias32 hashing and integer pixel synthesis */
const WAVE_TABLE_SIZE = 1024;
const WAVE_TABLE = new Int32Array(WAVE_TABLE_SIZE);
for (let i = 0; i < WAVE_TABLE_SIZE; i++) {
	WAVE_TABLE[i] = Math.round(
		Math.sin((i / WAVE_TABLE_SIZE) * Math.PI * 2) * 128,
	);
}

function mix32(x: number): number {
	let v = x >>> 0;
	v ^= v >>> 16;
	v = Math.imul(v, 0x7f_eb_35_2d);
	v ^= v >>> 15;
	v = Math.imul(v, 0x84_6c_a6_8b);
	v ^= v >>> 16;
	return v >>> 0;
}

function clampByte(v: number): number {
	return Math.max(0, Math.min(255, v));
}

export function generateSyntheticPhoto(
	width: number,
	height: number,
	seed = 0x51_50_52_54,
): Uint8ClampedArray<ArrayBuffer> {
	const buffer = new ArrayBuffer(width * height * 4);
	const data = new Uint8ClampedArray(buffer);
	const invW = 1 / width;
	const invH = 1 / height;

	const sunX = Math.floor(width * 0.72);
	const sunY = Math.floor(height * 0.24);
	const sunRadiusSq = Math.floor(Math.min(width, height) * 0.14) ** 2;

	const discX = Math.floor(width * 0.28);
	const discY = Math.floor(height * 0.62);
	const discRadiusSq = Math.floor(Math.min(width, height) * 0.18) ** 2;

	const bandLeft = Math.floor(width * 0.42);
	const bandRight = Math.floor(width * 0.56);
	const horizonBase = Math.floor(height * 0.54);

	let idx = 0;
	for (let y = 0; y < height; y++) {
		const ny = y * invH;
		const rowWave = WAVE_TABLE[Math.floor(ny * 3 * WAVE_TABLE_SIZE) & 1023];
		const rowHashBase = mix32((seed ^ Math.imul(y, 0x9e_37_79_b1)) >>> 0);
		const dySun = y - sunY;
		const dySunSq = dySun * dySun;
		const dyDisc = y - discY;
		const dyDiscSq = dyDisc * dyDisc;

		for (let x = 0; x < width; x++) {
			const nx = x * invW;
			const colWave =
				WAVE_TABLE[Math.floor((nx * 5 + ny * 2) * WAVE_TABLE_SIZE) & 1023];
			const horizon = horizonBase + ((colWave * height) >> 11);

			let r: number;
			let g: number;
			let b: number;

			if (y < horizon) {
				// Sky gradient with soft cloud modulation
				const t = y / Math.max(1, horizon);
				const cloud = (rowWave + colWave) >> 3;
				r = Math.floor(55 + t * 155) + cloud;
				g = Math.floor(95 + t * 120) + cloud;
				b = Math.floor(175 + t * 65) + (cloud >> 1);
			} else {
				// Foreground landscape gradient with darker ridges
				const t = (y - horizon) / Math.max(1, height - horizon);
				const ridge = (rowWave * 3 - colWave) >> 4;
				r = Math.floor(125 - t * 85) + ridge;
				g = Math.floor(105 - t * 65) + ridge;
				b = Math.floor(85 - t * 50) + (ridge >> 1);
			}

			// Bright highlight disc (> 0.80 luma) to create threshold boundaries
			const dxSun = x - sunX;
			if (dxSun * dxSun + dySunSq < sunRadiusSq) {
				r = 248;
				g = 242;
				b = 220;
			}

			// Dark shadow disc (< 0.25 luma) to break runs
			const dxDisc = x - discX;
			if (dxDisc * dxDisc + dyDiscSq < discRadiusSq) {
				r = 28 + (colWave >> 4);
				g = 34 + (rowWave >> 4);
				b = 46;
			}

			// Architectural mid-tone / dark-edge vertical pillar
			if (x >= bandLeft && x <= bandRight && y > Math.floor(height * 0.2)) {
				const pillarEdge =
					x - bandLeft < Math.max(4, width >> 8) ||
					bandRight - x < Math.max(4, width >> 8);
				if (pillarEdge) {
					r = 22;
					g = 24;
					b = 28;
				} else {
					const stripe = ((x + y) >> 5) & 1 ? 18 : -18;
					r = 148 + stripe;
					g = 128 + stripe;
					b = 112 + stripe;
				}
			}

			// Deterministic sensor grain (±14)
			const h = mix32((rowHashBase ^ Math.imul(x, 0x85_eb_ca_6b)) >>> 0);
			const grain = ((h & 31) - 16) * 1;
			const chromaGrain = (((h >>> 8) & 15) - 8) >> 1;

			data[idx] = clampByte(r + grain);
			data[idx + 1] = clampByte(g + grain + chromaGrain);
			data[idx + 2] = clampByte(b + grain - chromaGrain);
			data[idx + 3] = 255;
			idx += 4;
		}
	}

	return data;
}
