import {canonicalStackJson} from '../engine/types.ts';
import type {
	RenderCoordinator,
	RenderEvent,
	RenderSource,
} from '../render/coordinator.ts';
import type {StackRequest} from '../worker/protocol.ts';

export type SideTarget = {
	source: RenderSource;
	request: StackRequest;
	// A control of this side is being moved.
	dragging: boolean;
};

export type SideRenderer = {
	// `null`: side A is hidden or has nothing to render.
	sync(target: SideTarget | null): void;
	setViewScale(devicePixelsPerSourcePixel: number): void;
	retry(): void;
	dispose(): void;
};

export type SideRendererOptions = {
	// Absent in tests that do not render side A.
	createCoordinator?: () => RenderCoordinator;
	onEvent(event: RenderEvent): void;
	// Called before the coordinator closes its bitmaps.
	onClose(): void;
};

/**
 The second render coordinator of engine.md section 8.3. It exists only while
 there is a side A to draw, so an empty one costs no worker and no decode, and
 it hears only about changes to its own side.
 */
export function createSideRenderer({
	createCoordinator,
	onEvent,
	onClose,
}: SideRendererOptions): SideRenderer {
	let coordinator: RenderCoordinator | null = null;
	let unsubscribe: (() => void) | null = null;
	let sent: string | null = null;
	let dragging = false;
	let viewScale = 0;

	const close = () => {
		const closing = coordinator;
		if (!closing) {
			return;
		}

		coordinator = null;
		sent = null;
		dragging = false;
		unsubscribe?.();
		unsubscribe = null;
		onClose();
		closing.dispose();
	};

	return {
		sync(target) {
			if (!target || !createCoordinator) {
				close();
				return;
			}

			if (!coordinator) {
				coordinator = createCoordinator();
				unsubscribe = coordinator.subscribe(onEvent);
				coordinator.setViewScale(viewScale);
			}

			const signature = `${target.source.key}\n${target.request.debug?.instanceId ?? ''}\n${canonicalStackJson(target.request.stack)}`;
			const wasDragging = dragging;
			dragging = target.dragging;
			if (signature !== sent) {
				sent = signature;
				coordinator.setSource(target.source);
				coordinator.setStack(
					target.request,
					target.dragging ? {dragging: true} : undefined,
				);
			} else if (wasDragging && !target.dragging) {
				coordinator.endDrag();
			}
		},

		setViewScale(devicePixelsPerSourcePixel) {
			viewScale = devicePixelsPerSourcePixel;
			coordinator?.setViewScale(devicePixelsPerSourcePixel);
		},

		retry() {
			coordinator?.retry();
		},

		dispose: close,
	};
}
