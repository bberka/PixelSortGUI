import {describe, expect, it} from 'vite-plus/test';
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
