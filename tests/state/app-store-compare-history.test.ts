import {describe, expect, it} from 'vite-plus/test';
import {IDENTITY_TRANSFORM} from '../../src/engine/transform.ts';
import {selectCompareHistoryEntry} from '../../src/state/app-store.ts';
import {CLOSED_GEOMETRY} from '../../src/state/geometry.ts';
import {
	selectEditingSide,
	selectSplitChosen,
} from '../../src/state/split-sides.ts';
import {createTestStore, makeTestBlob} from './fixtures.ts';

async function seedProjectWithSteps() {
	const context = createTestStore();
	const {store} = context;
	const {project} = await store.getState().importImage({
		name: 'photo.png',
		blob: makeTestBlob('photo'),
		width: 400,
		height: 300,
	});
	const effect = await store.getState().addEffect('pixelSort');
	await store.getState().commitParam(effect.id, 'angle', 45, 'Angle 45°');
	await store.getState().commitParam(effect.id, 'angle', 90, 'Angle 90°');
	return {...context, project, effect};
}

describe('app store — compare against any history step (F31)', () => {
	it('pins a history step non-destructively without mutating history, head, stacks, or stored compareMode', async () => {
		const {store, repository, sideCoordinators} = await seedProjectWithSteps();
		const before = store.getState().activeProject!;
		const historyBefore = store.getState().history.map((entry) => entry.seq);

		expect(store.getState().compareMode).toBe('toggle');
		expect(sideCoordinators).toHaveLength(0);

		// Pin step #2 ("Angle 45°") while head is step #3 ("Angle 90°").
		store.getState().setCompareHistorySeq(2);

		const pinned = store.getState();
		expect(pinned.compareHistorySeq).toBe(2);
		expect(selectCompareHistoryEntry(pinned)?.label).toBe('Angle 45°');
		expect(pinned.compareMode).toBe('split');
		expect(pinned.activeProject?.historyHeadSeq).toBe(before.historyHeadSeq);
		expect(pinned.activeProject?.historyMaxSeq).toBe(before.historyMaxSeq);
		expect(pinned.activeProject?.stack).toEqual(before.stack);
		expect(pinned.activeProject?.stackA).toEqual(before.stackA);
		expect(pinned.history.map((entry) => entry.seq)).toEqual(historyBefore);
		// Persisted appState compareMode was not mutated.
		expect((await repository.getAppState()).compareMode).toBe('toggle');

		// Side coordinator received the pinned step's stack (angle 45), not current (angle 90).
		expect(sideCoordinators).toHaveLength(1);
		const stackCalls = sideCoordinators[0].calls.filter(
			(call) => call.type === 'setStack',
		);
		expect(stackCalls).toHaveLength(1);
		expect(stackCalls[0].request.stack.instances[0]?.params.angle).toBe(45);

		// Clearing restores prior compareMode ('toggle') and disposes the side worker.
		store.getState().clearCompareHistory();
		expect(store.getState().compareHistorySeq).toBeNull();
		expect(store.getState().compareMode).toBe('toggle');
		expect(
			sideCoordinators[0].calls.some((call) => call.type === 'dispose'),
		).toBe(true);
	});

	it('keeps split mode on exit when split mode was already active before pinning', async () => {
		const {store, sideCoordinators} = await seedProjectWithSteps();
		await store.getState().setCompareMode('split');
		await store.getState().setEditSide('a');
		await store.getState().addEffect('channelShift');
		expect(sideCoordinators).toHaveLength(1);

		// While pinned, editing side falls back to side B (main stack).
		store.getState().setCompareHistorySeq(2);
		expect(selectEditingSide(store.getState())).toBe('b');

		store.getState().clearCompareHistory();
		expect(store.getState().compareHistorySeq).toBeNull();
		expect(store.getState().compareMode).toBe('split');
		expect(selectEditingSide(store.getState())).toBe('a');
	});

	it('renders a pinned entry with a different transform even when its stack is empty', async () => {
		const {store, project, sideCoordinators} = await seedProjectWithSteps();
		// Rotate current project 90° clockwise (seq 4).
		await store.getState().setTransform(project.id, {
			...IDENTITY_TRANSFORM,
			rotation: 90,
		});
		expect(sideCoordinators).toHaveLength(0);

		// Pin seq 0 ("Initial": empty stack, identity transform != current 90° transform).
		store.getState().setCompareHistorySeq(0);
		expect(sideCoordinators).toHaveLength(1);
		const sourceCall = sideCoordinators[0].calls.find(
			(call) => call.type === 'setSource',
		);
		expect(
			sourceCall?.type === 'setSource' && sourceCall.source?.transform,
		).toEqual(IDENTITY_TRANSFORM);
	});

	it('spawns no side coordinator when pinning an empty step with the same transform', async () => {
		const {store, sideCoordinators} = await seedProjectWithSteps();
		store.getState().setCompareHistorySeq(0);
		expect(store.getState().compareHistorySeq).toBe(0);
		expect(sideCoordinators).toHaveLength(0);
	});

	it('clears cleanly on project switch, close, crop mode, undo, redo, jump, and trimmed redo branch', async () => {
		const {store, transientStore, project, effect} =
			await seedProjectWithSteps();

		// 1. Entering crop mode clears compareHistorySeq.
		store.getState().setCompareHistorySeq(2);
		expect(store.getState().compareHistorySeq).toBe(2);
		transientStore.setState({
			geometry: {...CLOSED_GEOMETRY, open: true, cropping: true},
		});
		expect(store.getState().compareHistorySeq).toBeNull();
		transientStore.setState({geometry: CLOSED_GEOMETRY});

		// 2. Undo clears compareHistorySeq.
		store.getState().setCompareHistorySeq(1);
		expect(store.getState().compareHistorySeq).toBe(1);
		await store.getState().undo();
		expect(store.getState().compareHistorySeq).toBeNull();
		expect(store.getState().compareMode).toBe('toggle');

		// Redo clears compareHistorySeq.
		store.getState().setCompareHistorySeq(1);
		expect(await store.getState().redo()).toBe(true);
		expect(store.getState().compareHistorySeq).toBeNull();
		expect(store.getState().compareMode).toBe('toggle');

		// A history jump clears compareHistorySeq.
		store.getState().setCompareHistorySeq(1);
		expect(await store.getState().jumpToHistory(project.id, 2)).toBe(true);
		expect(store.getState().compareHistorySeq).toBeNull();
		expect(store.getState().compareMode).toBe('toggle');

		// 3. Pinning a redo-branch step (seq 3) and making a new commit trims seq 3 and clears pin.
		store.getState().setCompareHistorySeq(3);
		expect(store.getState().compareHistorySeq).toBe(3);
		await store.getState().commitParam(effect.id, 'angle', 120, 'Angle 120°');
		expect(store.getState().compareHistorySeq).toBeNull();
		expect(store.getState().compareMode).toBe('toggle');

		// 4. Switching to another project clears compareHistorySeq.
		store.getState().setCompareHistorySeq(1);
		const second = await store.getState().importImage({
			name: 'second.png',
			blob: makeTestBlob('second'),
			width: 200,
			height: 200,
			setActive: false,
		});
		await store.getState().openProject(second.project.id);
		expect(store.getState().compareHistorySeq).toBeNull();

		// 5. Closing active project clears compareHistorySeq.
		await store.getState().openProject(project.id);
		store.getState().setCompareHistorySeq(1);
		expect(store.getState().compareHistorySeq).toBe(1);
		await store.getState().closeProject();
		expect(store.getState().compareHistorySeq).toBeNull();
	});

	it('clears the pin and restores the compare mode when opening a missing project', async () => {
		const {store, transientStore} = await seedProjectWithSteps();
		store.getState().setCompareHistorySeq(1);
		transientStore.setState({compareLatched: true});

		expect(await store.getState().openProject('nonexistent')).toBeNull();

		expect(store.getState().compareHistorySeq).toBeNull();
		expect(store.getState().compareMode).toBe('toggle');
		expect(transientStore.getState().compareLatched).toBe(false);
	});

	it('saves a plain label for an edit made while pinned from toggle compare', async () => {
		const {store, effect} = await seedProjectWithSteps();
		store.getState().setCompareHistorySeq(1);
		expect(selectSplitChosen(store.getState())).toBe(false);

		await store.getState().commitParam(effect.id, 'angle', 120, 'Angle 120°');
		await store.getState().addEffect('channelShift');

		const labels = store.getState().history.map((entry) => entry.label);
		expect(labels).toContain('Angle 120°');
		expect(labels.filter((label) => label.includes('(side'))).toEqual([]);
	});

	it('keeps the side in the label for an edit made while pinned in the split view', async () => {
		const {store} = await seedProjectWithSteps();
		await store.getState().setCompareMode('split');
		store.getState().setCompareHistorySeq(1);
		expect(selectSplitChosen(store.getState())).toBe(true);

		await store.getState().addEffect('channelShift');

		expect(store.getState().history.at(-1)?.label).toMatch(/\(side B\)$/);
	});

	it('renders a pinned entry with a corrupt stored transform as untransformed', async () => {
		const {store, sideCoordinators} = await seedProjectWithSteps();
		store.setState((state) => ({
			history: state.history.map((entry) =>
				entry.seq === 2
					? {...entry, transform: {...entry.transform, rotation: 45 as never}}
					: entry,
			),
		}));

		store.getState().setCompareHistorySeq(2);

		const sourceCall = sideCoordinators[0].calls.find(
			(call) => call.type === 'setSource',
		);
		expect(
			sourceCall?.type === 'setSource' && sourceCall.source?.transform,
		).toEqual(IDENTITY_TRANSFORM);
	});

	it('ignores invalid seq values and refuses to pin while cropping', async () => {
		const {store, transientStore} = await seedProjectWithSteps();
		store.getState().setCompareHistorySeq(999);
		expect(store.getState().compareHistorySeq).toBeNull();

		transientStore.setState({
			geometry: {...CLOSED_GEOMETRY, open: true, cropping: true},
		});
		store.getState().setCompareHistorySeq(1);
		expect(store.getState().compareHistorySeq).toBeNull();
	});
});
