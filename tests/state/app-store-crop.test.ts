import {describe, expect, it, vi} from 'vite-plus/test';
import {geometryController} from '../../src/features/transform/geometry-controller.ts';
import type {SourceInfo} from '../../src/render/coordinator.ts';
import {CLOSED_GEOMETRY, draftCrop} from '../../src/state/geometry.ts';
import {
	createTestStore,
	makeTestBlob,
	type FakeCoordinator,
} from './fixtures.ts';

async function setup() {
	const {bundle, sideCoordinators: sides} = createTestStore();
	await bundle.store.getState().importImage({
		name: 'photo.png',
		blob: makeTestBlob('photo'),
		width: 40,
		height: 30,
	});
	const project = () => bundle.store.getState().activeProject!;
	const geometry = () => bundle.transientStore.getState().geometry;
	const box = () => draftCrop(project(), geometry().draft);
	return {
		bundle,
		sides,
		project,
		geometry,
		box,
		controller: geometryController(bundle),
	};
}

// Holds the next history write until `release`, so a test can act during it.
function holdSave({repository}: Awaited<ReturnType<typeof setup>>['bundle']) {
	const started = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	const commit = repository.commitStack.bind(repository);
	vi.spyOn(repository, 'commitStack').mockImplementationOnce(async (input) => {
		started.resolve();
		await released.promise;
		return commit(input);
	});
	return {started: started.promise, release: released.resolve};
}

const sentTransforms = (side: FakeCoordinator) =>
	side.calls.flatMap((call) =>
		call.type === 'setSource' ? [call.source?.transform] : [],
	);

describe('crop mode', () => {
	it('loads the oriented source without crop or stack, and disposes it', async () => {
		const {bundle, sides, controller} = await setup();
		await bundle.store
			.getState()
			.setTransform(bundle.store.getState().activeProjectId!, {
				rotation: 90,
				flipX: true,
				flipY: false,
				crop: {x: 0, y: 0, width: 10, height: 10},
				resize: {width: 5, height: 5, filter: 'nearest'},
			});
		expect(sides).toHaveLength(0);

		controller.open();
		expect(sides).toHaveLength(1);
		expect(sentTransforms(sides[0])).toEqual([
			{rotation: 90, flipX: true, flipY: false, crop: null, resize: null},
		]);
		const info = {key: 'k'} as unknown as SourceInfo;
		sides[0].emit({type: 'source', source: info});
		expect(bundle.store.getState().cropSource).toBe(info);

		// Saving a crop keeps the same preview; a turn sends it a new orientation.
		controller.setBox({x: 1, y: 1, width: 8, height: 8});
		await controller.orient('flipV');
		expect(sentTransforms(sides[0])).toHaveLength(2);
		expect(sides[0].calls.some((call) => call.type === 'setStack')).toBe(false);

		controller.cancelCrop();
		expect(bundle.store.getState().cropSource).toBeUndefined();
		expect(sides[0].calls.at(-1)).toEqual({type: 'dispose'});
	});

	it('saves nothing while the box moves and one entry on apply', async () => {
		const {bundle, controller, project, geometry} = await setup();
		controller.open();
		for (let x = 1; x < 8; x++) {
			controller.setBox({x, y: 2, width: 20, height: 10});
		}

		expect(bundle.store.getState().history).toHaveLength(1);
		await controller.applyCrop();
		await controller.applyCrop();
		expect(bundle.store.getState().history).toHaveLength(2);
		expect(project().transform.crop).toEqual({
			x: 7,
			y: 2,
			width: 20,
			height: 10,
		});
		expect(geometry()).toMatchObject({open: true, cropping: false});
	});

	it('counts every rotation asked for before the last one was saved', async () => {
		const {bundle, controller, project} = await setup();
		controller.open();
		await Promise.all([
			controller.orient('cw'),
			controller.orient('cw'),
			controller.orient('cw'),
		]);
		expect(project().transform.rotation).toBe(270);
		expect(bundle.store.getState().history).toHaveLength(4);
	});

	it('turns the box as it stands when the flip has saved, not as it was clicked', async () => {
		const {bundle, controller, box} = await setup();
		controller.open();
		const save = holdSave(bundle);
		const flipped = controller.orient('flipV');
		await save.started;
		controller.setBox({x: 10, y: 5, width: 20, height: 10});
		save.release();
		await flipped;
		expect(box()).toEqual({x: 10, y: 15, width: 20, height: 10});
	});

	it('keeps a crop cancelled during a flip cancelled', async () => {
		const {bundle, controller, geometry} = await setup();
		controller.open();
		controller.setBox({x: 10, y: 5, width: 20, height: 10});
		const save = holdSave(bundle);
		const flipped = controller.orient('flipV');
		await save.started;
		controller.cancelCrop();
		save.release();
		await flipped;
		expect(geometry()).toMatchObject({cropping: false, draft: null});
	});

	const typed = {x: 2, y: 3, width: 12, height: 9};

	// Starts `run`, calls `act` while its history write is held, then lets it end.
	async function during(
		bundle: Awaited<ReturnType<typeof setup>>['bundle'],
		run: () => Promise<void>,
		act: () => void,
	) {
		const save = holdSave(bundle);
		const done = run();
		await save.started;
		act();
		save.release();
		await done;
	}

	it('keeps a box set while Apply crop saves, still unapplied', async () => {
		const {bundle, controller, project, geometry, box} = await setup();
		controller.open();
		controller.setBox({x: 10, y: 5, width: 20, height: 10});
		await during(bundle, controller.applyCrop, () => {
			controller.setBox(typed);
		});
		expect(project().transform.crop).toEqual({
			x: 10,
			y: 5,
			width: 20,
			height: 10,
		});
		expect(geometry().cropping).toBe(true);
		expect(box()).toEqual(typed);
	});

	it('stays in crop mode when it is reopened while Apply crop saves', async () => {
		const {bundle, controller, geometry, box} = await setup();
		controller.open();
		controller.setBox({x: 10, y: 5, width: 20, height: 10});
		await during(bundle, controller.applyCrop, () => {
			controller.cancelCrop();
			controller.startCrop();
		});
		expect(geometry().cropping).toBe(true);
		expect(box()).toEqual({x: 10, y: 5, width: 20, height: 10});
	});

	it('leaves crop mode when the box ends where the applied crop is', async () => {
		const {bundle, controller, geometry} = await setup();
		const applied = {x: 10, y: 5, width: 20, height: 10};
		controller.open();
		controller.setBox(applied);
		await during(bundle, controller.applyCrop, () => {
			controller.setBox(typed);
			controller.setBox(applied);
		});
		expect(geometry()).toMatchObject({cropping: false, draft: null});
	});

	it('keeps a box set while Reset crop saves', async () => {
		const {bundle, controller, project, geometry, box} = await setup();
		controller.open();
		controller.setBox({x: 10, y: 5, width: 20, height: 10});
		await controller.applyCrop();
		await during(bundle, controller.resetCrop, () => {
			controller.setBox(typed);
		});
		expect(project().transform.crop).toBeNull();
		expect(geometry().cropping).toBe(true);
		expect(box()).toEqual(typed);
	});

	it('keeps a box set after Reset crop was asked for but before it ran', async () => {
		const {bundle, controller, project, box} = await setup();
		controller.open();
		controller.setBox({x: 10, y: 5, width: 20, height: 10});
		await controller.applyCrop();
		const save = holdSave(bundle);
		const flipped = controller.orient('flipH');
		const reset = controller.resetCrop();
		await save.started;
		controller.setBox(typed);
		save.release();
		await Promise.all([flipped, reset]);
		expect(project().transform.crop).toBeNull();
		expect(box()).toEqual({...typed, x: 40 - typed.x - typed.width});
	});

	const resize = {width: 20, height: 15, filter: 'nearest'} as const;

	it('keeps a box set while Apply resize saves', async () => {
		const {bundle, controller, project, geometry, box} = await setup();
		controller.open();
		await during(
			bundle,
			async () => controller.applyResize(resize),
			() => {
				controller.setBox(typed);
			},
		);
		expect(project().transform.resize).toEqual(resize);
		expect(geometry().cropping).toBe(true);
		expect(box()).toEqual(typed);
	});

	it('keeps a box set while Reset resize saves', async () => {
		const {bundle, controller, project, box} = await setup();
		controller.open();
		await controller.applyResize(resize);
		await during(bundle, controller.resetResize, () => {
			controller.setBox(typed);
		});
		expect(project().transform.resize).toBeNull();
		expect(box()).toEqual(typed);
	});

	it('drops an unsaved box when the saved geometry changes under it', async () => {
		const {bundle, controller, box} = await setup();
		controller.open();
		await controller.orient('cw');
		controller.setBox({x: 3, y: 3, width: 5, height: 5});
		await bundle.store.getState().undo();
		expect(box()).toEqual({x: 0, y: 0, width: 40, height: 30});
	});

	it('closes with the project and when an effect is selected or added', async () => {
		const {bundle, controller, geometry} = await setup();
		controller.open();
		await bundle.store.getState().addEffect('pixelSort');
		expect(geometry()).toBe(CLOSED_GEOMETRY);

		controller.open();
		bundle.store.getState().selectEffect(null);
		expect(geometry()).toBe(CLOSED_GEOMETRY);

		controller.open();
		await bundle.store.getState().closeProject();
		expect(geometry()).toBe(CLOSED_GEOMETRY);
		expect(bundle.store.getState().cropSource).toBeUndefined();
	});
});
