import {clamp, roundHalfAway} from '../math.ts';
import type {EffectDefinition} from '../types.ts';
import {mirrorFoldSpec, type MirrorFoldParams} from './mirror-fold-spec.ts';

const CHECKPOINT_PIXELS = 16_384;

// Source index along one axis: the side away from the source reflects across `c`.
function mirror(v: number, c: number, n: number, flip: boolean): number {
	return (flip ? v < c : v > c) ? clamp(2 * c - v, 0, n - 1) : v;
}

export const mirrorFoldEffect: EffectDefinition<MirrorFoldParams> = {
	...mirrorFoldSpec,
	async render(input, output, params, ctx) {
		const {width, height, data: src} = input;
		const dst = output.data;
		const {mode, flipSource} = params;
		const cx = roundHalfAway(params.centerX * (width - 1));
		const cy = roundHalfAway(params.centerY * (height - 1));
		const sign = flipSource ? -1 : 1;
		const total = width * height;

		for (let start = 0; start < total; start += CHECKPOINT_PIXELS) {
			const pending = ctx.checkpoint();
			if (pending) {
				await pending;
			}

			const end = Math.min(total, start + CHECKPOINT_PIXELS);
			for (let i = start; i < end; i++) {
				const x = i % width;
				const y = Math.floor(i / width);
				let sx = x;
				let sy = y;
				if (mode === 'octant') {
					const ax = Math.abs(x - cx);
					const ay = Math.abs(y - cy);
					sx = clamp(cx + sign * Math.max(ax, ay), 0, width - 1);
					sy = clamp(cy + sign * Math.min(ax, ay), 0, height - 1);
				} else {
					if (mode !== 'vertical') {
						sx = mirror(x, cx, width, flipSource);
					}

					if (mode !== 'horizontal') {
						sy = mirror(y, cy, height, flipSource);
					}
				}

				const read = (sy * width + sx) * 4;
				const write = i * 4;
				dst[write] = src[read];
				dst[write + 1] = src[read + 1];
				dst[write + 2] = src[read + 2];
				dst[write + 3] = src[read + 3];
			}

			ctx.progress(end / total);
		}
	},
};

export {
	type MirrorFoldMode,
	type MirrorFoldParams,
} from './mirror-fold-spec.ts';
