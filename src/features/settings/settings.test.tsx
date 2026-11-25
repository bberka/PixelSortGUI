// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore} from '../../../tests/state/fixtures.ts';
import {SettingsButton} from './settings-button.tsx';
import {
	APP_LICENSE_TEXT,
	THIRD_PARTY_NOTICES,
} from './third-party-notices.generated.ts';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {AppRuntime} from '@/state/index.ts';
import type {StorageManagerLike} from '@/storage/quota.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type TestContext = ReturnType<typeof createTestStore>;

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function stubRuntime(): AppRuntime {
	return {
		ready: Promise.resolve({status: 'insecure-context'}),
		result: null,
		dispose() {},
	};
}

function mountSettings(
	context: TestContext,
	storageManager?: StorageManagerLike,
) {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			<TooltipProvider>
				<AppRuntimeProvider
					value={{runtime: stubRuntime(), bundle: context.bundle}}
				>
					<SettingsButton storageManager={storageManager} />
				</AppRuntimeProvider>
			</TooltipProvider>,
		);
	});
	return container;
}

async function flush(turns = 8): Promise<void> {
	for (let index = 0; index < turns; index++) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

function openSettingsDialog(): void {
	const trigger = document.querySelector<HTMLButtonElement>(
		'button[aria-label="Settings"]',
	);
	if (!trigger) {
		throw new Error('Settings button not found');
	}

	act(() => {
		trigger.click();
	});
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

describe('Settings view', () => {
	it('switches theme via the store when selecting System, Light, and True Black', async () => {
		const context = createTestStore();
		const storageManager: StorageManagerLike = {
			estimate: async () => ({usage: 42_000_000, quota: 512_000_000}),
			persisted: async () => false,
		};
		mountSettings(context, storageManager);
		openSettingsDialog();
		await flush();

		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog).not.toBeNull();

		const lightButton = [...dialog!.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('Light'),
		);
		const darkButton = [...dialog!.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('True Black'),
		);
		expect(lightButton).toBeDefined();
		expect(darkButton).toBeDefined();

		act(() => {
			lightButton!.click();
		});
		await flush();
		expect(context.store.getState().theme).toBe('light');

		act(() => {
			darkButton!.click();
		});
		await flush();
		expect(context.store.getState().theme).toBe('dark');
	});

	it('refreshes storage usage and persistence status when opened', async () => {
		const context = createTestStore();
		const estimate = vi.fn(async () => ({
			usage: 1_240_000_000,
			quota: 24_500_000_000,
		}));
		const persisted = vi.fn(async () => false);
		mountSettings(context, {estimate, persisted});

		expect(estimate).not.toHaveBeenCalled();

		openSettingsDialog();
		await flush();

		expect(estimate).toHaveBeenCalledTimes(1);
		expect(persisted).toHaveBeenCalledTimes(1);

		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain('Using 1.2 GB of 24.5 GB');
		expect(dialog?.textContent).toContain(
			'Storage protection: Best-effort (browser may clear data when space is low)',
		);
		expect(dialog?.textContent).toContain(
			'Private Browsing windows clear all stored data when closed.',
		);
	});

	it('shows fallback usage text and unavailable note when storage is unavailable', async () => {
		const context = createTestStore();
		context.store.getState().hydrateFromRestore({
			projects: [],
			presets: [],
			theme: 'system',
			compareMode: 'toggle',
			storageUnavailable: true,
			route: {screen: 'library'},
			notice: null,
			activeProject: null,
		});

		mountSettings(context, {});
		openSettingsDialog();
		await flush();

		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain('Storage usage unavailable');
		expect(dialog?.textContent).toContain(
			'Storage unavailable: nothing will be saved after you close this tab.',
		);

		const requestButton = [...dialog!.querySelectorAll('button')].find(
			(button) => button.textContent?.includes('Request protection'),
		);
		expect(requestButton?.disabled).toBe(true);
	});

	it('does not block while persist() is pending and updates when it settles', async () => {
		const context = createTestStore();
		const deferred = Promise.withResolvers<boolean>();
		let isPersisted = false;

		const storageManager: StorageManagerLike = {
			estimate: async () => ({usage: 42_000_000, quota: 512_000_000}),
			persisted: async () => isPersisted,
			persist: async () => deferred.promise,
		};

		mountSettings(context, storageManager);
		openSettingsDialog();
		await flush();

		const dialog = document.querySelector('[role="dialog"]')!;
		const requestButton = [...dialog.querySelectorAll('button')].find(
			(button) => button.textContent?.includes('Request protection'),
		)!;

		act(() => {
			requestButton.click();
		});
		await flush();

		expect(requestButton.disabled).toBe(true);
		expect(requestButton.getAttribute('aria-busy')).toBe('true');
		expect(requestButton.textContent).toContain('Requesting protection...');

		const lightButton = [...dialog.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('Light'),
		)!;
		act(() => {
			lightButton.click();
		});
		await flush();
		expect(context.store.getState().theme).toBe('light');

		isPersisted = true;
		deferred.resolve(true);
		await flush();

		expect(dialog.textContent).toContain('Storage protection: Persistent');
	});

	it('displays About info, MIT licence text, ASDFPixelSort credit, and generated third-party notices', async () => {
		const context = createTestStore();
		mountSettings(context, {
			estimate: async () => ({usage: 0, quota: 100_000_000}),
			persisted: async () => true,
		});
		openSettingsDialog();
		await flush();

		const dialog = document.querySelector('[role="dialog"]')!;
		expect(dialog.textContent).toContain('PixelSortGUI');
		expect(dialog.textContent).not.toContain('0.x (dev)');
		expect(dialog.textContent).toMatch(/0\.\d+\./);
		expect(dialog.textContent).toContain(
			"Pixel sorting lineage: inspired by Kim Asendorf's ASDFPixelSort.",
		);

		const viewLicenseButton = [...dialog.querySelectorAll('button')].find(
			(button) => button.textContent?.includes('View licence'),
		)!;
		act(() => {
			viewLicenseButton.click();
		});
		await flush();
		expect(dialog.textContent).toContain(APP_LICENSE_TEXT.slice(0, 40));

		const viewNoticesButton = [...dialog.querySelectorAll('button')].find(
			(button) => button.textContent?.includes('View notices'),
		)!;
		act(() => {
			viewNoticesButton.click();
		});
		await flush();

		expect(THIRD_PARTY_NOTICES.length).toBeGreaterThan(0);
		for (const notice of THIRD_PARTY_NOTICES) {
			expect(dialog.textContent).toContain(notice.name);
			expect(dialog.textContent).toContain(notice.license);
		}

		const externalLinks = [...dialog.querySelectorAll('a[href]')];
		expect(externalLinks.length).toBeGreaterThan(0);
		for (const link of externalLinks) {
			expect(link.getAttribute('target')).toBe('_blank');
			expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		}
	});
});
