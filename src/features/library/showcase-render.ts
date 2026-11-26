import {
	renderSampleImage,
	SAMPLE_HEIGHT,
	SAMPLE_WIDTH,
} from './sample-image.ts';
import {runtimeEffectRegistry} from '@/engine/effects/runtime.ts';
import {renderStack} from '@/engine/pipeline.ts';
import type {EffectStack, RgbaImage} from '@/engine/types.ts';

export const PREVIEW_WIDTH = 480;
export const PREVIEW_HEIGHT = 360;

let source: RgbaImage | undefined;

/**
 One tile preview: the sample with `stack` applied by the real engine on the
 right half, and untouched on the left. Pixel-sized parameters scale as they do
 in the editor's preview. This module holds the effect implementations, so
 import it only dynamically.
 */
export async function renderShowcasePreview(
	stack: EffectStack,
): Promise<RgbaImage> {
	source ??= renderSampleImage(PREVIEW_WIDTH, PREVIEW_HEIGHT);
	const {image} = await renderStack(source, stack, runtimeEffectRegistry, {
		level: 'settle',
		sourceWidth: SAMPLE_WIDTH,
		sourceHeight: SAMPLE_HEIGHT,
		checkpoint() {},
	});
	const halfRow = (PREVIEW_WIDTH / 2) * 4;
	for (let y = 0; y < PREVIEW_HEIGHT; y++) {
		const start = y * PREVIEW_WIDTH * 4;
		image.data.set(source.data.subarray(start, start + halfRow), start);
	}

	return image;
}
