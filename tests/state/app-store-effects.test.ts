import {describe, expect, it} from 'vite-plus/test';
import {StorageValidationError} from '../../src/storage/types.ts';
import {createTestStore, flushMicrotasks, makeTestBlob} from './fixtures.ts';

async function setupWithProject() {
	const ctx = createTestStore();
	const {project} = await ctx.store.getState().importImage({
		name: 'effects.png',
		blob: makeTestBlob('effects'),
		width: 400,
		height: 300,
	});
	ctx.coordinator.calls.length = 0;
	return {...ctx, project};
}

describe('app store — effect stack, selection, drag, keyboard burst, and limits', () => {
	it('addEffect appends an instance with defaults, selects it, persists history, and tells coordinator', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();

		const added = await store.getState().addEffect('pixelSort');

		expect(added.id).toMatch(/^[0-9a-z]{8}$/);
		expect(added.type).toBe('pixelSort');
		expect(store.getState().activeProject?.selectedInstanceId).toBe(added.id);
		expect(store.getState().activeProject?.stack.instances).toHaveLength(1);

		const persisted = await repository.getProject(project.id);
		expect(persisted?.stack.instances.map((i) => i.id)).toEqual([added.id]);
		expect(persisted?.selectedInstanceId).toBe(added.id);
		const history = await repository.getHistory(project.id);
		expect(history.at(-1)?.label).toBe('Add Pixel sort');

		expect(coordinator.calls).toEqual([
			{
				type: 'setStack',
				request: {stack: persisted!.stack, debug: undefined},
				options: undefined,
			},
		]);
	});

	it('removeEffect selects the next instance at the same index when removing a selected middle instance', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();
		const first = await store.getState().addEffect('pixelSort');
		const second = await store.getState().addEffect('channelShift');
		const third = await store.getState().addEffect('pixelSort');
		store.getState().selectEffect(second.id);
		coordinator.calls.length = 0;

		await store.getState().removeEffect(second.id);

		expect(
			store.getState().activeProject?.stack.instances.map((i) => i.id),
		).toEqual([first.id, third.id]);
		// Must select third (same index 1), NOT first (index 0)
		expect(store.getState().activeProject?.selectedInstanceId).toBe(third.id);

		const persisted = await repository.getProject(project.id);
		expect(persisted?.selectedInstanceId).toBe(third.id);
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Remove Channel shift',
		);

		expect(coordinator.calls).toEqual([
			{
				type: 'setStack',
				request: {stack: persisted!.stack, debug: undefined},
				options: undefined,
			},
		]);
	});

	it('removeEffect selects the previous instance when removing the selected last instance', async () => {
		const {store, repository, project} = await setupWithProject();
		const first = await store.getState().addEffect('pixelSort');
		const second = await store.getState().addEffect('channelShift');
		const third = await store.getState().addEffect('pixelSort');
		expect(store.getState().activeProject?.selectedInstanceId).toBe(third.id);

		await store.getState().removeEffect(third.id);

		expect(
			store.getState().activeProject?.stack.instances.map((i) => i.id),
		).toEqual([first.id, second.id]);
		// Must select second (previous index 1), NOT first (index 0)
		expect(store.getState().activeProject?.selectedInstanceId).toBe(second.id);
		expect((await repository.getProject(project.id))?.selectedInstanceId).toBe(
			second.id,
		);
	});

	it('removeEffect sets selectedInstanceId to null when removing the only instance', async () => {
		const {store, repository, project} = await setupWithProject();
		const only = await store.getState().addEffect('pixelSort');

		await store.getState().removeEffect(only.id);

		expect(store.getState().activeProject?.stack.instances).toEqual([]);
		expect(store.getState().activeProject?.selectedInstanceId).toBeNull();
		expect(
			(await repository.getProject(project.id))?.selectedInstanceId,
		).toBeNull();
	});

	it('removeEffect preserves selection when removing a non-selected instance', async () => {
		const {store, repository, project} = await setupWithProject();
		const first = await store.getState().addEffect('pixelSort');
		const second = await store.getState().addEffect('channelShift');
		const third = await store.getState().addEffect('pixelSort');
		store.getState().selectEffect(third.id);

		await store.getState().removeEffect(first.id);

		expect(
			store.getState().activeProject?.stack.instances.map((i) => i.id),
		).toEqual([second.id, third.id]);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(third.id);
		expect((await repository.getProject(project.id))?.selectedInstanceId).toBe(
			third.id,
		);
	});

	it('removeEffect clears debugView when its target instance is removed', async () => {
		const {store, coordinator} = await setupWithProject();
		const first = await store.getState().addEffect('pixelSort');
		await store.getState().addEffect('channelShift');
		store.getState().setDebugView({instanceId: first.id, view: 'selection'});
		expect(store.getState().debugView).toEqual({
			instanceId: first.id,
			view: 'selection',
		});
		coordinator.calls.length = 0;

		await store.getState().removeEffect(first.id);

		expect(store.getState().debugView).toBeNull();
		expect(coordinator.calls).toHaveLength(1);
		const call = coordinator.calls[0];
		expect(call.type).toBe('setStack');
		if (call.type === 'setStack') {
			expect(call.request.debug).toBeUndefined();
		}
	});

	it('duplicateEffect inserts a copy directly below with a new id and identical params, selects it, persists, and tells coordinator', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();
		const first = await store.getState().addEffect('pixelSort');
		const second = await store.getState().addEffect('channelShift');
		coordinator.calls.length = 0;

		const dup = await store.getState().duplicateEffect(first.id);

		expect(dup.id).not.toBe(first.id);
		expect(dup.params).toEqual(first.params);
		expect(
			store.getState().activeProject?.stack.instances.map((i) => i.id),
		).toEqual([first.id, dup.id, second.id]);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(dup.id);

		const persisted = await repository.getProject(project.id);
		expect(persisted?.stack.instances.map((i) => i.id)).toEqual([
			first.id,
			dup.id,
			second.id,
		]);
		expect(persisted?.selectedInstanceId).toBe(dup.id);
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Duplicate Pixel sort',
		);

		expect(coordinator.calls).toEqual([
			{
				type: 'setStack',
				request: {stack: persisted!.stack, debug: undefined},
				options: undefined,
			},
		]);
	});

	it('reorderEffect moves an instance, preserves selection, persists, tells coordinator, and ignores invalid indices', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();
		const a = await store.getState().addEffect('pixelSort');
		const b = await store.getState().addEffect('channelShift');
		const c = await store.getState().addEffect('pixelSort');
		store.getState().selectEffect(b.id);
		coordinator.calls.length = 0;

		await store.getState().reorderEffect(2, 0);

		expect(
			store.getState().activeProject?.stack.instances.map((i) => i.id),
		).toEqual([c.id, a.id, b.id]);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(b.id);
		const persisted = await repository.getProject(project.id);
		expect(persisted?.stack.instances.map((i) => i.id)).toEqual([
			c.id,
			a.id,
			b.id,
		]);
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Reorder Pixel sort',
		);
		expect(coordinator.calls).toHaveLength(1);

		// Invalid / no-op reorders do nothing
		coordinator.calls.length = 0;
		const historyCount = (await repository.getHistory(project.id)).length;
		await store.getState().reorderEffect(1, 1);
		await store.getState().reorderEffect(-1, 0);
		await store.getState().reorderEffect(0, 5);
		expect((await repository.getHistory(project.id)).length).toBe(historyCount);
		expect(coordinator.calls).toHaveLength(0);
	});

	it('setEffectEnabled toggles enabled state, persists Enable/Disable label, tells coordinator, and skips no-op', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		coordinator.calls.length = 0;

		await store.getState().setEffectEnabled(inst.id, false);
		expect(store.getState().activeProject?.stack.instances[0].enabled).toBe(
			false,
		);
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].enabled,
		).toBe(false);
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Disable Pixel sort',
		);
		expect(coordinator.calls).toHaveLength(1);

		// No-op when already false
		coordinator.calls.length = 0;
		const historyCount = (await repository.getHistory(project.id)).length;
		await store.getState().setEffectEnabled(inst.id, false);
		expect(await repository.getHistory(project.id)).toHaveLength(historyCount);
		expect(coordinator.calls).toHaveLength(0);

		// Re-enable
		await store.getState().setEffectEnabled(inst.id, true);
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Enable Pixel sort',
		);
		expect(coordinator.calls).toHaveLength(1);
	});

	it('selectEffect updates selection without creating history and debounces persistence at 200 ms', async () => {
		const {store, repository, timerEnv, project} = await setupWithProject();
		const first = await store.getState().addEffect('pixelSort');
		await store.getState().addEffect('channelShift');
		const historyBefore = (await repository.getHistory(project.id)).length;

		store.getState().selectEffect(first.id);
		expect(store.getState().activeProject?.selectedInstanceId).toBe(first.id);

		timerEnv.advance(199);
		await flushMicrotasks();
		expect(
			(await repository.getProject(project.id))?.selectedInstanceId,
		).not.toBe(first.id);

		timerEnv.advance(1);
		await flushMicrotasks();
		expect((await repository.getProject(project.id))?.selectedInstanceId).toBe(
			first.id,
		);
		expect(await repository.getHistory(project.id)).toHaveLength(historyBefore);

		// Unknown id clears selection to null
		store.getState().selectEffect('nonexistent');
		expect(store.getState().activeProject?.selectedInstanceId).toBeNull();
	});

	it('setDebugView dispatches debug target to coordinator and rejects unknown instance ids', async () => {
		const {store, coordinator} = await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		coordinator.calls.length = 0;

		store.getState().setDebugView({instanceId: inst.id, view: 'selection'});
		expect(store.getState().debugView).toEqual({
			instanceId: inst.id,
			view: 'selection',
		});
		expect(coordinator.calls).toHaveLength(1);
		if (coordinator.calls[0].type === 'setStack') {
			expect(coordinator.calls[0].request.debug).toEqual({
				instanceId: inst.id,
				view: 'selection',
			});
		}

		store.getState().setDebugView({instanceId: 'unknown', view: 'selection'});
		expect(store.getState().debugView).toBeNull();
	});

	it('enforces the 32-instance limit on addEffect, duplicateEffect, and addPresetToStack without persisting', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();
		const ids = new Set<string>();
		for (let count = 0; count < 32; count++) {
			const inst = await store.getState().addEffect('pixelSort');
			ids.add(inst.id);
		}

		expect(ids.size).toBe(32);
		const firstId = store.getState().activeProject!.stack.instances[0].id;
		const historyBefore = (await repository.getHistory(project.id)).length;
		coordinator.calls.length = 0;

		await expect(store.getState().addEffect('pixelSort')).rejects.toThrow(
			StorageValidationError,
		);
		await expect(store.getState().duplicateEffect(firstId)).rejects.toThrow(
			StorageValidationError,
		);
		await expect(
			store.getState().addPresetToStack('builtin:bright-streaks'),
		).rejects.toThrow(StorageValidationError);

		expect(store.getState().activeProject?.stack.instances).toHaveLength(32);
		expect(await repository.getHistory(project.id)).toHaveLength(historyBefore);
		expect(coordinator.calls).toHaveLength(0);
	});

	it('dragParam and dragMix never notify appStore, never persist, and tell coordinator with dragging:true', async () => {
		const {store, transientStore, repository, coordinator, project} =
			await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		const historyBefore = (await repository.getHistory(project.id)).length;

		let notifications = 0;
		const unsub = store.subscribe(() => {
			notifications++;
		});
		coordinator.calls.length = 0;

		store.getState().dragParam(inst.id, 'angle', 30);
		store.getState().dragParam(inst.id, 'angle', 75);
		store.getState().dragMix(inst.id, 0.6);
		unsub();

		expect(notifications).toBe(0);
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(0);
		expect(store.getState().activeProject?.stack.instances[0].mix).toBe(1);
		expect(transientStore.getState().activeDrag).toEqual({
			instanceId: inst.id,
			params: {angle: 75},
			mix: 0.6,
		});
		expect(await repository.getHistory(project.id)).toHaveLength(historyBefore);
		expect(coordinator.calls).toHaveLength(3);
		for (const call of coordinator.calls) {
			expect(call.type).toBe('setStack');
			if (call.type === 'setStack') {
				expect(call.options).toEqual({dragging: true});
			}
		}

		const lastCall = coordinator.calls[2];
		expect(lastCall.type).toBe('setStack');
		if (lastCall.type !== 'setStack') {
			return;
		}

		expect(lastCall.request.stack.instances[0].params.angle).toBe(75);
		expect(lastCall.request.stack.instances[0].mix).toBe(0.6);
	});

	it('commitParam commits once on release, persists, and sends non-dragging stack; no-op release skips history and calls endDrag', async () => {
		const {store, transientStore, repository, coordinator, project} =
			await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		const historyBefore = (await repository.getHistory(project.id)).length;

		store.getState().dragParam(inst.id, 'angle', 90);
		coordinator.calls.length = 0;

		await store.getState().commitParam(inst.id, 'angle', 90);

		expect(transientStore.getState().activeDrag).toBeNull();
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(90);
		const historyAfter = await repository.getHistory(project.id);
		expect(historyAfter).toHaveLength(historyBefore + 1);
		expect(historyAfter.at(-1)?.label).toBe('Change Angle');
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].params
				.angle,
		).toBe(90);
		expect(coordinator.calls).toHaveLength(1);
		if (coordinator.calls[0].type === 'setStack') {
			expect(coordinator.calls[0].options).toBeUndefined();
			expect(coordinator.calls[0].request.stack.instances[0].params.angle).toBe(
				90,
			);
		}

		// Releasing with unchanged value commits nothing and calls endDrag
		coordinator.calls.length = 0;
		await store.getState().commitParam(inst.id, 'angle', 90);
		expect(await repository.getHistory(project.id)).toHaveLength(
			historyBefore + 1,
		);
		expect(coordinator.calls).toEqual([{type: 'endDrag'}]);
	});

	it('cancelDrag clears transient drag and restores the committed stack in coordinator without persisting', async () => {
		const {store, transientStore, repository, coordinator, project} =
			await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		const historyBefore = (await repository.getHistory(project.id)).length;

		store.getState().dragParam(inst.id, 'angle', 145);
		store.getState().dragSplitPosition(0.8);
		coordinator.calls.length = 0;

		store.getState().cancelDrag();

		expect(transientStore.getState().activeDrag).toBeNull();
		expect(transientStore.getState().splitPosition).toBeNull();
		expect(await repository.getHistory(project.id)).toHaveLength(historyBefore);
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

	it('nudgeParam does not commit at 499 ms after the last change and commits at 500 ms as one history entry', async () => {
		const {store, transientStore, repository, coordinator, timerEnv, project} =
			await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		const historyBefore = (await repository.getHistory(project.id)).length;
		coordinator.calls.length = 0;

		store.getState().nudgeParam(inst.id, 'angle', 10);
		timerEnv.advance(300);
		store.getState().nudgeParam(inst.id, 'angle', 20);
		timerEnv.advance(300);
		store.getState().nudgeParam(inst.id, 'angle', 30);

		// 499 ms after last nudge: still uncommitted
		timerEnv.advance(499);
		await flushMicrotasks();
		expect(await repository.getHistory(project.id)).toHaveLength(historyBefore);
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(0);
		expect(transientStore.getState().activeDrag?.params.angle).toBe(30);

		// At exactly 500 ms: committed once
		coordinator.calls.length = 0;
		timerEnv.advance(1);
		await flushMicrotasks();
		const historyAfter = await repository.getHistory(project.id);
		expect(historyAfter).toHaveLength(historyBefore + 1);
		expect(historyAfter.at(-1)?.label).toBe('Change Angle');
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(30);
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].params
				.angle,
		).toBe(30);
		expect(transientStore.getState().activeDrag).toBeNull();
		expect(coordinator.calls).toHaveLength(1);
		expect(coordinator.calls[0].type).toBe('setStack');
		if (coordinator.calls[0].type !== 'setStack') {
			return;
		}

		expect(coordinator.calls[0].options).toBeUndefined();
		expect(coordinator.calls[0].request.stack.instances[0].params.angle).toBe(
			30,
		);
	});

	it('nudgeMix does not commit at 499 ms and commits at 500 ms', async () => {
		const {store, repository, timerEnv, project} = await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');
		const historyBefore = (await repository.getHistory(project.id)).length;

		store.getState().nudgeMix(inst.id, 0.7);
		timerEnv.advance(250);
		store.getState().nudgeMix(inst.id, 0.5);

		timerEnv.advance(499);
		await flushMicrotasks();
		expect(await repository.getHistory(project.id)).toHaveLength(historyBefore);

		timerEnv.advance(1);
		await flushMicrotasks();
		const historyAfter = await repository.getHistory(project.id);
		expect(historyAfter).toHaveLength(historyBefore + 1);
		expect(historyAfter.at(-1)?.label).toBe('Change Mix');
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].mix,
		).toBe(0.5);
	});

	it('commitMix, setBlend, resetParam, and resetInstance update state, persist with labels, and tell coordinator', async () => {
		const {store, repository, coordinator, project} = await setupWithProject();
		const inst = await store.getState().addEffect('pixelSort');

		coordinator.calls.length = 0;
		await store.getState().commitMix(inst.id, 0.42);
		expect(store.getState().activeProject?.stack.instances[0].mix).toBe(0.42);
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].mix,
		).toBe(0.42);
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Change Mix',
		);
		expect(coordinator.calls).toHaveLength(1);

		// No-op commitMix calls endDrag and skips history
		const countAfterMix = (await repository.getHistory(project.id)).length;
		coordinator.calls.length = 0;
		await store.getState().commitMix(inst.id, 0.42);
		expect(await repository.getHistory(project.id)).toHaveLength(countAfterMix);
		expect(coordinator.calls).toEqual([{type: 'endDrag'}]);

		coordinator.calls.length = 0;
		await store.getState().setBlend(inst.id, 'difference');
		expect(store.getState().activeProject?.stack.instances[0].blend).toBe(
			'difference',
		);
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].blend,
		).toBe('difference');
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Change Blend',
		);
		expect(coordinator.calls).toHaveLength(1);

		await store.getState().commitParam(inst.id, 'angle', 135);
		coordinator.calls.length = 0;
		await store.getState().resetParam(inst.id, 'angle');
		expect(
			store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(0);
		expect(
			(await repository.getProject(project.id))?.stack.instances[0].params
				.angle,
		).toBe(0);
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Reset Angle',
		);
		expect(coordinator.calls).toHaveLength(1);

		coordinator.calls.length = 0;
		await store.getState().resetInstance(inst.id);
		const reset = store.getState().activeProject?.stack.instances[0];
		expect(reset?.mix).toBe(1);
		expect(reset?.blend).toBe('normal');
		const persistedReset = (await repository.getProject(project.id))?.stack
			.instances[0];
		expect(persistedReset?.mix).toBe(1);
		expect(persistedReset?.blend).toBe('normal');
		expect((await repository.getHistory(project.id)).at(-1)?.label).toBe(
			'Reset Pixel sort',
		);
		expect(coordinator.calls).toHaveLength(1);
	});
});
