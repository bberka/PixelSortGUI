import {canonicalJson} from '../engine/types.ts';
import type {Frame} from '../render/coordinator.ts';
import type {ProjectRecord} from '../storage/types.ts';

export const MAX_THUMBNAIL_SIDE = 512;
export const THUMBNAIL_QUALITY = 0.8;

export type GeneratedThumbnail = {
	blob: Blob;
	width: number;
	height: number;
};

/**
 Synchronous capture + async encode hook for settled frames.
 Called synchronously inside the RenderCoordinator 'frame' listener while
 `frame.bitmap` is guaranteed to remain open.
 */
export type ThumbnailGenerator = (
	frame: Frame,
) => Promise<GeneratedThumbnail | null>;

// Equal while a thumbnail still shows the project's geometry and main stack.
export function thumbnailSignature({
	transform,
	stack,
}: Pick<ProjectRecord, 'transform' | 'stack'>): string {
	return canonicalJson({transform, stack});
}

export function computeThumbnailDimensions(
	width: number,
	height: number,
	maxSide: number = MAX_THUMBNAIL_SIDE,
): {width: number; height: number} {
	if (width <= 0 || height <= 0) {
		return {width: 1, height: 1};
	}

	const longest = Math.max(width, height);
	if (longest <= maxSide) {
		return {width, height};
	}

	const scale = maxSide / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

export function createCanvasThumbnailGenerator(): ThumbnailGenerator {
	return (frame) => {
		if (typeof OffscreenCanvas === 'undefined') {
			return Promise.resolve(null);
		}

		const {width, height} = computeThumbnailDimensions(
			frame.width,
			frame.height,
		);
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d', {colorSpace: 'srgb'});
		if (!context) {
			return Promise.resolve(null);
		}

		// Draw synchronously before any await so the bitmap stays valid if replaced.
		context.drawImage(frame.bitmap, 0, 0, width, height);

		return (async () => {
			try {
				const webp = await canvas.convertToBlob({
					type: 'image/webp',
					quality: THUMBNAIL_QUALITY,
				});
				if (webp.type === 'image/webp') {
					return {blob: webp, width, height};
				}
			} catch {
				// Fall back to JPEG below.
			}

			try {
				const jpeg = await canvas.convertToBlob({
					type: 'image/jpeg',
					quality: THUMBNAIL_QUALITY,
				});
				return {blob: jpeg, width, height};
			} catch {
				return null;
			} finally {
				canvas.width = 1;
				canvas.height = 1;
			}
		})();
	};
}
