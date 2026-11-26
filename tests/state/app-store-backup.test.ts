import {describe, expect, it, vi} from 'vite-plus/test';
import {MemoryStorageAdapter} from '../../src/storage/memory-adapter.ts';
import {StorageQuotaError} from '../../src/storage/types.ts';
import {exportedBackup, selectAll} from '../storage/backup-fixtures.ts';
import {entriesOf, jsonOf} from '../storage/project-fixtures.ts';
import {
	SOURCE_SIZE,
	transferDependencies,
} from '../storage/project-transfer-fixtures.ts';
import {createTestStore, makeTestBlob} from './fixtures.ts';

function setup() {
	const repository = new MemoryStorageAdapter(transferDependencies());
	const persist = vi.fn(async () => true);
	const test = createTestStore({
		repository,
		storageManager: {persist, persisted: async () => true},
	});
	return {...test, persist};
}

async function openedProject(test: ReturnType<typeof setup>) {
	const {project} = await test.store.getState().importImage({
		name: 'drive.png',
		blob: makeTestBlob(),
		...SOURCE_SIZE,
	});
	const effect = await test.store.getState().addEffect('pixelSort');
	return {project, effect};
}

describe('app store backups', () => {
	it('exports and compares with every edit made so far', async () => {
		const test = setup();
		const {store} = test;
		const {effect} = await openedProject(test);
		const first = await store.getState().exportBackup();
		store.getState().nudgeMix(effect.id, 0.4);
		store.getState().setViewState({fitMode: 'custom', zoom: 3});

		const inspection = await store.getState().inspectBackup(first.blob);
		const {blob} = await store.getState().exportBackup();

		expect(inspection.preview.projects[0].status).toBe('Modified locally');
		const entries = await entriesOf(blob);
		const path = Object.keys(entries).find((name) =>
			name.endsWith('project.json'),
		)!;
		const saved = jsonOf<{
			stack: {instances: Array<{mix: number}>};
			viewState: {zoom: number};
		}>(entries[path]);
		expect(saved.stack.instances[0].mix).toBe(0.4);
		expect(saved.viewState.zoom).toBe(3);
		expect(
			Object.values(await store.getState().getSourceSizes()),
		).toStrictEqual([64]);
	});

	it('refreshes the library and settings and keeps the editor open after a Merge', async () => {
		const {blob, ids} = await exportedBackup();
		const test = setup();
		const {store, syncedThemes, persist} = test;
		const {project} = await openedProject(test);
		const inspection = await store.getState().inspectBackup(blob);

		await store.getState().importBackup(inspection, selectAll(inspection));

		const state = store.getState();
		expect(state.projects).toHaveLength(4);
		expect(state.presets.map((item) => item.name)).toStrictEqual([
			'Cold',
			'Warm',
		]);
		expect(state.theme).toBe('dark');
		expect(state.compareMode).toBe('split');
		expect(syncedThemes).toStrictEqual(['dark']);
		expect(state.activeProjectId).toBe(project.id);
		expect(state.route).toStrictEqual({
			screen: 'editor',
			projectId: project.id,
		});
		expect(state.notice).toBe(
			'Imported 3 projects and 2 presets. Applied settings.',
		);
		expect(state.thumbnailVersions[ids.edited]).toBe(1);
		expect(persist).toHaveBeenCalledOnce();
	});

	it('leaves the editor after a Replace and saves nothing over it (AC-F17.4)', async () => {
		const {blob, ids} = await exportedBackup();
		const test = setup();
		const {store, repository, routerEnv, timerEnv, coordinator, persist} = test;
		const {effect} = await openedProject(test);
		const inspection = await store.getState().inspectBackup(blob);
		const write = vi.spyOn(repository, 'updateViewState');
		const importing = repository.importBackup.bind(repository);
		// Edits that arrive while the import runs.
		vi.spyOn(repository, 'importBackup').mockImplementationOnce(
			async (...args) => {
				store.getState().setViewState({zoom: 4});
				store.getState().nudgeMix(effect.id, 0.2);
				return importing(...args);
			},
		);

		await store
			.getState()
			.importBackup(inspection, selectAll(inspection, {mode: 'replace'}));
		timerEnv.advance(5000);

		const state = store.getState();
		expect(state.projects.map((item) => item.id).toSorted()).toStrictEqual(
			Object.values(ids).toSorted(),
		);
		expect(state.activeProjectId).toBeNull();
		expect(state.activeProject).toBeNull();
		expect(state.route).toStrictEqual({screen: 'library'});
		expect(routerEnv.getHash()).toBe('#/');
		expect(
			coordinator.calls.findLast((call) => call.type === 'setSource'),
		).toStrictEqual({type: 'setSource', source: undefined});
		expect(write).not.toHaveBeenCalled();
		expect(persist).toHaveBeenCalledOnce();
	});

	it('opens the storage-full dialog on a quota error and changes nothing (AC-F17.6)', async () => {
		const {blob} = await exportedBackup();
		const test = setup();
		const {store, repository} = test;
		const {project} = await openedProject(test);
		const inspection = await store.getState().inspectBackup(blob);
		vi.spyOn(repository, 'importBackup').mockRejectedValueOnce(
			new StorageQuotaError(),
		);

		await expect(
			store
				.getState()
				.importBackup(inspection, selectAll(inspection, {mode: 'replace'})),
		).rejects.toThrow(StorageQuotaError);

		expect(store.getState().storage.quotaFull).toBe(true);
		expect(store.getState().projects).toHaveLength(1);
		expect(store.getState().activeProjectId).toBe(project.id);
		expect(store.getState().notice).toBeNull();
	});

	it('passes a cancel on without the storage-full flag', async () => {
		const {blob} = await exportedBackup();
		const {store, syncedThemes} = setup();
		const inspection = await store.getState().inspectBackup(blob);

		await expect(
			store.getState().importBackup(inspection, selectAll(inspection), {
				signal: AbortSignal.abort(),
			}),
		).rejects.toThrow(/abort/i);

		expect(store.getState().storage.quotaFull).toBe(false);
		expect(store.getState().projects).toStrictEqual([]);
		expect(syncedThemes).toStrictEqual([]);
	});
});
