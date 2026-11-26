import {
	boxForAspect,
	cropTransform,
	orientTransform,
	turnAspect,
	turnCrop,
	type Orientation,
} from './crop-math.ts';
import {announce} from '@/app/announcer.ts';
import type {
	CropRect,
	ResizeSpec,
	SourceTransform,
} from '@/engine/transform.ts';
import type {AppStoreBundle} from '@/state/app-store.ts';
import {
	CLOSED_GEOMETRY,
	cropDraftKey,
	draftCrop,
	projectOrientedDimensions,
	projectTransform,
	sameCrop,
	savedCrop,
	type AspectId,
	type GeometryState,
} from '@/state/geometry.ts';
import type {ProjectRecord} from '@/storage/types.ts';

// What the Geometry panel, the toolbar toggle and the crop box do.

const ORIENTATION_ANNOUNCEMENTS: Readonly<Record<Orientation, string>> = {
	cw: 'Rotated 90° clockwise',
	ccw: 'Rotated 90° counter-clockwise',
	flipH: 'Flipped horizontally',
	flipV: 'Flipped vertically',
};

export type GeometryController = {
	// Shows the panel and starts crop mode.
	open(): void;
	// Hides the panel and drops an unsaved box.
	close(): void;
	startCrop(): void;
	cancelCrop(): void;
	// Moves the unsaved box, starting crop mode.
	setBox(crop: CropRect, aspect?: AspectId): void;
	// Whether a pointer holds the box, which shows the thirds guides.
	setDragging(dragging: boolean): void;
	chooseAspect(aspect: AspectId): void;
	applyCrop(): Promise<void>;
	resetCrop(): Promise<void>;
	orient(step: Orientation): Promise<void>;
	applyResize(resize: ResizeSpec): Promise<void>;
	resetResize(): Promise<void>;
};

function createGeometryController(bundle: AppStoreBundle): GeometryController {
	const {store, transientStore} = bundle;
	let queue = Promise.resolve();

	const geometry = () => transientStore.getState().geometry;
	const patch = (next: Partial<GeometryState>) => {
		transientStore.setState({geometry: {...geometry(), ...next}});
	};

	const releaseCompare = () => {
		transientStore.setState({compareLatched: false, compareHolding: false});
	};

	const setBox = (crop: CropRect, aspect = geometry().aspect) => {
		const project = store.getState().activeProject;
		if (!project) {
			return;
		}

		releaseCompare();
		patch({
			aspect,
			cropping: true,
			draft: {key: cropDraftKey(project.id, projectTransform(project)), crop},
		});
	};

	// Saves run one at a time, each from the geometry the one before it left.
	const enqueue = async (
		run: (project: ProjectRecord) => Promise<void>,
	): Promise<void> => {
		queue = queue.then(async () => {
			const project = store.getState().activeProject;
			if (!project) {
				return;
			}

			try {
				await run(project);
			} catch {
				announce('Could not save the change.');
			}
		});
		return queue;
	};

	const save = async (
		project: ProjectRecord,
		transform: SourceTransform,
		label?: string,
	) => store.getState().setTransform(project.id, transform, label);

	return {
		open() {
			releaseCompare();
			transientStore.setState({
				geometry: {...CLOSED_GEOMETRY, open: true, cropping: true},
			});
		},

		close() {
			transientStore.setState({geometry: CLOSED_GEOMETRY});
		},

		startCrop() {
			releaseCompare();
			patch({cropping: true});
		},

		cancelCrop() {
			if (!geometry().cropping) {
				return;
			}

			patch({cropping: false, draft: null, dragging: false});
			announce('Crop cancelled');
		},

		setBox,

		setDragging(dragging) {
			patch({dragging});
		},

		chooseAspect(aspect) {
			const project = store.getState().activeProject;
			if (!project) {
				return;
			}

			setBox(
				boxForAspect(
					aspect,
					draftCrop(project, geometry().draft),
					projectOrientedDimensions(project),
				),
				aspect,
			);
		},

		applyCrop: async () =>
			enqueue(async (project) => {
				if (!geometry().cropping) {
					return;
				}

				const crop = draftCrop(project, geometry().draft);
				const changed = !sameCrop(crop, savedCrop(project));
				if (changed) {
					await save(
						project,
						cropTransform(
							projectTransform(project),
							crop,
							projectOrientedDimensions(project),
						),
					);
				}

				// Only now, so the canvas never shows the old crop in between.
				patch({cropping: false, draft: null, dragging: false});
				announce(changed ? 'Crop applied' : 'Crop unchanged');
			}),

		resetCrop: async () =>
			enqueue(async (project) => {
				const bounds = projectOrientedDimensions(project);
				const transform = projectTransform(project);
				patch({draft: null, aspect: 'free'});
				if (transform.crop === null) {
					return;
				}

				await save(
					project,
					cropTransform(transform, {x: 0, y: 0, ...bounds}, bounds),
					'Reset crop',
				);
				announce('Crop reset');
			}),

		orient: async (step) =>
			enqueue(async (project) => {
				const transform = orientTransform(
					{width: project.sourceWidth, height: project.sourceHeight},
					projectTransform(project),
					step,
				);
				// The unsaved box turns with the image.
				const {cropping, draft, aspect} = geometry();
				const box =
					cropping &&
					turnCrop(
						draftCrop(project, draft),
						projectOrientedDimensions(project),
						step,
					);
				await save(project, transform);
				patch({
					aspect: turnAspect(aspect, step),
					draft: box
						? {key: cropDraftKey(project.id, transform), crop: box}
						: null,
				});
				announce(ORIENTATION_ANNOUNCEMENTS[step]);
			}),

		applyResize: async (resize) =>
			enqueue(async (project) => {
				const cropped = savedCrop(project);
				const same =
					resize.width === cropped.width && resize.height === cropped.height;
				await save(project, {
					...projectTransform(project),
					resize: same ? null : resize,
				});
				patch({cropping: false, draft: null});
				announce(`Resized to ${resize.width} × ${resize.height} px`);
			}),

		resetResize: async () =>
			enqueue(async (project) => {
				const transform = projectTransform(project);
				if (transform.resize === null) {
					return;
				}

				await save(project, {...transform, resize: null});
				announce('Resize reset');
			}),
	};
}

/**
 Calls `end` when the saved geometry changes, such as by Undo: a drag in progress
 holds a box measured on the old image. Returns the unsubscribe function.
 */
export function onSavedGeometryChange(
	{store}: AppStoreBundle,
	end: () => void,
): () => void {
	const savedKey = () => {
		const project = store.getState().activeProject;
		return project ? cropDraftKey(project.id, projectTransform(project)) : null;
	};

	let last = savedKey();
	return store.subscribe(() => {
		const next = savedKey();
		if (next === last) {
			return;
		}

		last = next;
		end();
	});
}

const controllers = new WeakMap<AppStoreBundle, GeometryController>();

// One per app instance, so every caller shares the save queue.
export function geometryController(bundle: AppStoreBundle): GeometryController {
	let controller = controllers.get(bundle);
	if (!controller) {
		controller = createGeometryController(bundle);
		controllers.set(bundle, controller);
	}

	return controller;
}
