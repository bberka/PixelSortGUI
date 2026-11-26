import {IDENTITY_TRANSFORM, transformKey} from '../engine/transform.ts';
import type {
	RenderCoordinator,
	RenderSource,
	SourceInfo,
} from '../render/coordinator.ts';

export type CropPreview = {
	// `null`: crop mode is off.
	sync(source: RenderSource | null): void;
	dispose(): void;
};

export type CropPreviewOptions = {
	// Absent in tests that do not render the crop preview.
	createCoordinator?: () => RenderCoordinator;
	// `undefined` before the coordinator closes the bitmap it held.
	onSource(source: SourceInfo | undefined): void;
};

/**
 The coordinator of engine.md section 8.3 that crop mode draws from: the source
 with its rotation and flips only, and no stack, so nothing is rendered.
 */
export function createCropPreview({
	createCoordinator,
	onSource,
}: CropPreviewOptions): CropPreview {
	let coordinator: RenderCoordinator | null = null;
	let unsubscribe: (() => void) | null = null;
	let sent: string | null = null;

	const close = () => {
		const closing = coordinator;
		if (!closing) {
			return;
		}

		coordinator = null;
		sent = null;
		unsubscribe?.();
		unsubscribe = null;
		onSource(undefined);
		closing.dispose();
	};

	return {
		sync(source) {
			if (!source || !createCoordinator) {
				close();
				return;
			}

			const {rotation, flipX, flipY} = source.transform ?? IDENTITY_TRANSFORM;
			const transform = {...IDENTITY_TRANSFORM, rotation, flipX, flipY};
			const signature = `${source.key}\n${transformKey(transform)}`;
			if (signature === sent) {
				return;
			}

			if (!coordinator) {
				coordinator = createCoordinator();
				unsubscribe = coordinator.subscribe((event) => {
					if (event.type === 'source') {
						onSource(event.source);
					}
				});
			}

			sent = signature;
			coordinator.setSource({...source, transform});
		},

		dispose: close,
	};
}
