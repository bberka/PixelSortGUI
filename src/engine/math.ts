export function floorDiv(a: number, b: number): number {
	return Math.floor(a / b);
}

export function roundHalfAway(x: number): number {
	return Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
}

export function clamp(v: number, lo: number, hi: number): number {
	return Math.min(Math.max(v, lo), hi);
}

export function wrap(v: number, n: number): number {
	return ((v % n) + n) % n;
}
