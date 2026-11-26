import {IDBFactory, IDBKeyRange as FakeKeyRange} from 'fake-indexeddb';
import {describe, expect, it} from 'vite-plus/test';
import {
	IDENTITY_TRANSFORM,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import {canonicalJson} from '../../src/engine/types.ts';
import type {Frame} from '../../src/render/coordinator.ts';
import {
	invalidGeometryNotice,
	selectRedoLabel,
	selectUndoLabel,
} from '../../src/state/app-store.ts';
import {openDatabase} from '../../src/storage/db.ts';
import {IndexedDbRepository} from '../../src/storage/repository.ts';
import {restoreStartup} from '../../src/storage/restore.ts';
import {StorageValidationError} from '../../src/storage/types.ts';
import {putRecords} from '../storage/idb-helpers.ts';
import {
	createFakeCoordinator,
	createFakeRouterEnv,
	createTestStore,
	flushMicrotasks,
	makeTestBlob,
	type FakeCoordinator,
} from './fixtures.ts';

const TURNED: SourceTransform = {...IDENTITY_TRANSFORM, rotation: 90};
const CROPPED: SourceTransform = {
	...TURNED,
	crop: {x: 0, y: 0, width: 200, height: 100},
};
const BROKEN = {...IDENTITY_TRANSFORM, rotation: 45} as unknown;

type Context = ReturnType<typeof createTestStore>;

async function setup(options?: Parameters<typeof createTestStore>[0]) {
	const context = createTestStore(options);
	const {project, source} = await context.store.getState().importImage({
		name: 'geometry.png',
		blob: makeTestBlob('geometry'),
		width: 400,
		height: 300,
	});
	context.coordinator.calls.length = 0;
	return {...context, project, source};
}

const active = (context: Pick<Context, 'store'>) =>
	context.store.getState().activeProject!;

const sentTransforms = (coordinator: FakeCoordinator) =>
	coordinator.calls.flatMap((call) =>
		call.type === 'setSource' ? [call.source?.transform] : [],
	);

function settleFrame(generation: number): Frame {
	return {
		generation,
		level: 'settle',
		bitmap: {} as ImageBitmap,
		width: 300,
		height: 400,
		scale: 1,
		warnings: [],
		perInstanceMs: {},
		totalMs: 1,
	} as unknown as Frame;
}

describe('app store — setTransform', () => {
	it('writes one labelled history commit and sends the geometry to the preview', async () => {
		const context = await setup();
		const {store, repository, project, source, coordinator} = context;

		await expect(
			store.getState().setTransform(project.id, TURNED),
		).resolves.toBe(true);

		expect(active(context)).toMatchObject({
			transform: TURNED,
			effectiveWidth: 300,
			effectiveHeight: 400,
		});
		expect(store.getState().projects[0].effectiveWidth).toBe(300);
		expect(selectUndoLabel(store.getState())).toBe('Rotate 90° CW');
		const history = await repository.getHistory(project.id);
		expect(history.map((entry) => entry.label)).toEqual([
			'Initial',
			'Rotate 90° CW',
		]);
		expect(coordinator.calls).toEqual([
			{
				type: 'setSource',
				source: {
					key: source.sha256,
					blob: source.blob,
					width: 400,
					height: 300,
					transform: TURNED,
				},
			},
		]);
	});

	it('undoes and redoes geometry between effect edits', async () => {
		const context = await setup();
		const {store, project, coordinator} = context;
		const effect = await store.getState().addEffect('pixelSort');
		await store.getState().setTransform(project.id, TURNED);
		await store.getState().setTransform(project.id, CROPPED);
		expect(selectUndoLabel(store.getState())).toBe('Crop 200 × 100');
		coordinator.calls.length = 0;

		await expect(store.getState().undo()).resolves.toBe(true);
		expect(active(context)).toMatchObject({
			transform: TURNED,
			effectiveWidth: 300,
			effectiveHeight: 400,
		});
		expect(selectRedoLabel(store.getState())).toBe('Crop 200 × 100');
		await store.getState().undo();
		expect(active(context).transform).toEqual(IDENTITY_TRANSFORM);
		expect(active(context).stack.instances[0].id).toBe(effect.id);
		await store.getState().redo();
		await store.getState().redo();

		expect(active(context)).toMatchObject({
			transform: CROPPED,
			effectiveWidth: 200,
			effectiveHeight: 100,
		});
		expect(store.getState().projects[0].effectiveHeight).toBe(100);
		expect(sentTransforms(coordinator)).toEqual([
			TURNED,
			IDENTITY_TRANSFORM,
			TURNED,
			CROPPED,
		]);

		await store.getState().jumpToHistory(project.id, 0);
		expect(sentTransforms(coordinator).at(-1)).toEqual(IDENTITY_TRANSFORM);
	});

	it('flushes a pending keyboard edit before the geometry commit', async () => {
		const context = await setup();
		const {store, repository, project} = context;
		const effect = await store.getState().addEffect('pixelSort');
		store.getState().nudgeParam(effect.id, 'angle', 90);

		await store.getState().setTransform(project.id, TURNED);

		const history = await repository.getHistory(project.id);
		expect(history.map((entry) => entry.label)).toEqual([
			'Initial',
			'Add Pixel sort',
			'Angle 90°',
			'Rotate 90° CW',
		]);
		expect(active(context).stack.instances[0].params.angle).toBe(90);
	});

	it('does nothing for an unchanged transform or another project', async () => {
		const context = await setup();
		const {store, repository, project, coordinator} = context;

		await expect(
			store.getState().setTransform(project.id, {...IDENTITY_TRANSFORM}),
		).resolves.toBe(false);
		await expect(store.getState().setTransform('other', TURNED)).resolves.toBe(
			false,
		);

		expect(await repository.getHistory(project.id)).toHaveLength(1);
		expect(coordinator.calls).toEqual([]);
	});

	it('rejects an invalid transform and changes nothing', async () => {
		const context = await setup();
		const {store, repository, project, coordinator} = context;

		await expect(
			store.getState().setTransform(project.id, {
				...IDENTITY_TRANSFORM,
				resize: {width: 20_000, height: 10, filter: 'lanczos3'},
			}),
		).rejects.toThrow(StorageValidationError);

		expect(await repository.getHistory(project.id)).toHaveLength(1);
		expect(active(context).transform).toEqual(IDENTITY_TRANSFORM);
		expect(coordinator.calls).toEqual([]);
	});

	it('accepts a caller label', async () => {
		const {store, project} = await setup();

		await store.getState().setTransform(project.id, TURNED, 'Turn it');

		expect(selectUndoLabel(store.getState())).toBe('Turn it');
	});

	it('sends the new geometry to split side A too', async () => {
		const context = await setup();
		const {store, project, sideCoordinators} = context;
		await store.getState().setCompareMode('split');
		await store.getState().setEditSide('a');
		await store.getState().addEffect('pixelSort');

		await store.getState().setTransform(project.id, TURNED);

		expect(sentTransforms(sideCoordinators[0]).at(-1)).toEqual(TURNED);
		expect(active(context).stackA?.instances).toHaveLength(1);
		expect(selectUndoLabel(store.getState())).toBe('Rotate 90° CW');
		await store.getState().undo();
		expect(sentTransforms(sideCoordinators[0]).at(-1)).toEqual(
			IDENTITY_TRANSFORM,
		);
		expect(active(context).stackA?.instances).toHaveLength(1);
	});

	it('AC-F20.6: applying or adding a preset keeps the geometry', async () => {
		const context = await setup();
		const {store, repository, project} = context;
		await store.getState().addEffect('channelShift');
		const mine = await store.getState().saveStackAsPreset('Mine');
		await store.getState().setTransform(project.id, CROPPED);

		const builtin = store.getState().builtinPresets[0];
		await store.getState().applyPreset(builtin.id);
		await store.getState().applyPreset(mine.id);
		await store.getState().addPresetToStack(builtin.id);

		expect(active(context)).toMatchObject({
			transform: CROPPED,
			effectiveWidth: 200,
			effectiveHeight: 100,
		});
		const history = await repository.getHistory(project.id);
		expect(history.slice(2).map((entry) => entry.transform)).toEqual([
			CROPPED,
			CROPPED,
			CROPPED,
			CROPPED,
		]);
	});

	it('regenerates the thumbnail at the new size after a geometry commit', async () => {
		const context = await setup();
		const {store, repository, coordinator, project} = context;
		coordinator.emit({type: 'frame', frame: settleFrame(1)});
		await flushMicrotasks();
		const before = await repository.getThumbnail(project.id);

		await store.getState().setTransform(project.id, TURNED);
		coordinator.emit({type: 'frame', frame: settleFrame(2)});
		await flushMicrotasks();
		const after = await repository.getThumbnail(project.id);

		expect(context.thumbnailCalls).toEqual([1, 2]);
		expect(after).toMatchObject({width: 300, height: 400});
		expect(after!.stackSignature).not.toBe(before!.stackSignature);
		expect(after!.stackSignature).toBe(
			canonicalJson({transform: TURNED, stack: active(context).stack}),
		);
	});

	it('copies the transform when duplicating', async () => {
		const {store, project} = await setup();
		await store.getState().setTransform(project.id, CROPPED);

		const copy = await store.getState().duplicateProject(project.id);

		expect(copy).toMatchObject({
			transform: CROPPED,
			effectiveWidth: 200,
			effectiveHeight: 100,
		});
	});
});

async function indexedDbSession(idb: IDBFactory) {
	const database = await openDatabase({indexedDB: idb});
	const repository = new IndexedDbRepository(database, {
		keyRange: FakeKeyRange,
	});
	return {database, repository};
}

async function reload(idb: IDBFactory, hash = '') {
	const coordinator = createFakeCoordinator();
	const result = await restoreStartup({
		coordinator,
		routerEnv: createFakeRouterEnv(hash),
		isSecureContext: true,
		storageOptions: {indexedDB: idb, keyRange: FakeKeyRange},
		readLocalTheme: () => null,
		mirrorTheme() {},
		scheduleIdle() {},
	});
	if (result.status !== 'ready') {
		throw new Error(`Expected a ready restore, got ${result.status}`);
	}

	await result.hydrationPromise;
	return {coordinator, bundle: result.bundle, store: result.bundle.store};
}

describe('geometry across a reload', () => {
	it('restores the transform, renders it, and still undoes and redoes it', async () => {
		const idb = new IDBFactory();
		const {repository} = await indexedDbSession(idb);
		const first = await setup({repository});
		await first.store.getState().setTransform(first.project.id, TURNED);
		await first.store.getState().setTransform(first.project.id, CROPPED);
		await first.store.getState().undo();
		first.bundle.dispose();
		repository.close();

		const second = await reload(idb);

		expect(active(second)).toMatchObject({
			transform: TURNED,
			effectiveWidth: 300,
			effectiveHeight: 400,
		});
		expect(second.store.getState().notice).toBeNull();
		expect(sentTransforms(second.coordinator)).toEqual([TURNED]);
		await second.store.getState().redo();
		expect(active(second).transform).toEqual(CROPPED);
		await second.store.getState().undo();
		await second.store.getState().undo();
		expect(active(second).transform).toEqual(IDENTITY_TRANSFORM);
		second.bundle.dispose();
	});
});

// A project whose stored record, and optionally first history entry, hold a
// transform its source cannot take.
async function seedBroken(options: {project: boolean}) {
	const idb = new IDBFactory();
	const {database, repository} = await indexedDbSession(idb);
	const {project} = await repository.createProject({
		name: 'broken.png',
		blob: makeTestBlob('broken'),
		width: 400,
		height: 300,
	});
	await repository.commitStack({
		projectId: project.id,
		stack: project.stack,
		selectedInstanceId: null,
		transform: TURNED,
		label: 'Rotate 90° CW',
	});
	const [initial] = await repository.getHistory(project.id);
	await putRecords(database, 'history', [{...initial, transform: BROKEN}]);
	if (options.project) {
		const stored = await repository.getProject(project.id);
		await putRecords(database, 'projects', [
			{...stored, transform: BROKEN, effectiveWidth: 7},
		]);
	}

	return {idb, repository, id: project.id};
}

describe('invalid stored geometry', () => {
	it('is repaired with a notice when the project is restored at startup', async () => {
		const {idb, repository, id} = await seedBroken({project: true});
		repository.close();

		const session = await reload(idb);

		expect(active(session)).toMatchObject({
			transform: IDENTITY_TRANSFORM,
			effectiveWidth: 400,
			effectiveHeight: 300,
		});
		expect(session.store.getState().projects[0].effectiveWidth).toBe(400);
		expect(session.store.getState().notice).toBe(
			invalidGeometryNotice('broken'),
		);
		expect(sentTransforms(session.coordinator)).toEqual([IDENTITY_TRANSFORM]);

		// The next commit saves the repair.
		await session.store.getState().addEffect('pixelSort');
		expect(await session.bundle.repository.getProject(id)).toMatchObject({
			transform: IDENTITY_TRANSFORM,
			effectiveWidth: 400,
		});
		session.bundle.dispose();
	});

	it('is repaired in the library quietly and with a notice on open', async () => {
		const {idb, repository, id} = await seedBroken({project: true});
		await repository.closeActiveProject();
		repository.close();
		const session = await reload(idb, '#/');
		expect(session.store.getState().notice).toBeNull();
		expect(session.store.getState().projects[0]).toMatchObject({
			transform: IDENTITY_TRANSFORM,
			effectiveWidth: 400,
		});

		const opened = await session.store.getState().openProject(id);

		expect(opened?.transform).toEqual(IDENTITY_TRANSFORM);
		expect(session.store.getState().notice).toBe(
			invalidGeometryNotice('broken'),
		);
		expect(sentTransforms(session.coordinator)).toEqual([IDENTITY_TRANSFORM]);
		session.bundle.dispose();
	});

	it('is repaired with a notice when undo reaches a broken history entry', async () => {
		const {idb, repository, id} = await seedBroken({project: false});
		repository.close();
		const session = await reload(idb);
		expect(session.store.getState().notice).toBeNull();

		await expect(session.store.getState().undo()).resolves.toBe(true);

		expect(active(session)).toMatchObject({
			transform: IDENTITY_TRANSFORM,
			effectiveWidth: 400,
			effectiveHeight: 300,
		});
		expect(session.store.getState().notice).toBe(
			invalidGeometryNotice('broken'),
		);
		expect(sentTransforms(session.coordinator).at(-1)).toEqual(
			IDENTITY_TRANSFORM,
		);
		expect((await session.bundle.repository.getProject(id))?.transform).toEqual(
			IDENTITY_TRANSFORM,
		);
		session.bundle.dispose();
	});
});
