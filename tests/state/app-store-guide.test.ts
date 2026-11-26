import {describe, expect, it} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from './fixtures.ts';

describe('guide route and welcome card (F27)', () => {
	it('keeps the open project while the guide is shown', async () => {
		const harness = createTestStore();
		const {store, routerEnv} = harness;
		await store.getState().importImage({
			name: 'photo.png',
			blob: makeTestBlob('photo'),
			width: 100,
			height: 80,
		});
		const id = store.getState().activeProjectId;

		routerEnv.setHash('#/guide');
		await store.getState().syncFromHash();

		expect(store.getState().route).toEqual({screen: 'guide'});
		expect(store.getState().activeProjectId).toBe(id);
	});

	it('stores the dismissed welcome card', async () => {
		const {store, repository} = createTestStore();
		expect(store.getState().welcomeDismissed).toBe(false);

		await store.getState().dismissWelcome();

		expect(store.getState().welcomeDismissed).toBe(true);
		const appState = await repository.getAppState();
		expect(appState.welcomeDismissed).toBe(true);
	});

	it('dismisses the welcome card on the first import', async () => {
		const {store, repository} = createTestStore();

		await store.getState().importImage({
			name: 'photo.png',
			blob: makeTestBlob('photo'),
			width: 100,
			height: 80,
		});

		expect(store.getState().welcomeDismissed).toBe(true);
		const appState = await repository.getAppState();
		expect(appState.welcomeDismissed).toBe(true);
	});
});
