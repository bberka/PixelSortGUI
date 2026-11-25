import {describe, expect, it} from 'vite-plus/test';
import {MISSING_PROJECT_NOTICE} from '../../src/state/app-store.ts';
import {DEV_GALLERY_HASH} from '../../src/state/router.ts';
import {createTestStore, flushMicrotasks, makeTestBlob} from './fixtures.ts';

function makeQuotaError(): DOMException {
	return new DOMException('Storage quota exceeded', 'QuotaExceededError');
}

describe('app store — projects, routing, settings, coordinator, and quota', () => {
	it('importImage creates and activates a project, persists it, updates hash, tells coordinator, and requests persistence once', async () => {
		let persistCalls = 0;
		const {store, repository, coordinator, routerEnv} = createTestStore({
			storageManager: {
				async persist() {
					persistCalls++;
					return true;
				},
				async persisted() {
					return true;
				},
			},
		});

		const result = await store.getState().importImage({
			name: 'sunset.jpg',
			blob: makeTestBlob('sunset', 128),
			width: 800,
			height: 600,
		});
		await flushMicrotasks();

		const state = store.getState();
		expect(state.activeProjectId).toBe(result.project.id);
		expect(state.activeProject?.name).toBe('sunset');
		expect(state.activeSource?.sha256).toBe(result.source.sha256);
		expect(state.history).toHaveLength(1);
		expect(state.history[0].label).toBe('Initial');
		expect(state.route).toEqual({
			screen: 'editor',
			projectId: result.project.id,
		});
		expect(routerEnv.getHash()).toBe(`#/p/${result.project.id}`);
		expect(persistCalls).toBe(1);
		expect(state.storage.persisted).toBe(true);

		const persisted = await repository.getProject(result.project.id);
		expect(persisted?.name).toBe('sunset');
		expect((await repository.getAppState()).activeProjectId).toBe(
			result.project.id,
		);
		expect(await repository.getHistory(result.project.id)).toHaveLength(1);

		expect(coordinator.calls).toEqual([
			{
				type: 'setSource',
				source: {
					key: result.source.sha256,
					blob: result.source.blob,
					width: 800,
					height: 600,
				},
			},
			{
				type: 'setStack',
				request: {stack: result.project.stack, debug: undefined},
				options: undefined,
			},
			{type: 'setViewScale', scale: 1},
		]);
	});

	it('importImage with setActive=false persists project without activating or notifying coordinator', async () => {
		const {store, repository, coordinator, routerEnv} = createTestStore();

		const result = await store.getState().importImage({
			name: 'background.png',
			blob: makeTestBlob('bg'),
			width: 200,
			height: 100,
			setActive: false,
		});

		expect(store.getState().projects).toHaveLength(1);
		expect(store.getState().activeProjectId).toBeNull();
		expect(routerEnv.getHash()).toBe('');
		expect(coordinator.calls).toHaveLength(0);
		expect(await repository.getProject(result.project.id)).toBeDefined();
	});

	it('importImages imports multiple files, deduplicates identical sources, and activates only the first', async () => {
		const {store, repository, coordinator, routerEnv} = createTestStore();
		const blobA = makeTestBlob('photo-a', 128);
		const blobB = makeTestBlob('photo-b', 128);

		const results = await store.getState().importImages([
			{name: 'first.jpg', blob: blobA, width: 800, height: 600},
			{name: 'second.png', blob: blobB, width: 640, height: 480},
			{name: 'first-dup.jpg', blob: blobA, width: 800, height: 600},
		]);

		expect(results).toHaveLength(3);
		expect(results[0].deduplicated).toBe(false);
		expect(results[1].deduplicated).toBe(false);
		expect(results[2].deduplicated).toBe(true);
		expect(results[2].source.sha256).toBe(results[0].source.sha256);

		expect(store.getState().projects).toHaveLength(3);
		expect(store.getState().activeProjectId).toBe(results[0].project.id);
		expect(routerEnv.getHash()).toBe(`#/p/${results[0].project.id}`);

		const persisted = await repository.listProjects();
		expect(persisted).toHaveLength(3);
		expect((await repository.getAppState()).activeProjectId).toBe(
			results[0].project.id,
		);

		const sourceCalls = coordinator.calls.filter((c) => c.type === 'setSource');
		expect(sourceCalls).toHaveLength(1);
		expect(sourceCalls[0].source?.key).toBe(results[0].source.sha256);
	});

	it('openProject loads project, source, history, and viewScale into state and coordinator, and flushes pending edits first', async () => {
		const {store, repository, coordinator, routerEnv, timerEnv} =
			createTestStore();
		const first = await store.getState().importImage({
			name: 'first.png',
			blob: makeTestBlob('first'),
			width: 400,
			height: 300,
		});
		const inst = await store.getState().addEffect('pixelSort');
		store.getState().nudgeParam(inst.id, 'angle', 45);
		store.getState().setViewState({fitMode: 'custom', zoom: 2});

		const second = await store.getState().importImage({
			name: 'second.png',
			blob: makeTestBlob('second'),
			width: 600,
			height: 500,
		});

		// Pending nudge and viewState on first must have been flushed when switching
		const firstPersisted = await repository.getProject(first.project.id);
		expect(firstPersisted?.stack.instances[0].params.angle).toBe(45);
		expect(firstPersisted?.viewState.zoom).toBe(2);

		coordinator.calls.length = 0;
		timerEnv.setDevicePixelRatio(2);
		await store.getState().openProject(first.project.id);

		expect(store.getState().activeProjectId).toBe(first.project.id);
		expect(store.getState().route).toEqual({
			screen: 'editor',
			projectId: first.project.id,
		});
		expect(routerEnv.getHash()).toBe(`#/p/${first.project.id}`);
		expect((await repository.getAppState()).activeProjectId).toBe(
			first.project.id,
		);
		expect(coordinator.calls).toEqual([
			{
				type: 'setSource',
				source: {
					key: first.source.sha256,
					blob: first.source.blob,
					width: 400,
					height: 300,
				},
			},
			{
				type: 'setStack',
				request: {
					stack: firstPersisted!.stack,
					debug: undefined,
				},
				options: undefined,
			},
			{type: 'setViewScale', scale: 4},
		]);

		// Verify replaceHash option replaces instead of pushing
		const historyLengthBefore = routerEnv.history.length;
		await store.getState().openProject(second.project.id, {replaceHash: true});
		expect(routerEnv.history).toHaveLength(historyLengthBefore);
		expect(routerEnv.getHash()).toBe(`#/p/${second.project.id}`);
	});

	it('openProject on a missing id returns to library, sets notice, clears activeProjectId, and clears coordinator source', async () => {
		const {store, repository, coordinator, routerEnv} = createTestStore();
		await repository.updateAppState({activeProjectId: 'missing-id'});
		coordinator.calls.length = 0;

		const opened = await store.getState().openProject('missing-id');

		expect(opened).toBeNull();
		expect(store.getState().activeProjectId).toBeNull();
		expect(store.getState().route).toEqual({screen: 'library'});
		expect(store.getState().notice).toBe(MISSING_PROJECT_NOTICE);
		expect(routerEnv.getHash()).toBe('#/');
		expect((await repository.getAppState()).activeProjectId).toBeNull();
		expect(coordinator.calls).toEqual([{type: 'setSource', source: undefined}]);

		store.getState().clearNotice();
		expect(store.getState().notice).toBeNull();
	});

	it('closeProject flushes pending edits, clears state and persisted activeProjectId, resets hash, and clears coordinator source', async () => {
		const {store, repository, coordinator, routerEnv} = createTestStore();
		const {project} = await store.getState().importImage({
			name: 'close-me.png',
			blob: makeTestBlob('close'),
			width: 300,
			height: 200,
		});
		const inst = await store.getState().addEffect('pixelSort');
		store.getState().nudgeParam(inst.id, 'angle', 90);
		store.getState().setViewState({splitPosition: 0.25});

		coordinator.calls.length = 0;
		await store.getState().closeProject();

		const state = store.getState();
		expect(state.activeProjectId).toBeNull();
		expect(state.activeProject).toBeNull();
		expect(state.activeSource).toBeNull();
		expect(state.history).toEqual([]);
		expect(state.route).toEqual({screen: 'library'});
		expect(routerEnv.getHash()).toBe('#/');
		expect((await repository.getAppState()).activeProjectId).toBeNull();

		const persisted = await repository.getProject(project.id);
		expect(persisted?.stack.instances[0].params.angle).toBe(90);
		expect(persisted?.viewState.splitPosition).toBe(0.25);

		expect(coordinator.calls.at(-1)).toEqual({
			type: 'setSource',
			source: undefined,
		});
	});

	it('renameProject trims and persists the new name for active and inactive projects', async () => {
		const {store, repository, coordinator} = createTestStore();
		const {project} = await store.getState().importImage({
			name: 'old.png',
			blob: makeTestBlob('old'),
			width: 200,
			height: 200,
		});
		coordinator.calls.length = 0;

		const updated = await store
			.getState()
			.renameProject(project.id, '  New Title  ');

		expect(updated.name).toBe('New Title');
		expect(store.getState().activeProject?.name).toBe('New Title');
		expect(store.getState().projects[0].name).toBe('New Title');
		expect((await repository.getProject(project.id))?.name).toBe('New Title');
		expect(coordinator.calls).toHaveLength(0);
	});

	it('duplicateProject flushes pending edits, persists a copy sharing sourceHash, and keeps active project unchanged', async () => {
		const {store, repository, coordinator} = createTestStore();
		const {project} = await store.getState().importImage({
			name: 'orig.png',
			blob: makeTestBlob('orig'),
			width: 200,
			height: 200,
		});
		const inst = await store.getState().addEffect('pixelSort');
		store.getState().nudgeParam(inst.id, 'angle', 120);
		coordinator.calls.length = 0;

		const copy = await store.getState().duplicateProject(project.id);

		expect(copy.name).toBe('orig copy');
		expect(copy.sourceHash).toBe(project.sourceHash);
		expect(copy.stack.instances[0].params.angle).toBe(120);
		expect(store.getState().activeProjectId).toBe(project.id);
		expect(store.getState().projects).toHaveLength(2);
		expect(await repository.getProject(copy.id)).toBeDefined();
		expect((await repository.getHistory(copy.id)).length).toBeGreaterThan(1);
	});

	it('deleteProject removes an inactive project without disturbing the active project or coordinator', async () => {
		const {store, repository, coordinator} = createTestStore();
		const first = await store.getState().importImage({
			name: 'keep.png',
			blob: makeTestBlob('keep'),
			width: 100,
			height: 100,
		});
		const second = await store.getState().importImage({
			name: 'drop.png',
			blob: makeTestBlob('drop'),
			width: 100,
			height: 100,
			setActive: false,
		});
		coordinator.calls.length = 0;

		const result = await store.getState().deleteProject(second.project.id);

		expect(result.deleted).toBe(true);
		expect(result.sourceDeleted).toBe(true);
		expect(store.getState().activeProjectId).toBe(first.project.id);
		expect(store.getState().projects.map((p) => p.id)).toEqual([
			first.project.id,
		]);
		expect(await repository.getProject(second.project.id)).toBeUndefined();
		expect(await repository.getSource(second.source.sha256)).toBeUndefined();
		expect(coordinator.calls).toHaveLength(0);
	});

	it('deleteProject on the active project cancels pending timers, returns to library, and clears coordinator source', async () => {
		const {store, repository, coordinator, routerEnv, timerEnv} =
			createTestStore();
		const {project, source} = await store.getState().importImage({
			name: 'active-drop.png',
			blob: makeTestBlob('active-drop'),
			width: 100,
			height: 100,
		});
		const inst = await store.getState().addEffect('pixelSort');
		store.getState().nudgeParam(inst.id, 'angle', 45);
		store.getState().setViewState({zoom: 3});
		coordinator.calls.length = 0;

		const result = await store.getState().deleteProject(project.id);
		// Advancing timers must not throw or recreate anything
		timerEnv.advance(1000);
		await flushMicrotasks();

		expect(result.deleted).toBe(true);
		expect(result.sourceDeleted).toBe(true);
		expect(store.getState().activeProjectId).toBeNull();
		expect(store.getState().route).toEqual({screen: 'library'});
		expect(routerEnv.getHash()).toBe('#/');
		expect(await repository.getProject(project.id)).toBeUndefined();
		expect(await repository.getSource(source.sha256)).toBeUndefined();
		expect(coordinator.calls).toEqual([{type: 'setSource', source: undefined}]);
	});

	it('persists compareMode, theme (with syncTheme), and exportSettings', async () => {
		const {store, repository, syncedThemes} = createTestStore();
		const {project} = await store.getState().importImage({
			name: 'settings.png',
			blob: makeTestBlob('settings'),
			width: 500,
			height: 400,
		});

		await store.getState().setCompareMode('split');
		expect(store.getState().compareMode).toBe('split');
		expect((await repository.getAppState()).compareMode).toBe('split');

		await store.getState().setTheme('dark');
		expect(store.getState().theme).toBe('dark');
		expect(syncedThemes).toEqual(['dark']);
		expect((await repository.getAppState()).theme).toBe('dark');

		const updated = await store.getState().updateExportSettings({
			format: 'jpeg',
			quality: 85,
			sizeMode: 'half',
			customLongestSide: null,
		});
		expect(updated.exportSettings.format).toBe('jpeg');
		expect(store.getState().activeProject?.exportSettings.quality).toBe(85);
		expect((await repository.getProject(project.id))?.exportSettings).toEqual({
			format: 'jpeg',
			quality: 85,
			sizeMode: 'half',
			customLongestSide: null,
		});
	});

	it('syncs route on hashchange (editor, library, missing project, gallery) and stops after dispose', async () => {
		const {store, routerEnv, bundle} = createTestStore();
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
		expect(store.getState().activeProjectId).toBe(second.project.id);

		routerEnv.navigate(`#/p/${first.project.id}`);
		await flushMicrotasks();
		expect(store.getState().activeProjectId).toBe(first.project.id);

		routerEnv.navigate('#/');
		await flushMicrotasks();
		expect(store.getState().route).toEqual({screen: 'library'});
		expect(store.getState().activeProjectId).toBeNull();

		routerEnv.navigate('#/p/no-such-project');
		await flushMicrotasks();
		expect(store.getState().route).toEqual({screen: 'library'});
		expect(store.getState().notice).toBe(MISSING_PROJECT_NOTICE);
		expect(routerEnv.getHash()).toBe('#/');

		routerEnv.navigate(DEV_GALLERY_HASH);
		await flushMicrotasks();
		expect(store.getState().route).toEqual({screen: 'gallery'});

		bundle.dispose();
		routerEnv.navigate(`#/p/${first.project.id}`);
		await flushMicrotasks();
		expect(store.getState().route).toEqual({screen: 'gallery'});
	});

	it('updates render status from coordinator source, frame, full, busy, progress, and error events', async () => {
		const {store, coordinator} = createTestStore();
		const fakeBitmap = {close() {}} as unknown as ImageBitmap;

		coordinator.emit({
			type: 'source',
			source: {
				key: 'k1',
				width: 800,
				height: 600,
				settle: {width: 800, height: 600},
				drag: {width: 400, height: 300},
				original: fakeBitmap,
			},
		});
		expect(store.getState().render.source?.key).toBe('k1');
		expect(store.getState().render.source?.width).toBe(800);

		coordinator.emit({type: 'busy', level: 'settle', busy: true});
		coordinator.emit({type: 'progress', level: 'settle', fraction: 0.5});
		expect(store.getState().render.busy.settle).toBe(true);
		expect(store.getState().render.progress.settle).toBe(0.5);

		coordinator.emit({type: 'busy', level: 'settle', busy: false});
		expect(store.getState().render.busy.settle).toBe(false);
		expect(store.getState().render.progress.settle).toBe(0);

		coordinator.emit({
			type: 'error',
			error: {code: 'worker-crashed', message: 'boom'},
			failed: true,
		});
		expect(store.getState().render.error?.message).toBe('boom');
		expect(store.getState().render.failed).toBe(true);

		coordinator.emit({
			type: 'frame',
			frame: {
				generation: 1,
				level: 'settle',
				bitmap: fakeBitmap,
				width: 800,
				height: 600,
				totalMs: 12,
				perInstanceMs: [],
				warnings: [],
			},
		});
		expect(store.getState().render.frame?.generation).toBe(1);
		expect(store.getState().render.error).toBeNull();

		coordinator.emit({
			type: 'full',
			full: {
				generation: 1,
				width: 800,
				height: 600,
				tiles: [],
			},
		});
		expect(store.getState().render.full?.width).toBe(800);
	});

	it('captures thumbnails on settled frames, skips drag/debug/activeDrag/duplicate stack signatures', async () => {
		const {store, repository, coordinator, thumbnailCalls} = createTestStore();
		const {project} = await store.getState().importImage({
			name: 'thumb.png',
			blob: makeTestBlob('thumb'),
			width: 600,
			height: 400,
		});
		const instance = await store.getState().addEffect('pixelSort');
		const fakeBitmap = {close() {}} as unknown as ImageBitmap;

		const emitFrame = (generation: number, level: 'drag' | 'settle') => {
			coordinator.emit({
				type: 'frame',
				frame: {
					generation,
					level,
					bitmap: fakeBitmap,
					width: 600,
					height: 400,
					totalMs: 15,
					perInstanceMs: [15],
					warnings: [],
				},
			});
		};

		// 1. Drag level frame skipped
		emitFrame(1, 'drag');
		await flushMicrotasks();
		expect(thumbnailCalls).toEqual([]);

		// 2. Selection debug view active skipped
		store.getState().setDebugView({instanceId: instance.id, view: 'selection'});
		emitFrame(2, 'settle');
		await flushMicrotasks();
		expect(thumbnailCalls).toEqual([]);
		store.getState().setDebugView(null);

		// 3. Active drag in transientStore skipped
		store.getState().dragParam(instance.id, 'angle', 45);
		emitFrame(3, 'settle');
		await flushMicrotasks();
		expect(thumbnailCalls).toEqual([]);
		store.getState().cancelDrag();

		// 4. Normal settle frame captured and persisted
		emitFrame(4, 'settle');
		await flushMicrotasks();
		expect(thumbnailCalls).toEqual([4]);
		const stored = await repository.getThumbnail(project.id);
		expect(stored?.width).toBe(512);
		expect(store.getState().activeThumbnail?.projectId).toBe(project.id);

		// 5. Same stack signature skipped on subsequent settle frame
		emitFrame(5, 'settle');
		await flushMicrotasks();
		expect(thumbnailCalls).toEqual([4]);
	});

	it('sets storage.quotaFull and leaves state consistent with persistence when QuotaExceededError occurs', async () => {
		const {store, repository, coordinator} = createTestStore();
		const {project} = await store.getState().importImage({
			name: 'quota.png',
			blob: makeTestBlob('quota'),
			width: 200,
			height: 200,
		});
		const inst = await store.getState().addEffect('pixelSort');
		coordinator.calls.length = 0;

		const origCommit = repository.commitStack.bind(repository);
		repository.commitStack = async () => {
			throw makeQuotaError();
		};

		await expect(
			store.getState().commitParam(inst.id, 'angle', 180),
		).rejects.toThrow();

		expect(store.getState().storage.quotaFull).toBe(true);
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(0);
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].params
				.angle,
		).toBe(0);
		expect(coordinator.calls).toHaveLength(0);

		store.getState().clearQuotaFull();
		expect(store.getState().storage.quotaFull).toBe(false);

		// Restore commitStack and verify quotaFull on importImage too
		repository.commitStack = origCommit;
		repository.createProject = async () => {
			throw makeQuotaError();
		};

		await expect(
			store.getState().importImage({
				name: 'too-big.png',
				blob: makeTestBlob('big'),
				width: 100,
				height: 100,
			}),
		).rejects.toThrow();
		expect(store.getState().storage.quotaFull).toBe(true);
		expect(store.getState().projects).toHaveLength(1);
	});
});
