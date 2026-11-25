import {clamp} from '@/engine/math.ts';

export type StepKey = {
	readonly key: string;
	readonly shiftKey: boolean;
};

const PAGE_STEPS = 10;

function stepDelta(event: StepKey, step: number): number | null {
	const scale = event.shiftKey ? PAGE_STEPS : 1;
	switch (event.key) {
		case 'ArrowRight':
		case 'ArrowUp':
		case 'PageUp': {
			return step * scale;
		}

		case 'ArrowLeft':
		case 'ArrowDown':
		case 'PageDown': {
			return -step * scale;
		}

		default: {
			return null;
		}
	}
}

/**
 The value a focused slider moves to for a key press (DESIGN.md section 8.3):
 one step per Arrow, ten per Shift+Arrow or Page Up/Down, and the ends for
 Home/End. `null` means the key is not a slider key.
 */
export function steppedValue(
	event: StepKey,
	range: {readonly min: number; readonly max: number; readonly step: number},
	current: number,
): number | null {
	if (event.key === 'Home') {
		return range.min;
	}

	if (event.key === 'End') {
		return range.max;
	}

	const delta = stepDelta(event, range.step);
	return delta === null ? null : clamp(current + delta, range.min, range.max);
}

const ANGLE_STEP = 1;
const ANGLE_LARGE_STEP = 15;
const MAX_ANGLE = 359.9;

function wrapAngle(value: number): number {
	const rounded = Math.round(value * 10) / 10;
	const wrapped = rounded % 360;
	return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 The angle a focused dial moves to (DESIGN.md section 5.1): 1° per Arrow, 15°
 per Shift+Arrow or Page Up/Down, Home to 0° and End to the largest stored
 angle. `null` means the key is not a dial key.
 */
export function dialValue(event: StepKey, current: number): number | null {
	switch (event.key) {
		case 'ArrowRight':
		case 'ArrowUp': {
			return wrapAngle(
				current + (event.shiftKey ? ANGLE_LARGE_STEP : ANGLE_STEP),
			);
		}

		case 'ArrowLeft':
		case 'ArrowDown': {
			return wrapAngle(
				current - (event.shiftKey ? ANGLE_LARGE_STEP : ANGLE_STEP),
			);
		}

		case 'PageUp': {
			return wrapAngle(current + ANGLE_LARGE_STEP);
		}

		case 'PageDown': {
			return wrapAngle(current - ANGLE_LARGE_STEP);
		}

		case 'Home': {
			return 0;
		}

		case 'End': {
			return MAX_ANGLE;
		}

		default: {
			return null;
		}
	}
}

/**
 The nearest snap point within 4° of `angle`, or `angle` itself. The distance
 is circular, so 358° snaps to 0°.
 */
export function snapAngle(
	angle: number,
	snaps: readonly number[],
	tolerance = 4,
): number {
	let best = angle;
	let bestDistance = tolerance;
	for (const snap of snaps) {
		const raw = Math.abs(angle - snap);
		const distance = Math.min(raw, 360 - raw);
		if (!(distance <= bestDistance)) {
			continue;
		}

		best = snap;
		bestDistance = distance;
	}

	return best;
}
