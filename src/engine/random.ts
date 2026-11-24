/* eslint-disable no-bitwise -- the hash is defined in 32-bit integer operations (engine.md section 10.1) */

export function mix32(x: number): number {
	x ^= x >>> 16;
	x = Math.imul(x, 0x7f_eb_35_2d);
	x ^= x >>> 15;
	x = Math.imul(x, 0x84_6c_a6_8b);
	x ^= x >>> 16;
	return x >>> 0;
}

export function hash32(seed: number, ...keys: number[]): number {
	let h = mix32(seed >>> 0);
	for (const key of keys) {
		h = mix32((h ^ (key >>> 0)) >>> 0);
	}

	return h;
}

export function unit(seed: number, ...keys: number[]): number {
	return hash32(seed, ...keys) / 4_294_967_296;
}

export function intIn(
	lo: number,
	hi: number,
	seed: number,
	...keys: number[]
): number {
	return lo + Math.floor(unit(seed, ...keys) * (hi - lo + 1));
}
