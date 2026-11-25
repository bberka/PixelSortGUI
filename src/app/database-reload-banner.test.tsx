// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore} from '../../tests/state/fixtures.ts';
import {AppRuntimeProvider} from './runtime-context.tsx';
import {DatabaseReloadBanner} from './storage-banner.tsx';
import type {AppRuntime} from '@/state/index.ts';
import {MemoryStorageAdapter} from '@/storage/memory-adapter.ts';
import {restoreStartup} from '@/storage/restore.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function stubRuntime(): AppRuntime {
	return {
		ready: Promise.resolve({status: 'insecure-context'}),
		result: null,
		dispose() {},
	};
}

afterEach(() => {
	if (root) {
		act(() => {
			root!.unmount();
		});
		root = undefined;
	}

	container?.remove();
	container = undefined;
});

describe('DatabaseReloadBanner', () => {
	it('stays hidden until markDatabaseClosedByUpgrade is called, then shows a reload prompt', () => {
		const context = createTestStore();
		const onReload = vi.fn();

		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
		act(() => {
			root!.render(
				<AppRuntimeProvider
					value={{runtime: stubRuntime(), bundle: context.bundle}}
				>
					<DatabaseReloadBanner onReload={onReload} />
				</AppRuntimeProvider>,
			);
		});

		expect(container.querySelector('[role="alert"]')).toBeNull();

		act(() => {
			context.store.getState().markDatabaseClosedByUpgrade();
		});

		const alert = container.querySelector('[role="alert"]');
		expect(alert).not.toBeNull();
		expect(alert?.textContent).toContain(
			'Storage was updated in another tab. Reload to continue saving changes.',
		);

		const reloadButton = alert?.querySelector('button');
		expect(reloadButton?.textContent).toBe('Reload');
		act(() => {
			reloadButton?.click();
		});
		expect(onReload).toHaveBeenCalledTimes(1);
	});

	it('marks the store when openStorage invokes onVersionChange during restoreStartup', async () => {
		const context = createTestStore();
		let triggerVersionChange:
			((event: IDBVersionChangeEvent) => void) | undefined;

		const result = await restoreStartup({
			coordinator: context.coordinator,
			isSecureContext: true,
			async openStorageFn(options) {
				triggerVersionChange = options?.onVersionChange;
				return {
					repository: new MemoryStorageAdapter(),
					persistence: 'indexeddb',
					storageUnavailable: false,
				};
			},
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}

		expect(result.bundle.store.getState().storage.databaseClosedByUpgrade).toBe(
			false,
		);
		expect(triggerVersionChange).toBeDefined();

		triggerVersionChange?.({} as IDBVersionChangeEvent);

		expect(result.bundle.store.getState().storage.databaseClosedByUpgrade).toBe(
			true,
		);
		result.bundle.dispose();
	});
});
