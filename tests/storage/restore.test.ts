import {describe, expect, it} from 'vite-plus/test';
import {createRegistry} from '../../src/engine/registry.ts';
import type {EffectDefinition} from '../../src/engine/types.ts';
import {MISSING_PROJECT_NOTICE} from '../../src/state/app-store.ts';
import {DEV_GALLERY_HASH} from '../../src/state/router.ts';
import {MemoryStorageAdapter} from '../../src/storage/memory-adapter.ts';
import {restoreStartup} from '../../src/storage/restore.ts';
import {
	StorageVersionError,
	type ThemePreference,
} from '../../src/storage/types.ts';
import {
	createFakeCoordinator,
	createFakeRouterEnv,
	createFakeTimerEnv,
	makeTestBlob,
} from '../state/fixtures.ts';

describe('startup restore sequence (persistence.md section 9)', () => {
	it('step 1: stops on insecure context without opening storage', async () => {
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
	});

	it('step 2: stops on VersionError without deleting or downgrading the database', async () => {
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
		}
	});

	it('step 2: falls back to MemoryStorageAdapter with storageUnavailable=true when IndexedDB fails', async () => {
		const coordinator = createFakeCoordinator();
		const routerEnv = createFakeRouterEnv('');
		const result = await restoreStartup({
			coordinator,
			routerEnv,
			isSecureContext: true,
			async openStorageFn() {
				return {
					repository: new MemoryStorageAdapter(),
					persistence: 'memory',
					storageUnavailable: true,
					error: new Error('IndexedDB blocked'),
				};
			},
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
		result.bundle.dispose();
	});

	it('steps 3-7: restores active project, stack, history, viewScale, mirrors theme, and runs housekeeping', async () => {
		const timerEnv = createFakeTimerEnv();
		const repository = new MemoryStorageAdapter({now: () => timerEnv.now()});
		const created = await repository.createProject({
			name: 'restored.png',
			blob: makeTestBlob('restored', 256),
			width: 1200,
			height: 900,
		});
		await repository.updateViewState(created.project.id, {
			fitMode: 'custom',
			zoom: 2,
			centerX: 400,
			centerY: 300,
			splitPosition: 0.35,
		});
		await repository.updateAppState({theme: 'dark', compareMode: 'split'});

		// Also create and delete another project to verify orphaned cleanup runs
		let cleanupCalled = false;
		const origCleanup = repository.cleanupOrphanedSources.bind(repository);
		repository.cleanupOrphanedSources = async () => {
			cleanupCalled = true;
			return origCleanup();
		};

		const mirroredThemes: ThemePreference[] = [];
		const coordinator = createFakeCoordinator();
		const routerEnv = createFakeRouterEnv('');
		timerEnv.setDevicePixelRatio(2);

		const result = await restoreStartup({
			coordinator,
			routerEnv,
			timerEnv,
			isSecureContext: true,
			async openStorageFn() {
				return {
					repository,
					persistence: 'indexeddb',
					storageUnavailable: false,
				};
			},
			storageManager: {
				async estimate() {
					return {usage: 10_000_000, quota: 100_000_000};
				},
				async persisted() {
					return true;
				},
			},
			readLocalTheme: () => null,
			mirrorTheme(theme) {
				mirroredThemes.push(theme);
			},
			scheduleIdle: (cb) => cb(),
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		await result.hydrationPromise;
		await result.housekeepingPromise;

		const state = result.bundle.store.getState();
		expect(mirroredThemes).toEqual(['dark']);
		expect(state.theme).toBe('dark');
		expect(state.compareMode).toBe('split');
		expect(state.route).toEqual({
			screen: 'editor',
			projectId: created.project.id,
		});
		expect(routerEnv.getHash()).toBe(`#/p/${created.project.id}`);
		expect(state.activeProject?.viewState.zoom).toBe(2);
		expect(state.history).toHaveLength(1);
		expect(state.storage.persisted).toBe(true);
		expect(state.storage.estimate.usage).toBe(10_000_000);
		expect(cleanupCalled).toBe(true);

		expect(coordinator.calls.some((c) => c.type === 'setSource')).toBe(true);
		expect(coordinator.calls.some((c) => c.type === 'setStack')).toBe(true);
		expect(coordinator.calls).toContainEqual({
			type: 'setViewScale',
			scale: 4,
		});

		result.bundle.dispose();
	});

	it('step 4: missing project in hash returns to library, clears activeProjectId, and queues notice', async () => {
		const repository = new MemoryStorageAdapter();
		await repository.updateAppState({activeProjectId: 'deleted-id'});

		const coordinator = createFakeCoordinator();
		const routerEnv = createFakeRouterEnv('#/p/deleted-id');
		const result = await restoreStartup({
			coordinator,
			routerEnv,
			isSecureContext: true,
			async openStorageFn() {
				return {
					repository,
					persistence: 'indexeddb',
					storageUnavailable: false,
				};
			},
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
		await Promise.resolve();
		expect((await repository.getAppState()).activeProjectId).toBeNull();
		result.bundle.dispose();
	});

	it('step 4: preserves dev gallery route and opens library when activeProjectId is null', async () => {
		const repository = new MemoryStorageAdapter();
		await repository.createProject({
			name: 'lib.png',
			blob: makeTestBlob('lib'),
			width: 100,
			height: 100,
			setActive: false,
		});

		const galleryRouter = createFakeRouterEnv(DEV_GALLERY_HASH);
		const galleryResult = await restoreStartup({
			coordinator: createFakeCoordinator(),
			routerEnv: galleryRouter,
			isSecureContext: true,
			async openStorageFn() {
				return {
					repository,
					persistence: 'indexeddb',
					storageUnavailable: false,
				};
			},
			scheduleIdle: (cb) => cb(),
		});
		expect(galleryResult.status).toBe('ready');
		if (galleryResult.status === 'ready') {
			expect(galleryResult.route).toEqual({screen: 'gallery'});
			expect(galleryRouter.getHash()).toBe(DEV_GALLERY_HASH);
			galleryResult.bundle.dispose();
		}

		const libRouter = createFakeRouterEnv('#/');
		const libResult = await restoreStartup({
			coordinator: createFakeCoordinator(),
			routerEnv: libRouter,
			isSecureContext: true,
			async openStorageFn() {
				return {
					repository,
					persistence: 'indexeddb',
					storageUnavailable: false,
				};
			},
			scheduleIdle: (cb) => cb(),
		});
		expect(libResult.status).toBe('ready');
		if (libResult.status !== 'ready') {
			return;
		}

		expect(libResult.route).toEqual({screen: 'library'});
		expect(libResult.bundle.store.getState().activeProjectId).toBeNull();
		libResult.bundle.dispose();
	});

	it('step 6: migrates outdated EffectInstance versions in memory without creating a synthetic undo entry', async () => {
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
		const result = await restoreStartup({
			coordinator: createFakeCoordinator(),
			registry,
			routerEnv: createFakeRouterEnv(''),
			isSecureContext: true,
			async openStorageFn() {
				return {
					repository,
					persistence: 'indexeddb',
					storageUnavailable: false,
				};
			},
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

		result.bundle.dispose();
	});
});
