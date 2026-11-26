import {validateParams} from '@/engine/params.ts';
import type {ParamSpec, ParamSpecs, ParamValue} from '@/engine/types.ts';

/**
 A source of numbers in [0, 1), like `Math.random`. Tests pass a deterministic
 one.
 */
export type RandomSource = () => number;

const SEED_VALUES = 2 ** 32;
const ANGLE_VALUES = 3600;
// Tolerance for a bound that is a step multiple only up to floating-point error.
const GRID_EPSILON = 1e-9;

export const cryptoRandom: RandomSource = () => {
	const [value] = globalThis.crypto.getRandomValues(new Uint32Array(1));
	return value / SEED_VALUES;
};

function pickIndex(random: RandomSource, count: number): number {
	return Math.min(count - 1, Math.floor(random() * count));
}

/**
 Uniform over the multiples of `step` inside `[min, max]`. Steps count from 0,
 as in `validateParams`. When no multiple fits, the draw is uniform over the
 interval and validation clamps it.
 */
function drawStepped(
	random: RandomSource,
	min: number,
	max: number,
	step: number,
): number {
	const first = Math.ceil(min / step - GRID_EPSILON);
	const last = Math.floor(max / step + GRID_EPSILON);
	return last < first
		? min + random() * (max - min)
		: (first + pickIndex(random, last - first + 1)) * step;
}

function drawOne(spec: ParamSpec, random: RandomSource): ParamValue {
	switch (spec.kind) {
		case 'number': {
			return drawStepped(random, spec.min, spec.max, spec.step);
		}

		case 'integer': {
			return drawStepped(random, spec.min, spec.max, 1);
		}

		case 'angle': {
			return pickIndex(random, ANGLE_VALUES) / 10;
		}

		case 'range': {
			const first = drawStepped(random, spec.min, spec.max, spec.step);
			const second = drawStepped(random, spec.min, spec.max, spec.step);
			return [first, second];
		}

		case 'enum': {
			return spec.options.length === 0
				? spec.default
				: spec.options[pickIndex(random, spec.options.length)].value;
		}

		case 'boolean': {
			return random() < 0.5;
		}

		case 'seed': {
			return Math.floor(random() * SEED_VALUES);
		}

		// Only the user can choose an image.
		case 'image': {
			return spec.default;
		}
	}
}

/**
 A random valid value for every parameter of a schema. It reads only the
 specs, so it needs no knowledge of any effect, and it draws in schema key
 order so one random source gives one result. The values go through
 `validateParams`, the same normalisation the store applies to a commit.
 */
export function randomizeParams<P extends Record<string, ParamValue>>(
	specs: ParamSpecs<P>,
	random: RandomSource,
): P {
	const drawn: Record<string, ParamValue> = {};
	for (const [key, spec] of Object.entries<ParamSpec>(specs)) {
		drawn[key] = drawOne(spec, random);
	}

	return validateParams(specs, drawn);
}
