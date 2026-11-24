import {afterEach, describe, expect, it} from 'vite-plus/test';
import {
	createBrowserTimerEnv,
	selectCanRedo,
	selectCanUndo,
	selectRedoLabel,
	selectUndoLabel,
} from '../../src/state/app-store.ts';
import {StorageValidationError} from '../../src/storage/types.ts';
import {createTestStore, flushMicrotasks, makeTestBlob} from './fixtures.ts';

async function setupWithProject() {
	const ctx = createTestStore();
	const {project} = await ctx.store.getState().importImage({
		name: 'history.png',
		blob: makeTestBlob('history'),
		width: 800,
		height: 600,
	});
	ctx.coordinator.calls.length = 0;
	return {...ctx, project};
}

describe('app store — undo/redo, presets, and view-state persistence', () => {
	it('undo and redo restore stack, persisted historyHeadSeq, coordinator stack, and selection from each history entry without changing viewState', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();
		const first = await store.getState().addEffect('pixelSort');
		const second = await store.getState().addEffect('channelShift');
		// Select first, then commit a param change on first -> entry records selectedInstanceId = first.id
		store.getState().selectEffect(first.id);
		await store.getState().commitParam(first.id, 'angle', 90);

		store.getState().setViewState({
			fitMode: 'custom',
			zoom: 2.5,
			centerX: 150,
			centerY: 100,
			splitPosition: 0.3,
		});

		expect(selectCanUndo(store.getState())).toBe(true);
		expect(selectCanRedo(store.getState())).toBe(false);
		expect(selectUndoLabel(store.getState())).toBe('Change Angle');
		expect(selectRedoLabel(store.getState())).toBeNull();

		coordinator.calls.length = 0;
		expect(await store.getState().undo()).toBe(true);

		// State: angle reverted to 0, selection restored to second.id (recorded at "Add Channel shift"), viewState untouched
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(0);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(second.id);
		expect(store.getState().activeProject?.viewState).toMatchObject({
			fitMode: 'custom',
			zoom: 2.5,
			centerX: 150,
			centerY: 100,
			splitPosition: 0.3,
		});
		expect(selectUndoLabel(store.getState())).toBe('Add Channel shift');
		expect(selectCanRedo(store.getState())).toBe(true);
		expect(selectRedoLabel(store.getState())).toBe('Change Angle');

		// Persisted head and selection match
		const persistedAfterUndo = await repository.getProject(project.id);
		expect(persistedAfterUndo?.historyHeadSeq).toBe(2);
		expect(persistedAfterUndo?.selectedInstanceId).toBe(second.id);

		// Coordinator told with restored stack
		expect(coordinator.calls).toHaveLength(1);
		expect(coordinator.calls[0].type).toBe('setStack');
		if (coordinator.calls[0].type !== 'setStack') {
			return;
		}

		expect(coordinator.calls[0].options).toBeUndefined();
		expect(coordinator.calls[0].request.stack.instances[0].params.angle).toBe(
			0,
		);

		// Redo restores angle 90 AND selection back to first.id
		coordinator.calls.length = 0;
		expect(await store.getState().redo()).toBe(true);
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(90);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(first.id);
		expect(store.getState().activeProject?.viewState.zoom).toBe(2.5);
		expect((await repository.getProject(project.id))?.historyHeadSeq).toBe(3);
		expect((await repository.getProject(project.id))?.selectedInstanceId).toBe(
			first.id,
		);
		expect(coordinator.calls).toHaveLength(1);
		if (coordinator.calls[0].type === 'setStack') {
			expect(coordinator.calls[0].request.stack.instances[0].params.angle).toBe(
				90,
			);
		}
	});

	it('undo clears debugView if the debug target instance does not exist in the restored stack', async () => {
		const {store, coordinator} = await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		store.getState().setDebugView({instanceId: inst.id, view: 'selection'});
		coordinator.calls.length = 0;

		expect(await store.getState().undo()).toBe(true);
		expect(store.getState().debugView).toBeNull();
		expect(coordinator.calls).toHaveLength(1);
		if (coordinator.calls[0].type === 'setStack') {
			expect(coordinator.calls[0].request.debug).toBeUndefined();
		}
	});

	it('new commit after undo discards the redo branch in both store and repository', async () => {
		const {store, repository, project} = await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		await store.getState().commitParam(inst.id, 'angle', 45);
		await store.getState().commitParam(inst.id, 'angle', 90);
		await store.getState().undo();
		expect(selectCanRedo(store.getState())).toBe(true);

		await store.getState().commitParam(inst.id, 'angle', 180);

		expect(selectCanRedo(store.getState())).toBe(false);
		expect(selectRedoLabel(store.getState())).toBeNull();
		expect(await store.getState().redo()).toBe(false);
		const persisted = await repository.getProject(project.id);
		expect(persisted?.historyHeadSeq).toBe(persisted?.historyMaxSeq);
	});

	it('retains at most 200 undoable commits after 205 commits', async () => {
		const {store} = await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');

		for (let step = 1; step <= 205; step++) {
			await store.getState().commitParam(inst.id, 'angle', (step * 1.5) % 360);
		}

		let undoCount = 0;
		while (await store.getState().undo()) {
			undoCount++;
		}

		expect(undoCount).toBe(200);
		expect(selectCanUndo(store.getState())).toBe(false);
		expect(await store.getState().undo()).toBe(false);
	});

	it('undo while a pointer drag is active clears the drag and undoes the last commit', async () => {
		const {store, transientStore, coordinator} = await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		await store.getState().commitParam(inst.id, 'angle', 45);

		store.getState().dragParam(inst.id, 'angle', 120);
		expect(transientStore.getState().activeDrag).not.toBeNull();
		coordinator.calls.length = 0;

		expect(await store.getState().undo()).toBe(true);

		expect(transientStore.getState().activeDrag).toBeNull();
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(0);
		expect(coordinator.calls).toHaveLength(1);
		expect(coordinator.calls[0].type).toBe('setStack');
		if (coordinator.calls[0].type !== 'setStack') {
			return;
		}

		expect(coordinator.calls[0].options).toBeUndefined();
		expect(coordinator.calls[0].request.stack.instances[0].params.angle).toBe(
			0,
		);
	});

	it('undo while a keyboard burst is pending flushes the burst first and then undoes it', async () => {
		const {store, transientStore, repository, project} =
			await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		await store.getState().commitParam(inst.id, 'angle', 45);

		store.getState().nudgeParam(inst.id, 'angle', 60);
		expect(transientStore.getState().activeDrag?.params.angle).toBe(60);

		expect(await store.getState().undo()).toBe(true);

		expect(transientStore.getState().activeDrag).toBeNull();
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(45);
		expect(selectCanRedo(store.getState())).toBe(true);
		expect(selectRedoLabel(store.getState())).toBe('Change Angle');
		// Redo returns to the flushed nudge value 60
		expect(await store.getState().redo()).toBe(true);
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].params
				.angle,
		).toBe(60);
	});

	it('applyPreset replaces the stack with fresh ids, selects first instance, persists, and tells coordinator', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();
		await store.getState().addEffect('channelShift');
		coordinator.calls.length = 0;

		await store.getState().applyPreset('builtin:asdf-classic');

		const instances = store.getState().activeProject?.stack.instances ?? [];
		expect(instances).toHaveLength(2);
		expect(instances[0].params.angle).toBe(270);
		expect(instances[1].params.angle).toBe(0);
		expect(instances[0].id).not.toBe('psasdf01');
		expect(store.getState().activeProject?.selectedInstanceId).toBe(
			instances[0].id,
		);

		const persisted = await repository.getProject(project.id);
		expect(persisted?.stack.instances.map((i) => i.id)).toEqual(
			instances.map((i) => i.id),
		);
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Apply ASDF classic',
		);
		expect(coordinator.calls).toHaveLength(1);
	});

	it('addPresetToStack appends preset instances with fresh non-colliding ids, persists, and tells coordinator', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();
		const existing = await store.getState().addEffect('channelShift');
		coordinator.calls.length = 0;

		await store.getState().addPresetToStack('builtin:bright-streaks');

		const instances = store.getState().activeProject?.stack.instances ?? [];
		expect(instances).toHaveLength(2);
		expect(instances[0].id).toBe(existing.id);
		expect(instances[1].id).not.toBe(existing.id);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(
			instances[1].id,
		);

		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Add Bright streaks',
		);
		expect(coordinator.calls).toHaveLength(1);
	});

	it('saveStackAsPreset, renameUserPreset, and deleteUserPreset persist user presets sorted by name and protect built-ins', async () => {
		const {store, repository, coordinator} = await setupWithProject();
		await store.getState().applyPreset('builtin:asdf-classic');
		coordinator.calls.length = 0;

		const zeta = await store.getState().saveStackAsPreset('Zeta');
		const alpha = await store.getState().saveStackAsPreset('Alpha');
		expect(zeta.id).toMatch(/^user:/);
		expect(store.getState().presets.map((p) => p.name)).toEqual([
			'Alpha',
			'Zeta',
		]);
		expect((await repository.listPresets()).map((p) => p.name)).toEqual([
			'Alpha',
			'Zeta',
		]);
		expect(coordinator.calls).toHaveLength(0);

		const renamed = await store.getState().renameUserPreset(zeta.id, 'Beta');
		expect(renamed.name).toBe('Beta');
		expect(store.getState().presets.map((p) => p.name)).toEqual([
			'Alpha',
			'Beta',
		]);
		expect((await repository.listPresets()).map((p) => p.name)).toEqual([
			'Alpha',
			'Beta',
		]);

		await expect(
			store.getState().renameUserPreset('builtin:asdf-classic', 'Nope'),
		).rejects.toThrow(StorageValidationError);
		await expect(
			store.getState().deleteUserPreset('builtin:asdf-classic'),
		).rejects.toThrow(StorageValidationError);

		expect(await store.getState().deleteUserPreset(alpha.id)).toBe(true);
		expect(store.getState().presets.map((p) => p.name)).toEqual(['Beta']);
		expect((await repository.listPresets()).map((p) => p.name)).toEqual([
			'Beta',
		]);
	});

	it('setViewState updates coordinator viewScale, does not persist at 199 ms, restarts wait on second change, and persists at 200 ms', async () => {
		const {store, repository, coordinator, timerEnv, project} =
			await setupWithProject();
		timerEnv.setDevicePixelRatio(2);

		let updateCalls = 0;
		const origUpdate = repository.updateViewState.bind(repository);
		repository.updateViewState = async (...args) => {
			updateCalls++;
			return origUpdate(...args);
		};

		store.getState().setViewState({fitMode: 'custom', zoom: 1.5, centerX: 300});
		expect(coordinator.calls).toEqual([{type: 'setViewScale', scale: 3}]);

		// 199 ms after first change: not saved yet
		timerEnv.advance(199);
		await flushMicrotasks();
		expect(updateCalls).toBe(0);

		// Second change restarts the 200 ms timer
		store.getState().setViewState({zoom: 2.5, centerY: 200});
		expect(coordinator.calls.at(-1)).toEqual({
			type: 'setViewScale',
			scale: 5,
		});

		// 199 ms after second change: still not saved
		timerEnv.advance(199);
		await flushMicrotasks();
		expect(updateCalls).toBe(0);

		// At 200 ms after second change: saved once with merged state
		timerEnv.advance(1);
		await flushMicrotasks();
		expect(updateCalls).toBe(1);
		expect((await repository.getProject(project.id))?.viewState).toMatchObject({
			fitMode: 'custom',
			zoom: 2.5,
			centerX: 300,
			centerY: 200,
		});

		// Switching back to fit sends viewScale 0
		store.getState().setViewState({fitMode: 'fit'});
		expect(coordinator.calls.at(-1)).toEqual({type: 'setViewScale', scale: 0});
	});

	it('dragSplitPosition stays in transientStore and commitSplitPosition schedules a debounced viewState save', async () => {
		const {store, transientStore, repository, timerEnv, project} =
			await setupWithProject();

		let notifications = 0;
		const unsub = store.subscribe(() => {
			notifications++;
		});
		store.getState().dragSplitPosition(0.2);
		store.getState().dragSplitPosition(1.5); // Clamps to 1
		unsub();

		expect(notifications).toBe(0);
		expect(transientStore.getState().splitPosition).toBe(1);
		expect(
			(await repository.getProject(project.id))?.viewState.splitPosition,
		).toBe(0.5);

		store.getState().commitSplitPosition(0.35);
		expect(transientStore.getState().splitPosition).toBeNull();
		expect(store.getState().activeProject?.viewState.splitPosition).toBe(0.35);

		timerEnv.advance(199);
		await flushMicrotasks();
		expect(
			(await repository.getProject(project.id))?.viewState.splitPosition,
		).toBe(0.5);

		timerEnv.advance(1);
		await flushMicrotasks();
		expect(
			(await repository.getProject(project.id))?.viewState.splitPosition,
		).toBe(0.35);
	});
});

describe('app store — real browser lifecycle flush (visibilitychange & pagehide)', () => {
	const originalDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		'document',
	);
	const originalAddEventListener = Object.getOwnPropertyDescriptor(
		globalThis,
		'addEventListener',
	);
	const originalRemoveEventListener = Object.getOwnPropertyDescriptor(
		globalThis,
		'removeEventListener',
	);

	afterEach(() => {
		if (originalDocument) {
			Object.defineProperty(globalThis, 'document', originalDocument);
		} else {
			Reflect.deleteProperty(globalThis, 'document');
		}

		if (originalAddEventListener) {
			Object.defineProperty(
				globalThis,
				'addEventListener',
				originalAddEventListener,
			);
		} else {
			Reflect.deleteProperty(globalThis, 'addEventListener');
		}

		if (originalRemoveEventListener) {
			Object.defineProperty(
				globalThis,
				'removeEventListener',
				originalRemoveEventListener,
			);
		} else {
			Reflect.deleteProperty(globalThis, 'removeEventListener');
		}
	});

	function installFakeBrowserEvents() {
		const docTarget = new EventTarget();
		const winTarget = new EventTarget();
		let visibilityState: 'visible' | 'hidden' = 'visible';

		Object.defineProperties(globalThis, {
			document: {
				configurable: true,
				value: {
					get visibilityState() {
						return visibilityState;
					},
					addEventListener: docTarget.addEventListener.bind(docTarget),
					removeEventListener: docTarget.removeEventListener.bind(docTarget),
					dispatchEvent: docTarget.dispatchEvent.bind(docTarget),
				},
			},
			addEventListener: {
				configurable: true,
				value: winTarget.addEventListener.bind(winTarget),
			},
			removeEventListener: {
				configurable: true,
				value: winTarget.removeEventListener.bind(winTarget),
			},
		});

		return {
			setVisibility(next: 'visible' | 'hidden') {
				visibilityState = next;
				docTarget.dispatchEvent(new Event('visibilitychange'));
			},
			dispatchPageHide() {
				winTarget.dispatchEvent(new Event('pagehide'));
			},
		};
	}

	it('flushes viewState immediately on visibilitychange to hidden (not visible) and on pagehide, and removes listeners on dispose', async () => {
		const events = installFakeBrowserEvents();
		const browserTimerEnv = createBrowserTimerEnv();
		// Prevent timers from auto-firing while keeping real lifecycle listeners
		const pendingHandles = new Set<number>();
		let nextHandle = 1;
		const manualTimerEnv = {
			...browserTimerEnv,
			setTimeout(_cb: () => void, _ms: number) {
				const handle = nextHandle++;
				pendingHandles.add(handle);
				return handle;
			},
			clearTimeout(handle: unknown) {
				pendingHandles.delete(handle as number);
			},
		};

		const {store, repository, bundle} = createTestStore({
			timerEnv: manualTimerEnv,
		});
		const {project} = await store.getState().importImage({
			name: 'lifecycle.png',
			blob: makeTestBlob('lifecycle'),
			width: 400,
			height: 300,
		});

		// 1. visibilitychange to 'visible' must NOT flush
		store.getState().setViewState({fitMode: 'custom', zoom: 2});
		events.setVisibility('visible');
		await flushMicrotasks();
		expect((await repository.getProject(project.id))?.viewState.zoom).toBe(1);

		// 2. visibilitychange to 'hidden' flushes immediately without advancing timers
		events.setVisibility('hidden');
		await flushMicrotasks();
		expect((await repository.getProject(project.id))?.viewState.zoom).toBe(2);

		// 3. pagehide flushes immediately without advancing timers
		store.getState().setViewState({fitMode: 'custom', zoom: 3.5});
		expect((await repository.getProject(project.id))?.viewState.zoom).toBe(2);
		events.dispatchPageHide();
		await flushMicrotasks();
		expect((await repository.getProject(project.id))?.viewState.zoom).toBe(3.5);

		// 4. dispose() removes both listeners so later events do not flush
		bundle.dispose();
		store.getState().setViewState({fitMode: 'custom', zoom: 5});
		events.setVisibility('hidden');
		events.dispatchPageHide();
		await flushMicrotasks();
		expect((await repository.getProject(project.id))?.viewState.zoom).toBe(3.5);
	});
});
