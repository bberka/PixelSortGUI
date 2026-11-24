import {describe, expect, it} from 'vite-plus/test';
import {
	createAppStore,
	KEYBOARD_COMMIT_DEBOUNCE_MS,
	MISSING_PROJECT_NOTICE,
	selectCanRedo,
	selectCanUndo,
	selectRedoLabel,
	selectUndoLabel,
	VIEW_STATE_DEBOUNCE_MS,
} from '../../src/state/app-store.ts';
import {DEV_GALLERY_HASH} from '../../src/state/router.ts';
import {MemoryStorageAdapter} from '../../src/storage/memory-adapter.ts';
import {StorageValidationError} from '../../src/storage/types.ts';
import {
	createFakeCoordinator,
	createFakeRouterEnv,
	createFakeTimerEnv,
	makeTestBlob,
} from './fixtures.ts';

function setupStore(options: {initialHash?: string} = {}) {
	const timerEnv = createFakeTimerEnv();
	const repository = new MemoryStorageAdapter({now: () => timerEnv.now()});
	const coordinator = createFakeCoordinator();
	const routerEnv = createFakeRouterEnv(options.initialHash ?? '');
	const syncedThemes: string[] = [];
	const thumbnailCalls: number[] = [];

	const bundle = createAppStore({
		repository,
		coordinator,
		routerEnv,
		timerEnv,
		syncTheme(theme) {
			syncedThemes.push(theme);
		},
		async thumbnailGenerator(frame) {
			thumbnailCalls.push(frame.generation);
			return {
				blob: new Blob([new Uint8Array([1, 2, 3])], {type: 'image/webp'}),
				width: Math.min(512, frame.width),
				height: Math.min(512, frame.height),
			};
		},
	});
	bundle.store.getState().attachListeners();

	return {
		bundle,
		store: bundle.store,
		transientStore: bundle.transientStore,
		repository,
		coordinator,
		routerEnv,
		timerEnv,
		syncedThemes,
		thumbnailCalls,
	};
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 5; index++) {
		await Promise.resolve();
	}
}

describe('app store', () => {
	it('imports single and multiple images, deduplicates sources, and activates the first', async () => {
		const {store, repository, coordinator, routerEnv} = setupStore();
		const blobA = makeTestBlob('photo-a', 128);
		const blobB = makeTestBlob('photo-b', 128);

		const results = await store.getState().importImages([
			{name: 'sunset.jpg', blob: blobA, width: 800, height: 600},
			{name: 'bridge.png', blob: blobB, width: 640, height: 480},
			{name: 'sunset-again.jpg', blob: blobA, width: 800, height: 600},
		]);

		expect(results).toHaveLength(3);
		expect(results[2].deduplicated).toBe(true);
		expect(store.getState().projects).toHaveLength(3);
		expect(store.getState().activeProjectId).toBe(results[0].project.id);
		expect(store.getState().activeProject?.name).toBe('sunset');
		expect(routerEnv.getHash()).toBe(`#/p/${results[0].project.id}`);

		const sourceCalls = coordinator.calls.filter((c) => c.type === 'setSource');
		expect(sourceCalls).toHaveLength(1);
		expect(sourceCalls[0].source?.key).toBe(results[0].source.sha256);

		const persistedProjects = await repository.listProjects();
		expect(persistedProjects).toHaveLength(3);
	});

	it('opens, closes, renames, duplicates, and deletes projects', async () => {
		const {store, repository, coordinator, routerEnv} = setupStore();
		const created = await store.getState().importImage({
			name: 'first.png',
			blob: makeTestBlob('first'),
			width: 400,
			height: 300,
		});

		const renamed = await store
			.getState()
			.renameProject(created.project.id, '  Renamed Photo  ');
		expect(renamed.name).toBe('Renamed Photo');
		expect(store.getState().activeProject?.name).toBe('Renamed Photo');

		const copy = await store.getState().duplicateProject(created.project.id);
		expect(copy.name).toBe('Renamed Photo copy');
		expect(store.getState().projects).toHaveLength(2);

		await store.getState().closeProject();
		expect(store.getState().activeProjectId).toBeNull();
		expect(store.getState().route).toEqual({screen: 'library'});
		expect(routerEnv.getHash()).toBe('#/');
		expect(coordinator.calls.at(-1)).toEqual({
			type: 'setSource',
			source: undefined,
		});

		await store.getState().openProject(copy.id);
		expect(store.getState().activeProjectId).toBe(copy.id);
		expect(routerEnv.getHash()).toBe(`#/p/${copy.id}`);

		const delResult = await store.getState().deleteProject(copy.id);
		expect(delResult.deleted).toBe(true);
		expect(delResult.sourceDeleted).toBe(false);
		expect(store.getState().activeProjectId).toBeNull();
		expect(store.getState().route).toEqual({screen: 'library'});
		expect(await repository.listProjects()).toHaveLength(1);
	});

	it('adds, removes, reorders, duplicates, toggles, and selects effect instances', async () => {
		const {store, repository, coordinator, timerEnv} = setupStore();
		const {project} = await store.getState().importImage({
			name: 'effects.png',
			blob: makeTestBlob('effects'),
			width: 320,
			height: 240,
		});

		const first = await store.getState().addEffect('pixelSort');
		const second = await store.getState().addEffect('channelShift');
		expect(first.id).toMatch(/^[0-9a-z]{8}$/);
		expect(second.id).toMatch(/^[0-9a-z]{8}$/);
		expect(first.id).not.toBe(second.id);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(second.id);

		const dup = await store.getState().duplicateEffect(first.id);
		expect(dup.id).not.toBe(first.id);
		expect(dup.params).toEqual(first.params);
		expect(
			store.getState().activeProject?.stack.instances.map((i) => i.id),
		).toEqual([first.id, dup.id, second.id]);

		await store.getState().reorderEffect(2, 0);
		expect(
			store.getState().activeProject?.stack.instances.map((i) => i.id),
		).toEqual([second.id, first.id, dup.id]);

		await store.getState().setEffectEnabled(first.id, false);
		expect(
			store
				.getState()
				.activeProject?.stack.instances.find((i) => i.id === first.id)?.enabled,
		).toBe(false);

		const historyBeforeSelect = (await repository.getHistory(project.id))
			.length;
		store.getState().selectEffect(second.id);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(second.id);
		timerEnv.advance(VIEW_STATE_DEBOUNCE_MS);
		await flushMicrotasks();
		expect((await repository.getHistory(project.id)).length).toBe(
			historyBeforeSelect,
		);
		expect((await repository.getProject(project.id))?.selectedInstanceId).toBe(
			second.id,
		);

		await store.getState().removeEffect(second.id);
		expect(store.getState().activeProject?.stack.instances).toHaveLength(2);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(first.id);

		const stackCalls = coordinator.calls.filter((c) => c.type === 'setStack');
		expect(stackCalls.at(-1)?.request.stack.instances).toHaveLength(2);
	});

	it('keeps drag updates isolated in transientStore with zero history or repo writes, and commits once on release', async () => {
		const {store, transientStore, repository, coordinator} = setupStore();
		const {project} = await store.getState().importImage({
			name: 'drag.png',
			blob: makeTestBlob('drag'),
			width: 320,
			height: 240,
		});
		const instance = await store.getState().addEffect('pixelSort');
		const historyBefore = (await repository.getHistory(project.id)).length;

		let appStoreNotifications = 0;
		const unsubscribe = store.subscribe(() => {
			appStoreNotifications++;
		});
		coordinator.calls.length = 0;

		store.getState().dragParam(instance.id, 'angle', 15);
		store.getState().dragParam(instance.id, 'angle', 45);
		store.getState().dragParam(instance.id, 'angle', 90);
		store.getState().dragMix(instance.id, 0.5);

		expect(appStoreNotifications).toBe(0);
		expect(transientStore.getState().activeDrag).toEqual({
			instanceId: instance.id,
			params: {angle: 90},
			mix: 0.5,
		});
		expect((await repository.getHistory(project.id)).length).toBe(
			historyBefore,
		);
		expect(
			coordinator.calls.every(
				(c) => c.type === 'setStack' && c.options?.dragging === true,
			),
		).toBe(true);
		expect(coordinator.calls).toHaveLength(4);

		await store.getState().commitParam(instance.id, 'angle', 90);
		unsubscribe();

		expect(appStoreNotifications).toBe(1);
		expect(transientStore.getState().activeDrag).toBeNull();
		const historyAfter = await repository.getHistory(project.id);
		expect(historyAfter).toHaveLength(historyBefore + 1);
		expect(historyAfter.at(-1)?.label).toBe('Change Angle');
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].params
				.angle,
		).toBe(90);

		const lastCall = coordinator.calls.at(-1);
		expect(lastCall?.type).toBe('setStack');
		if (lastCall?.type === 'setStack') {
			expect(lastCall.options).toBeUndefined();
			expect(lastCall.request.stack.instances[0].params.angle).toBe(90);
		}

		// Releasing with no value change skips creating a history entry and calls endDrag
		coordinator.calls.length = 0;
		await store.getState().commitParam(instance.id, 'angle', 90);
		expect(await repository.getHistory(project.id)).toHaveLength(
			historyBefore + 1,
		);
		expect(coordinator.calls.at(-1)).toEqual({type: 'endDrag'});
	});

	it('coalesces a burst of keyboard changes within 500 ms into a single commit', async () => {
		const {store, repository, timerEnv} = setupStore();
		const {project} = await store.getState().importImage({
			name: 'burst.png',
			blob: makeTestBlob('burst'),
			width: 200,
			height: 200,
		});
		const instance = await store.getState().addEffect('pixelSort');
		const historyBefore = (await repository.getHistory(project.id)).length;

		store.getState().nudgeParam(instance.id, 'angle', 10);
		timerEnv.advance(200);
		store.getState().nudgeParam(instance.id, 'angle', 20);
		timerEnv.advance(200);
		store.getState().nudgeParam(instance.id, 'angle', 30);
		timerEnv.advance(KEYBOARD_COMMIT_DEBOUNCE_MS - 1);
		await flushMicrotasks();

		expect(await repository.getHistory(project.id)).toHaveLength(historyBefore);

		timerEnv.advance(1);
		await flushMicrotasks();

		const historyAfter = await repository.getHistory(project.id);
		expect(historyAfter).toHaveLength(historyBefore + 1);
		expect(historyAfter.at(-1)?.label).toBe('Change Angle');
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(30);
	});

	it('commits mix, blend, resetParam, and resetInstance', async () => {
		const {store} = setupStore();
		await store.getState().importImage({
			name: 'mix.png',
			blob: makeTestBlob('mix'),
			width: 100,
			height: 100,
		});
		const instance = await store.getState().addEffect('pixelSort');

		await store.getState().commitMix(instance.id, 0.42);
		await store.getState().setBlend(instance.id, 'difference');
		await store.getState().commitParam(instance.id, 'angle', 135);

		expect(store.getState().activeProject?.stack.instances[0].mix).toBe(0.42);
		expect(store.getState().activeProject?.stack.instances[0].blend).toBe(
			'difference',
		);

		await store.getState().resetParam(instance.id, 'angle');
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(0);

		await store.getState().resetInstance(instance.id);
		const reset = store.getState().activeProject?.stack.instances[0];
		expect(reset?.mix).toBe(1);
		expect(reset?.blend).toBe('normal');
	});

	it('undoes and redoes stack + selection without altering viewState, discards redo on new commit, and stops at 200 undos', async () => {
		const {store, coordinator} = setupStore();
		await store.getState().importImage({
			name: 'history.png',
			blob: makeTestBlob('history'),
			width: 500,
			height: 400,
		});
		const instance = await store.getState().addEffect('pixelSort');
		await store.getState().commitParam(instance.id, 'angle', 45);
		await store.getState().commitParam(instance.id, 'angle', 90);

		store.getState().setViewState({
			fitMode: 'custom',
			zoom: 2,
			centerX: 120,
			centerY: 80,
		});

		expect(selectCanUndo(store.getState())).toBe(true);
		expect(selectCanRedo(store.getState())).toBe(false);
		expect(selectUndoLabel(store.getState())).toBe('Change Angle');

		coordinator.calls.length = 0;
		expect(await store.getState().undo()).toBe(true);
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(45);
		expect(store.getState().activeProject?.viewState.zoom).toBe(2);
		expect(selectCanRedo(store.getState())).toBe(true);
		expect(selectRedoLabel(store.getState())).toBe('Change Angle');
		expect(coordinator.calls.at(-1)?.type).toBe('setStack');

		expect(await store.getState().redo()).toBe(true);
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(90);

		// Undo then commit discards redo branch
		await store.getState().undo();
		await store.getState().commitParam(instance.id, 'angle', 180);
		expect(selectCanRedo(store.getState())).toBe(false);
		expect(await store.getState().redo()).toBe(false);

		// 205 total commits -> 200 undos succeed, 201st returns false
		for (let step = 1; step <= 205; step++) {
			await store
				.getState()
				.commitParam(instance.id, 'angle', (step * 1.5) % 360);
		}

		let undoCount = 0;
		while (await store.getState().undo()) {
			undoCount++;
		}

		expect(undoCount).toBe(200);
		expect(await store.getState().undo()).toBe(false);
	});

	it('applies, appends, saves, renames, and deletes presets while protecting built-ins', async () => {
		const {store} = setupStore();
		await store.getState().importImage({
			name: 'presets.png',
			blob: makeTestBlob('presets'),
			width: 200,
			height: 200,
		});

		await store.getState().applyPreset('builtin:asdf-classic');
		const applied = store.getState().activeProject?.stack.instances ?? [];
		expect(applied).toHaveLength(2);
		expect(applied[0].params.angle).toBe(270);
		expect(applied[1].params.angle).toBe(0);
		expect(applied[0].id).not.toBe('psasdf01');

		const saved = await store.getState().saveStackAsPreset('Mine');
		expect(saved.id).toMatch(/^user:/);
		expect(store.getState().presets.map((p) => p.name)).toEqual(['Mine']);

		await store.getState().addPresetToStack('builtin:bright-streaks');
		expect(store.getState().activeProject?.stack.instances).toHaveLength(3);

		const renamed = await store
			.getState()
			.renameUserPreset(saved.id, 'Renamed Preset');
		expect(renamed.name).toBe('Renamed Preset');

		await expect(
			store.getState().renameUserPreset('builtin:asdf-classic', 'Nope'),
		).rejects.toThrow(StorageValidationError);
		await expect(
			store.getState().deleteUserPreset('builtin:asdf-classic'),
		).rejects.toThrow(StorageValidationError);

		expect(await store.getState().deleteUserPreset(saved.id)).toBe(true);
		expect(store.getState().presets).toHaveLength(0);
	});

	it('debounces viewState saves and flushes on visibilitychange/pagehide', async () => {
		const {store, repository, timerEnv} = setupStore();
		const {project} = await store.getState().importImage({
			name: 'view.png',
			blob: makeTestBlob('view'),
			width: 1000,
			height: 800,
		});

		let updateCalls = 0;
		const originalUpdate = repository.updateViewState.bind(repository);
		repository.updateViewState = async (...args) => {
			updateCalls++;
			return originalUpdate(...args);
		};

		store.getState().setViewState({fitMode: 'custom', zoom: 1.5, centerX: 300});
		timerEnv.advance(100);
		store.getState().setViewState({zoom: 2.5, centerY: 200});
		expect(updateCalls).toBe(0);

		timerEnv.advance(VIEW_STATE_DEBOUNCE_MS);
		await flushMicrotasks();
		expect(updateCalls).toBe(1);
		expect((await repository.getProject(project.id))?.viewState).toMatchObject({
			fitMode: 'custom',
			zoom: 2.5,
			centerX: 300,
			centerY: 200,
		});

		// Flush immediately on lifecycle hide/pagehide before debounce elapses
		store.getState().setViewState({zoom: 4, splitPosition: 0.25});
		timerEnv.advance(50);
		expect(updateCalls).toBe(1);

		timerEnv.triggerFlush();
		await flushMicrotasks();
		expect(updateCalls).toBe(2);
		expect((await repository.getProject(project.id))?.viewState).toMatchObject({
			zoom: 4,
			splitPosition: 0.25,
		});
	});

	it('enforces the 32-instance stack limit and generates unique ids and random seeds', async () => {
		const {store} = setupStore();
		await store.getState().importImage({
			name: 'limit.png',
			blob: makeTestBlob('limit'),
			width: 100,
			height: 100,
		});

		const ids = new Set<string>();
		const seeds = new Set<number>();
		for (let count = 0; count < 32; count++) {
			const inst = await store.getState().addEffect('pixelSort');
			expect(inst.id).toMatch(/^[0-9a-z]{8}$/);
			ids.add(inst.id);
			seeds.add(inst.params.seed as number);
		}

		expect(ids.size).toBe(32);
		expect(seeds.size).toBeGreaterThan(25);

		await expect(store.getState().addEffect('pixelSort')).rejects.toThrow(
			StorageValidationError,
		);
		const firstId = store.getState().activeProject!.stack.instances[0].id;
		await expect(store.getState().duplicateEffect(firstId)).rejects.toThrow(
			StorageValidationError,
		);
		await expect(
			store.getState().addPresetToStack('builtin:bright-streaks'),
		).rejects.toThrow(StorageValidationError);
	});

	it('handles hash routing including back/forward, unknown project ids, and dev gallery', async () => {
		const {store, routerEnv} = setupStore();
		const first = await store.getState().importImage({
			name: 'one.png',
			blob: makeTestBlob('one'),
			width: 100,
			height: 100,
		});
		const second = await store.getState().importImage({
			name: 'two.png',
			blob: makeTestBlob('two'),
			width: 100,
			height: 100,
		});

		expect(routerEnv.getHash()).toBe(`#/p/${second.project.id}`);

		routerEnv.navigate(`#/p/${first.project.id}`);
		await flushMicrotasks();
		expect(store.getState().activeProjectId).toBe(first.project.id);

		routerEnv.navigate('#/');
		await flushMicrotasks();
		expect(store.getState().route).toEqual({screen: 'library'});
		expect(store.getState().activeProjectId).toBeNull();

		routerEnv.navigate('#/p/does-not-exist');
		await flushMicrotasks();
		expect(store.getState().route).toEqual({screen: 'library'});
		expect(store.getState().notice).toBe(MISSING_PROJECT_NOTICE);
		expect(routerEnv.getHash()).toBe('#/');

		routerEnv.navigate(DEV_GALLERY_HASH);
		await flushMicrotasks();
		expect(store.getState().route).toEqual({screen: 'gallery'});
	});

	it('captures thumbnails on settled frames and skips drag or selection debug frames', async () => {
		const {store, repository, coordinator, thumbnailCalls} = setupStore();
		const {project} = await store.getState().importImage({
			name: 'thumb.png',
			blob: makeTestBlob('thumb'),
			width: 600,
			height: 400,
		});
		const instance = await store.getState().addEffect('pixelSort');

		const fakeBitmap = {close() {}} as unknown as ImageBitmap;

		// Drag frame should be ignored
		coordinator.emit({
			type: 'frame',
			frame: {
				generation: 1,
				level: 'drag',
				bitmap: fakeBitmap,
				width: 300,
				height: 200,
				totalMs: 10,
				perInstanceMs: [10],
				warnings: [],
			},
		});
		await flushMicrotasks();
		expect(thumbnailCalls).toHaveLength(0);

		// Selection debug view should be ignored
		store.getState().setDebugView({instanceId: instance.id, view: 'selection'});
		coordinator.emit({
			type: 'frame',
			frame: {
				generation: 2,
				level: 'settle',
				bitmap: fakeBitmap,
				width: 600,
				height: 400,
				totalMs: 20,
				perInstanceMs: [20],
				warnings: [],
			},
		});
		await flushMicrotasks();
		expect(thumbnailCalls).toHaveLength(0);

		// Normal settle frame captures and stores thumbnail
		store.getState().setDebugView(null);
		coordinator.emit({
			type: 'frame',
			frame: {
				generation: 3,
				level: 'settle',
				bitmap: fakeBitmap,
				width: 600,
				height: 400,
				totalMs: 20,
				perInstanceMs: [20],
				warnings: [],
			},
		});
		await flushMicrotasks();
		expect(thumbnailCalls).toEqual([3]);
		const storedThumb = await repository.getThumbnail(project.id);
		expect(storedThumb).toBeDefined();
		expect(storedThumb?.width).toBe(512);
	});
});
