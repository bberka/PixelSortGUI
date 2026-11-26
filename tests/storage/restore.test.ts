import {describe, expect, it} from 'vite-plus/test';
import {createRegistry} from '../../src/engine/registry.ts';
import type {EffectDefinition} from '../../src/engine/types.ts';
import {MISSING_PROJECT_NOTICE} from '../../src/state/app-store.ts';
import {DEV_GALLERY_HASH} from '../../src/state/router.ts';
import {MemoryStorageAdapter} from '../../src/storage/memory-adapter.ts';
import {restoreStartup} from '../../src/storage/restore.ts';
import {
	StorageVersionError,
	type StorageRepository,
	type ThemePreference,
} from '../../src/storage/types.ts';
import {
	createFakeCoordinator,
	createFakeRouterEnv,
	createFakeTimerEnv,
	makeTestBlob,
} from '../state/fixtures.ts';

function withRepo(repository: StorageRepository) {
	return async () => ({
		repository,
		persistence: 'indexeddb' as const,
		storageUnavailable: false as const,
	});
}

describe('startup restore sequence (persistence.md section 9)', () => {
	it('step 1: stops on insecure context without opening storage or touching coordinator', async () => {
		let openCalled = false;
		const coordinator = createFakeCoordinator();
		const result = await restoreStartup({
			coordinator,
			isSecureContext: false,
			async openStorageFn() {
				openCalled = true;
				return {
					repository: new MemoryStorageAdapter(),
					persistence: 'memory',
					storageUnavailable: true,
					error: new Error('should not run'),
				};
			},
		});

		expect(result.status).toBe('insecure-context');
		expect(openCalled).toBe(false);
		expect(coordinator.calls).toHaveLength(0);
	});

	it('step 2: stops on StorageVersionError with expectedVersion and message without creating a store', async () => {
		const coordinator = createFakeCoordinator();
		const result = await restoreStartup({
			coordinator,
			isSecureContext: true,
			async openStorageFn() {
				throw new StorageVersionError(1);
			},
		});

		expect(result.status).toBe('version-error');
		if (result.status === 'version-error') {
			expect(result.expectedVersion).toBe(1);
			expect(result.message).toContain('newer');
		}

		expect(coordinator.calls).toHaveLength(0);
	});

	it('step 2: falls back to MemoryStorageAdapter with storageUnavailable=true when default openStorage fails', async () => {
		const coordinator = createFakeCoordinator();
		const routerEnv = createFakeRouterEnv('');
		const brokenFactory = {
			open() {
				throw new Error('IndexedDB disabled by policy');
			},
		} as unknown as IDBFactory;

		const result = await restoreStartup({
			coordinator,
			routerEnv,
			isSecureContext: true,
			storageOptions: {indexedDB: brokenFactory},
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		expect(result.storageUnavailable).toBe(true);
		expect(result.bundle.store.getState().storage.storageUnavailable).toBe(
			true,
		);
		expect(result.route).toEqual({screen: 'library'});
		expect(coordinator.calls).toHaveLength(0);
		result.bundle.dispose();
	});

	it('step 3: mirrors appState.theme when localStorage lacks drift:theme, and skips mirroring when already set', async () => {
		const repository = new MemoryStorageAdapter();
		await repository.updateAppState({theme: 'light'});

		const mirroredWhenNull: ThemePreference[] = [];
		const first = await restoreStartup({
			coordinator: createFakeCoordinator(),
			routerEnv: createFakeRouterEnv(''),
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			readLocalTheme: () => null,
			mirrorTheme(theme) {
				mirroredWhenNull.push(theme);
			},
			scheduleIdle: (cb) => cb(),
		});
		expect(first.status).toBe('ready');
		expect(mirroredWhenNull).toEqual(['light']);
		if (first.status === 'ready') {
			first.bundle.dispose();
		}

		const mirroredWhenPresent: ThemePreference[] = [];
		const second = await restoreStartup({
			coordinator: createFakeCoordinator(),
			routerEnv: createFakeRouterEnv(''),
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			readLocalTheme: () => 'light',
			mirrorTheme(theme) {
				mirroredWhenPresent.push(theme);
			},
			scheduleIdle: (cb) => cb(),
		});
		expect(second.status).toBe('ready');
		expect(mirroredWhenPresent).toEqual([]);
		if (second.status === 'ready') {
			second.bundle.dispose();
		}
	});

	it('step 4: resolves #/dev/gallery without replacing hash or hydrating an active project', async () => {
		const repository = new MemoryStorageAdapter();
		await repository.createProject({
			name: 'active.png',
			blob: makeTestBlob('active'),
			width: 100,
			height: 100,
			setActive: true,
		});

		const coordinator = createFakeCoordinator();
		const routerEnv = createFakeRouterEnv(DEV_GALLERY_HASH);
		const result = await restoreStartup({
			coordinator,
			routerEnv,
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		await result.hydrationPromise;
		expect(result.route).toEqual({screen: 'gallery'});
		expect(routerEnv.getHash()).toBe(DEV_GALLERY_HASH);
		expect(result.bundle.store.getState().activeProjectId).toBeNull();
		expect(coordinator.calls).toHaveLength(0);
		result.bundle.dispose();
	});

	it('step 4: opens editor directly when #/p/<id> matches a stored project', async () => {
		const repository = new MemoryStorageAdapter();
		const created = await repository.createProject({
			name: 'direct.png',
			blob: makeTestBlob('direct'),
			width: 200,
			height: 150,
			setActive: false,
		});

		const coordinator = createFakeCoordinator();
		const routerEnv = createFakeRouterEnv(`#/p/${created.project.id}`);
		const result = await restoreStartup({
			coordinator,
			routerEnv,
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		await result.hydrationPromise;
		expect(result.route).toEqual({
			screen: 'editor',
			projectId: created.project.id,
		});
		expect(result.notice).toBeNull();
		expect(result.bundle.store.getState().activeProjectId).toBe(
			created.project.id,
		);
		expect(coordinator.calls.map((c) => c.type)).toEqual([
			'setSource',
			'setStack',
		]);
		result.bundle.dispose();
	});

	it('step 4: missing #/p/<id> routes to library, replaces hash, sets notice, and clears matching activeProjectId', async () => {
		const repository = new MemoryStorageAdapter();
		await repository.updateAppState({activeProjectId: 'deleted-id'});

		const coordinator = createFakeCoordinator();
		const routerEnv = createFakeRouterEnv('#/p/deleted-id');
		const result = await restoreStartup({
			coordinator,
			routerEnv,
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		expect(result.route).toEqual({screen: 'library'});
		expect(result.notice).toBe(MISSING_PROJECT_NOTICE);
		expect(routerEnv.getHash()).toBe('#/');
		expect(result.bundle.store.getState().notice).toBe(MISSING_PROJECT_NOTICE);
		expect(coordinator.calls).toHaveLength(0);
		await Promise.resolve();
		expect((await repository.getAppState()).activeProjectId).toBeNull();
		result.bundle.dispose();
	});

	it('step 4: missing #/p/<id> leaves an unrelated activeProjectId intact in storage', async () => {
		const repository = new MemoryStorageAdapter();
		const existing = await repository.createProject({
			name: 'still-here.png',
			blob: makeTestBlob('still-here'),
			width: 100,
			height: 100,
			setActive: true,
		});

		const routerEnv = createFakeRouterEnv('#/p/other-missing-id');
		const result = await restoreStartup({
			coordinator: createFakeCoordinator(),
			routerEnv,
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		expect(result.route).toEqual({screen: 'library'});
		expect(result.notice).toBe(MISSING_PROJECT_NOTICE);
		await Promise.resolve();
		expect((await repository.getAppState()).activeProjectId).toBe(
			existing.project.id,
		);
		result.bundle.dispose();
	});

	it('step 4: empty hash with stale activeProjectId opens library and clears persisted activeProjectId', async () => {
		const repository = new MemoryStorageAdapter();
		await repository.updateAppState({activeProjectId: 'ghost-project'});

		const result = await restoreStartup({
			coordinator: createFakeCoordinator(),
			routerEnv: createFakeRouterEnv(''),
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		expect(result.route).toEqual({screen: 'library'});
		expect(result.notice).toBeNull();
		await Promise.resolve();
		expect((await repository.getAppState()).activeProjectId).toBeNull();
		result.bundle.dispose();
	});

	it('step 4: #/ with activeProjectId null opens library with no coordinator calls', async () => {
		const repository = new MemoryStorageAdapter();
		await repository.createProject({
			name: 'lib.png',
			blob: makeTestBlob('lib'),
			width: 100,
			height: 100,
			setActive: false,
		});

		const coordinator = createFakeCoordinator();
		const result = await restoreStartup({
			coordinator,
			routerEnv: createFakeRouterEnv('#/'),
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		await result.hydrationPromise;
		expect(result.route).toEqual({screen: 'library'});
		expect(result.bundle.store.getState().activeProjectId).toBeNull();
		expect(result.bundle.store.getState().projects).toHaveLength(1);
		expect(coordinator.calls).toHaveLength(0);
		result.bundle.dispose();
	});

	it('steps 3-7: restores active project, thumbnail, history, viewScale (custom zoom * dpr), and runs idle housekeeping', async () => {
		const timerEnv = createFakeTimerEnv();
		const repository = new MemoryStorageAdapter({now: () => timerEnv.now()});
		const created = await repository.createProject({
			name: 'restored.png',
			blob: makeTestBlob('restored', 256),
			width: 1200,
			height: 900,
		});
		await repository.putThumbnail({
			projectId: created.project.id,
			blob: new Blob([new Uint8Array([1, 2, 3])], {type: 'image/webp'}),
			width: 512,
			height: 384,
			stackSignature: 'sig',
			updatedAt: timerEnv.now(),
		});
		await repository.updateViewState(created.project.id, {
			fitMode: 'custom',
			zoom: 2.5,
			centerX: 400,
			centerY: 300,
			splitPosition: 0.35,
		});
		await repository.updateAppState({theme: 'dark', compareMode: 'split'});

		let cleanupCalled = false;
		const origCleanup = repository.cleanupOrphanedSources.bind(repository);
		repository.cleanupOrphanedSources = async () => {
			cleanupCalled = true;
			return origCleanup();
		};

		const coordinator = createFakeCoordinator();
		const routerEnv = createFakeRouterEnv('');
		timerEnv.setDevicePixelRatio(2);

		const result = await restoreStartup({
			coordinator,
			routerEnv,
			timerEnv,
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			storageManager: {
				async estimate() {
					return {usage: 10_000_000, quota: 100_000_000};
				},
				async persisted() {
					return true;
				},
			},
			readLocalTheme: () => null,
			mirrorTheme() {},
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		await result.hydrationPromise;
		await result.housekeepingPromise;

		const state = result.bundle.store.getState();
		expect(state.theme).toBe('dark');
		expect(state.compareMode).toBe('split');
		expect(state.route).toEqual({
			screen: 'editor',
			projectId: created.project.id,
		});
		expect(routerEnv.getHash()).toBe(`#/p/${created.project.id}`);
		expect(state.activeProject?.viewState.zoom).toBe(2.5);
		expect(state.activeThumbnail?.width).toBe(512);
		expect(state.activeSource?.sha256).toBe(created.source.sha256);
		expect(state.history).toHaveLength(1);
		expect(state.storage.persisted).toBe(true);
		expect(state.storage.estimate.usage).toBe(10_000_000);
		expect(cleanupCalled).toBe(true);

		expect(coordinator.calls).toEqual([
			{
				type: 'setSource',
				source: {
					key: created.source.sha256,
					blob: created.source.blob,
					width: 1200,
					height: 900,
				},
			},
			{
				type: 'setStack',
				request: {stack: created.project.stack},
				options: undefined,
			},
			{
				type: 'setViewScale',
				scale: 5,
			},
		]);

		result.bundle.dispose();
	});

	it('step 6: migrates outdated EffectInstance versions in memory without creating a synthetic undo entry and sends migrated stack to coordinator', async () => {
		const v2Effect: EffectDefinition = {
			type: 'demo',
			version: 2,
			label: 'Demo',
			description: 'Demo effect',
			category: 'glitch',
			params: {
				strength: {
					kind: 'number',
					label: 'Strength',
					group: 'Main',
					min: 0,
					max: 1,
					step: 0.1,
					default: 0.5,
				},
			},
			migrations: {
				1: (old) => ({strength: Number(old.amount ?? 0.5)}),
			},
			render() {},
		};
		const registry = createRegistry([v2Effect]);

		const repository = new MemoryStorageAdapter();
		const created = await repository.createProject({
			name: 'migrate.png',
			blob: makeTestBlob('migrate'),
			width: 100,
			height: 100,
		});
		await repository.commitStack({
			projectId: created.project.id,
			selectedInstanceId: 'inst0001',
			label: 'Old v1 commit',
			stack: {
				schemaVersion: 1,
				instances: [
					{
						id: 'inst0001',
						type: 'demo',
						version: 1,
						enabled: true,
						params: {amount: 0.8},
						mix: 1,
						blend: 'normal',
					},
				],
			},
		});

		const historyBefore = await repository.getHistory(created.project.id);
		const coordinator = createFakeCoordinator();
		const result = await restoreStartup({
			coordinator,
			registry,
			routerEnv: createFakeRouterEnv(''),
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		await result.hydrationPromise;
		const state = result.bundle.store.getState();
		expect(state.stackNeedsWriteBack).toBe(true);
		expect(state.activeProject?.stack.instances[0].version).toBe(2);
		expect(state.activeProject?.stack.instances[0].params.strength).toBe(0.8);
		expect(await repository.getHistory(created.project.id)).toHaveLength(
			historyBefore.length,
		);

		const stackCall = coordinator.calls.find((c) => c.type === 'setStack');
		expect(stackCall?.type).toBe('setStack');
		if (stackCall?.type === 'setStack') {
			expect(stackCall.request.stack.instances[0].version).toBe(2);
			expect(stackCall.request.stack.instances[0].params.strength).toBe(0.8);
		}

		result.bundle.dispose();
	});

	it('step 6: aborts hydration without touching coordinator if user navigates away before hydration resolves', async () => {
		const repository = new MemoryStorageAdapter();
		await repository.createProject({
			name: 'race.png',
			blob: makeTestBlob('race'),
			width: 100,
			height: 100,
		});

		const {promise: sourceGate, resolve: releaseSource} =
			Promise.withResolvers<void>();
		const origGetSource = repository.getSource.bind(repository);
		repository.getSource = async (hash) => {
			await sourceGate;
			return origGetSource(hash);
		};

		const coordinator = createFakeCoordinator();
		const result = await restoreStartup({
			coordinator,
			routerEnv: createFakeRouterEnv(''),
			isSecureContext: true,
			openStorageFn: withRepo(repository),
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		await result.bundle.store.getState().closeProject();
		coordinator.calls.length = 0;

		releaseSource();
		await result.hydrationPromise;
		expect(coordinator.calls).toHaveLength(0);
		expect(result.bundle.store.getState().activeProjectId).toBeNull();
		result.bundle.dispose();
	});
});
