import {useEffect, useMemo, useRef} from 'react';
import {moveCrop} from './crop-math.ts';
import {geometryController} from './geometry-controller.ts';
import type {CropRect} from '@/engine/transform.ts';
import {
	sourceAt,
	type CanvasView,
	type Point,
	type Size,
} from '@/features/canvas/view.ts';
import type {AppStoreBundle} from '@/state/app-store.ts';
import {draftCrop, projectOrientedDimensions} from '@/state/geometry.ts';

export type CropBodyDrag = {
	// Whether a press here would move the box rather than pan the image.
	over(position: Point, view: CanvasView, viewport: Size): boolean;
	// Starts moving the box; `false` leaves the press to the canvas.
	begin(position: Point, view: CanvasView, viewport: Size): boolean;
	// `true` while the box takes the movement.
	move(position: Point, view: CanvasView): boolean;
	end(): void;
	// Puts the box back, for a cancelled pointer or a second finger.
	cancel(): void;
};

/**
 Dragging inside the crop box, handled by the canvas so that pan and pinch share
 one set of pointers. A box over the whole image cannot move, and holding Space
 pans instead.
 */
export function useCropBodyDrag(
	bundle: AppStoreBundle,
	active: boolean,
): CropBodyDrag {
	const dragRef = useRef<{start: CropRect; from: Point} | null>(null);
	const spaceRef = useRef(false);

	useEffect(() => {
		if (!active) {
			return undefined;
		}

		const track = (held: boolean) => (event: KeyboardEvent) => {
			if (event.key === ' ') {
				spaceRef.current = held;
			}
		};

		const handleDown = track(true);
		const handleUp = track(false);
		const handleBlur = () => {
			spaceRef.current = false;
		};

		globalThis.addEventListener('keydown', handleDown);
		globalThis.addEventListener('keyup', handleUp);
		globalThis.addEventListener('blur', handleBlur);
		return () => {
			spaceRef.current = false;
			dragRef.current = null;
			globalThis.removeEventListener('keydown', handleDown);
			globalThis.removeEventListener('keyup', handleUp);
			globalThis.removeEventListener('blur', handleBlur);
		};
	}, [active]);

	return useMemo(() => {
		const state = () => {
			const project = bundle.store.getState().activeProject;
			const {geometry} = bundle.transientStore.getState();
			return geometry.cropping && project
				? {
						crop: draftCrop(project, geometry.draft),
						bounds: projectOrientedDimensions(project),
					}
				: null;
		};

		const over = (position: Point, view: CanvasView, viewport: Size) => {
			const current = state();
			if (!current || spaceRef.current) {
				return false;
			}

			const {crop, bounds} = current;
			const {x, y} = sourceAt(view, position, viewport);
			return (
				(crop.width < bounds.width || crop.height < bounds.height) &&
				x >= crop.x &&
				x <= crop.x + crop.width &&
				y >= crop.y &&
				y <= crop.y + crop.height
			);
		};

		return {
			over,
			begin(position, view, viewport) {
				const current = state();
				if (!current || !over(position, view, viewport)) {
					return false;
				}

				dragRef.current = {start: current.crop, from: position};
				geometryController(bundle).setDragging(true);
				return true;
			},
			move(position, view) {
				const drag = dragRef.current;
				const current = state();
				if (!drag || !current) {
					return false;
				}

				geometryController(bundle).setBox(
					moveCrop(
						drag.start,
						(position.x - drag.from.x) / view.zoom,
						(position.y - drag.from.y) / view.zoom,
						current.bounds,
					),
				);
				return true;
			},
			end() {
				if (!dragRef.current) {
					return;
				}

				dragRef.current = null;
				geometryController(bundle).setDragging(false);
			},
			cancel() {
				const drag = dragRef.current;
				if (!drag) {
					return;
				}

				dragRef.current = null;
				geometryController(bundle).setBox(drag.start);
				geometryController(bundle).setDragging(false);
			},
		};
	}, [bundle]);
}
