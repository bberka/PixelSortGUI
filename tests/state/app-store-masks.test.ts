import {describe, expect, it} from 'vite-plus/test';
import {decodeMaskAsset} from '../../src/engine/mask/asset.ts';
import type {InstanceMask} from '../../src/engine/mask/types.ts';
import {KEYBOARD_COMMIT_DEBOUNCE_MS} from '../../src/state/app-store.ts';
import {EXTRA_SOURCE_LIMIT_MESSAGE} from '../../src/storage/extra-sources.ts';
import {createTestStore, flushMicrotasks, makeTestBlob} from './fixtures.ts';

type Context = ReturnType<typeof createTestStore>;

async function setup(context: Context = createTestStore()) {
	const {store} = context;
	const {project} = await store.getState().importImage({
		name: 'base.png',
		blob: makeTestBlob('base'),
		width: 400,
		height: 300,
	});
	const {id} = await store.getState().addEffect('pixelSort');
	const active = () => store.getState().activeProject!;
	const mask = (): InstanceMask | undefined =>
		active().stack.instances.find((item) => item.id === id)?.mask;
	const labels = () => store.getState().history.map((entry) => entry.label);
	return {...context, projectId: project.id, id, active, mask, labels};
}

const lastSent = (context: Context) => {
	const calls = context.coordinator.calls.filter(
		(call) => call.type === 'setStack',
	);
	return calls.at(-1)!;
};

describe('app store masks (product.md F29)', () => {
	it('loads painted masks for both coordinators from storage', async () => {
		const context = await setup();
		const {store, coordinator, sideCoordinators, id, mask} = context;
		await store.getState().setMaskKind(id, 'paint');
		await store.getState().fillMask(id);
		await store.getState().setCompareMode('split');
		await store.getState().copyToOtherSide();
		const {asset} = mask() as InstanceMask & {kind: 'paint'};

		for (const used of [coordinator, sideCoordinators.at(-1)!]) {
			await expect(used.maskLoader!(asset)).resolves.toMatchObject({
				sha256: asset,
				width: 400,
				height: 300,
			});
		}
	});

	it('adds, replaces and removes a mask, one history entry each, with the stack version', async () => {
		const context = await setup();
		const {store, id, mask, active, labels} = context;

		await store.getState().setMaskKind(id, 'paint');
		expect(mask()).toEqual({
			kind: 'paint',
			asset: '',
			invert: false,
			feather: 0,
		});
		expect(active().stack.schemaVersion).toBe(2);
		expect(lastSent(context).request.stack.instances[0].mask).toEqual(mask());

		await store.getState().setMaskKind(id, 'luma');
		expect(mask()).toMatchObject({kind: 'luma', range: [0.5, 1]});
		// The same type again changes nothing.
		await store.getState().setMaskKind(id, 'luma');
		await store.getState().setMaskKind(id, null);
		expect(mask()).toBeUndefined();
		expect(active().stack.instances[0]).not.toHaveProperty('mask');
		expect(active().stack.schemaVersion).toBe(1);
		expect(labels().slice(-3)).toEqual([
			'Add paint mask',
			'Mask type Brightness',
			'Remove mask',
		]);

		await store.getState().undo();
		expect(mask()).toMatchObject({kind: 'luma'});
		expect(active().stack.schemaVersion).toBe(2);
	});

	it('fills with a stored all-255 asset at the grid size, and clears it', async () => {
		const {store, repository, id, mask, labels} = await setup();
		await store.getState().setMaskKind(id, 'paint');
		await store.getState().fillMask(id);

		const {asset} = mask() as InstanceMask & {kind: 'paint'};
		const record = (await repository.getMask(asset))!;
		const bitmap = await decodeMaskAsset({
			...record,
			compressed: new Uint8Array(await record.blob.arrayBuffer()),
		});
		expect([bitmap.width, bitmap.height]).toEqual([400, 300]);
		expect(bitmap.data.every((value) => value === 255)).toBe(true);

		// Filling a full mask is no change.
		const entries = labels().length;
		await store.getState().fillMask(id);
		expect(labels()).toHaveLength(entries);

		await store.getState().clearMask(id);
		expect(mask()).toMatchObject({asset: ''});
		await store.getState().clearMask(id);
		expect(labels().slice(-2)).toEqual(['Fill mask', 'Clear mask']);

		await store.getState().undo();
		expect(mask()).toMatchObject({asset});
	});

	it('commits settings with their labels and ignores an unchanged value', async () => {
		const {store, id, mask, labels} = await setup();
		await store.getState().setMaskKind(id, 'luma');
		await store.getState().commitMask(id, {invert: true});
		await store.getState().commitMask(id, {feather: 999});
		await store.getState().commitMask(id, {range: [0.25, 0.75]});
		await store.getState().commitMask(id, {softness: 0});
		await store.getState().commitMask(id, {softness: 0});

		expect(mask()).toEqual({
			kind: 'luma',
			invert: true,
			feather: 256,
			range: [0.25, 0.75],
			softness: 0,
		});
		expect(labels().slice(-4)).toEqual([
			'Invert mask on',
			'Mask feather 256 px',
			'Mask range 25% to 75%',
			'Mask softness 0%',
		]);
	});

	it('previews a drag without a commit, and commits a burst of arrow keys once', async () => {
		const context = await setup();
		const {store, transientStore, timerEnv, id, mask, labels} = context;
		await store.getState().setMaskKind(id, 'luma');
		const entries = labels().length;

		store.getState().dragMask(id, {feather: 10});
		expect(lastSent(context)).toMatchObject({options: {dragging: true}});
		expect(lastSent(context).request.stack.instances[0].mask).toMatchObject({
			feather: 10,
		});
		expect(mask()).toMatchObject({feather: 0});
		// Another control of the instance keeps the dragged mask value.
		store.getState().dragMix(id, 0.5);
		expect(transientStore.getState().activeDrag?.mask).toEqual({feather: 10});
		store.getState().cancelDrag();
		expect(labels()).toHaveLength(entries);

		store.getState().nudgeMask(id, {feather: 1});
		store.getState().nudgeMask(id, {feather: 2});
		timerEnv.advance(KEYBOARD_COMMIT_DEBOUNCE_MS);
		await flushMicrotasks();
		await store.getState().flushPendingCommit();
		expect(mask()).toMatchObject({feather: 2});
		expect(labels().slice(entries)).toEqual(['Mask feather 2 px']);
	});

	it('leaves the mask alone on Reset all and Randomize, and copies it with the instance', async () => {
		const {store, id, mask, active} = await setup();
		await store.getState().setMaskKind(id, 'luma');
		const before = mask();

		await store.getState().resetInstance(id);
		await store.getState().commitInstanceParams(id, {}, 'Randomize Pixel sort');
		expect(mask()).toEqual(before);
		const copy = await store.getState().duplicateEffect(id);
		expect(copy.mask).toEqual(before);
		expect(active().stack.instances).toHaveLength(2);
	});

	it('names the side for a mask on split side A', async () => {
		const {store, id, active, labels} = await setup();
		await store.getState().setCompareMode('split');
		await store.getState().setEditSide('a');
		const added = await store.getState().addEffect('pixelSort');
		await store.getState().setMaskKind(added.id, 'paint');
		await store.getState().fillMask(added.id);

		expect(active().stackA?.schemaVersion).toBe(2);
		expect(active().stack.schemaVersion).toBe(1);
		expect(active().stack.instances[0].id).toBe(id);
		expect(labels().slice(-2)).toEqual([
			'Add paint mask (side A)',
			'Fill mask (side A)',
		]);
	});

	it('stores a mask image from the device with the commit that names it', async () => {
		const {store, repository, projectId, id, mask, labels} = await setup();
		await store.getState().setMaskKind(id, 'image');
		const choice = {
			image: {
				blob: makeTestBlob('white'),
				mimeType: 'image/png',
				width: 20,
				height: 10,
			},
		};

		await expect(
			store.getState().commitMaskImage(projectId, id, choice),
		).resolves.toBe(true);
		const {source} = mask() as InstanceMask & {kind: 'image'};
		await expect(repository.hasSource(source)).resolves.toBe(true);
		await store.getState().commitMask(id, {fit: 'stretch'});
		await expect(
			store.getState().commitMaskImage(projectId, id, {sha256: ''}),
		).resolves.toBe(true);
		expect(labels().slice(-3)).toEqual([
			'Mask image chosen',
			'Mask fit Stretch',
			'Mask image cleared',
		]);
		await expect(
			store.getState().commitMaskImage('another', id, {sha256: source}),
		).resolves.toBe(false);
	});

	it('counts a mask image toward the shared cap of 8 extra images', async () => {
		const {store, projectId, id, labels} = await setup();
		const pick = async (instanceId: string, name: string) =>
			store.getState().commitImageParam(projectId, instanceId, 'image', {
				image: {
					blob: makeTestBlob(name),
					mimeType: 'image/png',
					width: 4,
					height: 4,
				},
			});
		for (let index = 0; index < 8; index++) {
			const blend = await store.getState().addEffect('imageBlend');
			await pick(blend.id, `extra${index}`);
		}

		await store.getState().setMaskKind(id, 'image');
		const entries = labels().length;
		await expect(
			store.getState().commitMaskImage(projectId, id, {
				image: {
					blob: makeTestBlob('ninth'),
					mimeType: 'image/png',
					width: 4,
					height: 4,
				},
			}),
		).rejects.toThrow(EXTRA_SOURCE_LIMIT_MESSAGE);
		expect(labels()).toHaveLength(entries);
	});

	it('toggles the overlay only for a selected effect with a mask, without a commit', async () => {
		const {store, id, labels} = await setup();
		expect(store.getState().maskOverlay).toEqual({
			visible: true,
			opacity: 50,
		});
		expect(store.getState().toggleMaskOverlay()).toBeNull();
		expect(store.getState().maskOverlay.visible).toBe(true);

		await store.getState().setMaskKind(id, 'paint');
		const entries = labels().length;
		expect(store.getState().toggleMaskOverlay()).toBe(false);
		expect(store.getState().toggleMaskOverlay()).toBe(true);
		store.getState().setMaskOverlay({opacity: 3});
		expect(store.getState().maskOverlay.opacity).toBe(10);
		expect(labels()).toHaveLength(entries);

		store.getState().selectEffect(null);
		expect(store.getState().toggleMaskOverlay()).toBeNull();
	});

	it('drops painted and image masks from a saved preset and keeps brightness masks', async () => {
		const {store, id, active} = await setup();
		await store.getState().setMaskKind(id, 'paint');
		await store.getState().fillMask(id);
		const second = await store.getState().addEffect('pixelSort');
		await store.getState().setMaskKind(second.id, 'image');
		const third = await store.getState().addEffect('pixelSort');
		await store.getState().setMaskKind(third.id, 'luma');

		const preset = await store.getState().saveStackAsPreset('Masked');
		await store.getState().applyPreset(preset.id);
		expect(active().stack.instances.map((item) => item.mask?.kind)).toEqual([
			undefined,
			undefined,
			'luma',
		]);
		expect(active().stack.schemaVersion).toBe(2);
	});
});
