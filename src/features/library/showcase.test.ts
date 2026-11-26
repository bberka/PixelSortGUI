import {describe, expect, it} from 'vite-plus/test';
import {
	PREVIEW_HEIGHT,
	PREVIEW_WIDTH,
	renderShowcasePreview,
} from './showcase-render.ts';
import {renderSampleImage} from './sample-image.ts';
import {SHOWCASE_TILES} from './showcase.ts';
import {effectRegistry} from '@/engine/effects/index.ts';
import {resolveInstance} from '@/engine/params.ts';

describe('effect tiles (AC-F2.11)', () => {
	it('offers the four tiles the spec names', () => {
		expect(SHOWCASE_TILES.map((tile) => tile.name)).toEqual([
			'Pixel sort',
			'Channel shift',
			'Slice shift',
			'Posterize',
		]);
	});

	it.each(SHOWCASE_TILES)(
		'$name uses registered effects with valid parameters',
		({stack}) => {
			expect(stack.instances.length).toBeGreaterThan(0);
			for (const instance of stack.instances) {
				const resolved = resolveInstance(instance, effectRegistry);
				expect(resolved).toMatchObject({status: 'ok', fixed: false});
			}
		},
	);

	it.each(SHOWCASE_TILES)(
		'$name keeps the original on the left and changes the right half',
		async ({stack}) => {
			const original = renderSampleImage(PREVIEW_WIDTH, PREVIEW_HEIGHT);

			const preview = await renderShowcasePreview(stack);

			let leftChanged = 0;
			let rightChanged = 0;
			for (let offset = 0; offset < preview.data.length; offset += 4) {
				const changed = [0, 1, 2].some(
					(channel) =>
						preview.data[offset + channel] !== original.data[offset + channel],
				);
				const x = (offset / 4) % PREVIEW_WIDTH;
				if (changed) {
					if (x < PREVIEW_WIDTH / 2) {
						leftChanged++;
					} else {
						rightChanged++;
					}
				}
			}

			expect(leftChanged).toBe(0);
			expect(rightChanged).toBeGreaterThan(preview.data.length / 4 / 20);
		},
	);
});
