import {describe, expect, it, vi} from 'vite-plus/test';
import {unsupportedEffectsNotice} from '../../src/state/app-store.ts';
import {MemoryStorageAdapter} from '../../src/storage/memory-adapter.ts';
import {StorageQuotaError} from '../../src/storage/types.ts';
import {
	editedArchive,
	entriesOf,
	jsonOf,
	instance,
	stackOf,
} from '../storage/project-fixtures.ts';
import {
	SOURCE_SIZE,
	transferDependencies,
} from '../storage/project-transfer-fixtures.ts';
import {createTestStore, makeTestBlob} from './fixtures.ts';

const NAME = 'drive.glproj';

function setup() {
	const repository = new MemoryStorageAdapter(transferDependencies());
	const persist = vi.fn(async () => true);
	const test = createTestStore({
		repository,
		storageManager: {persist, persisted: async () => true},
	});
	return {...test, persist};
}

async function projectFile() {
	const {store} = setup();
	const {project} = await store.getState().importImage({
		name: 'drive.png',
		blob: makeTestBlob(),
		...SOURCE_SIZE,
	});
	await store.getState().addEffect('pixelSort');
	const {blob} = await store.getState().exportProjectFile(project.id);
	return {blob, project};
}

describe('app store project files', () => {
	it('adds an imported project and opens it in the editor', async () => {
		const {blob} = await projectFile();
		const {store, coordinator, routerEnv, persist} = setup();

		const {project} = await store.getState().importProjectFile(blob, NAME);

		const state = store.getState();
		expect(state.projects.map((item) => item.id)).toStrictEqual([project.id]);
		expect(state.activeProjectId).toBe(project.id);
		expect(state.route).toStrictEqual({
			screen: 'editor',
			projectId: project.id,
		});
		expect(routerEnv.getHash()).toBe(`#/p/${project.id}`);
		expect(state.activeSource?.sha256).toBe(project.sourceHash);
		expect(state.history.map((entry) => entry.label)).toStrictEqual([
			'Initial',
			'Add Pixel sort',
		]);
		expect(coordinator.calls.some((call) => call.type === 'setStack')).toBe(
			true,
		);
		expect(state.notice).toBeNull();
		expect(state.welcomeDismissed).toBe(true);
		expect(persist).toHaveBeenCalledOnce();
	});

	it('only adds the project when asked not to open it', async () => {
		const {blob} = await projectFile();
		const {store} = setup();

		await store.getState().importProjectFile(blob, NAME, {setActive: false});

		expect(store.getState().projects).toHaveLength(1);
		expect(store.getState().activeProjectId).toBeNull();
		expect(store.getState().route).toStrictEqual({screen: 'library'});
	});

	it('shows one notice per file with unsupported effects, on both sides (AC-F25.8)', async () => {
		const {blob} = await projectFile();
		const edited = await editedArchive(blob, ({project}) => {
			project.stack = stackOf(instance({id: 'future01', type: 'unknown'}));
			project.stackA = stackOf(instance({id: 'future02', version: 99}));
		});
		const {store} = setup();

		await store.getState().importProjectFile(edited, NAME);
		await store.getState().importProjectFile(edited, NAME, {setActive: false});

		expect(store.getState().notice).toBe(
			`${unsupportedEffectsNotice('drive', 2)} ${unsupportedEffectsNotice('drive (imported)', 2)}`,
		);
		expect(unsupportedEffectsNotice('drive', 2)).toBe(
			'Opened drive with 2 unsupported effect(s).',
		);
		expect(store.getState().unsupportedInstances).toHaveLength(2);
	});

	it('raises the storage-full flag on a quota error and adds nothing', async () => {
		const {store, repository} = setup();
		vi.spyOn(repository, 'importProjectFile').mockRejectedValueOnce(
			new StorageQuotaError(),
		);

		await expect(
			store.getState().importProjectFile(new Blob(), NAME),
		).rejects.toThrow(StorageQuotaError);

		expect(store.getState().storage.quotaFull).toBe(true);
		expect(store.getState().projects).toStrictEqual([]);
	});

	it('passes a file error on without the storage-full flag', async () => {
		const {store} = setup();

		await expect(
			store.getState().importProjectFile(new Blob(['no']), NAME),
		).rejects.toThrow(
			`Can't open ${NAME}: the file is damaged or not a valid project archive.`,
		);
		expect(store.getState().storage.quotaFull).toBe(false);
	});

	it('exports a pending keyboard edit and the latest view state', async () => {
		const {store} = setup();
		const {project} = await store.getState().importImage({
			name: 'drive.png',
			blob: makeTestBlob(),
			...SOURCE_SIZE,
		});
		const effect = await store.getState().addEffect('pixelSort');
		store.getState().nudgeMix(effect.id, 0.4);
		store.getState().setViewState({fitMode: 'custom', zoom: 3});

		const {blob} = await store.getState().exportProjectFile(project.id);

		const entries = await entriesOf(blob);
		const saved = jsonOf<{
			stack: {instances: Array<{mix: number}>};
			viewState: {zoom: number};
		}>(entries['project.json']);
		expect(saved.stack.instances[0].mix).toBe(0.4);
		expect(saved.viewState.zoom).toBe(3);
	});
});
