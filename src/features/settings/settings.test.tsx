// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore} from '../../../tests/state/fixtures.ts';
import {ABOUT_EXTERNAL_LINKS} from './about-links.ts';
import {CHANGELOG_TEXT} from './changelog.generated.ts';
import {
	protectionMessage,
	type ProtectionResult,
} from './protection-feedback.ts';
import {SettingsButton} from './settings-button.tsx';
import {PROTECTION_WAIT_MS} from './settings-content.tsx';
import {
	THIRD_PARTY_NOTICES,
	THIRD_PARTY_NOTICES_FILE,
} from './third-party-notices.generated.ts';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {AppRuntime} from '@/state/index.ts';
import {usePwaStore, type BeforeInstallPromptEvent} from '@/state/pwa.ts';
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
	vi.useRealTimers();
	vi.restoreAllMocks();
	usePwaStore.getState().reset();
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
			'If you use a private or incognito window, everything Drift saves in it is deleted when you close it.',
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

	function findRequestButton() {
		return [...document.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('Request protection'),
		);
	}

	async function clickRequest(storageManager: StorageManagerLike) {
		vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Unknown/1.0');
		mountSettings(createTestStore(), storageManager);
		openSettingsDialog();
		await flush();
		act(() => {
			findRequestButton()!.click();
		});
		await flush();
	}

	function feedbackText(): string {
		return document.querySelector('[data-testid="protection-feedback"]')!
			.textContent;
	}

	it('says protection was granted and shows the persisted status', async () => {
		let isPersisted = false;
		await clickRequest({
			persisted: async () => isPersisted,
			async persist() {
				isPersisted = true;
				return true;
			},
		});

		expect(feedbackText()).toBe(protectionMessage('granted', 'other'));
		expect(document.body.textContent).toContain(
			'Storage protection: Persistent',
		);
		expect(findRequestButton()).toBeUndefined();
	});

	it.each<[string, StorageManagerLike, ProtectionResult]>([
		[
			'denied',
			{persist: async () => false, persisted: async () => false},
			'denied',
		],
		['unsupported', {}, 'unsupported'],
		[
			'throwing',
			{
				async persist() {
					throw new Error('no');
				},
				persisted: async () => false,
			},
			'failed',
		],
	])(
		'explains a %s request and keeps the button usable',
		async (_name, storageManager, result) => {
			await clickRequest(storageManager);

			expect(feedbackText()).toBe(protectionMessage(result, 'other'));
			expect(document.body.textContent).toContain(
				'Storage protection: Best-effort',
			);
			expect(findRequestButton()!.disabled).toBe(false);
		},
	);

	it('releases the button after 5 s without an answer and applies a late one', async () => {
		vi.useFakeTimers();
		const deferred = Promise.withResolvers<boolean>();
		let isPersisted = false;
		await clickRequest({
			persisted: async () => isPersisted,
			persist: async () => deferred.promise,
		});
		expect(feedbackText()).toBe('');

		act(() => {
			vi.advanceTimersByTime(PROTECTION_WAIT_MS);
		});
		expect(feedbackText()).toBe(protectionMessage('pending', 'other'));
		expect(findRequestButton()!.disabled).toBe(false);

		isPersisted = true;
		deferred.resolve(true);
		await flush();
		expect(feedbackText()).toBe(protectionMessage('granted', 'other'));
	});

	it('ignores a late refusal of an earlier click while a newer one waits', async () => {
		vi.useFakeTimers();
		const first = Promise.withResolvers<boolean>();
		const second = Promise.withResolvers<boolean>();
		const persist = vi
			.fn<() => Promise<boolean>>()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		await clickRequest({persist, persisted: async () => false});

		act(() => {
			vi.advanceTimersByTime(PROTECTION_WAIT_MS);
		});
		act(() => {
			findRequestButton()!.click();
		});
		first.resolve(false);
		await flush();

		expect(persist).toHaveBeenCalledTimes(2);
		expect(feedbackText()).toBe('');
		expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
	});

	it('displays About info, the ASDFPixelSort credit, and generated third-party notices', async () => {
		const context = createTestStore();
		mountSettings(context, {
			estimate: async () => ({usage: 0, quota: 100_000_000}),
			persisted: async () => true,
		});
		openSettingsDialog();
		await flush();

		const dialog = document.querySelector('[role="dialog"]')!;
		expect(dialog.textContent).toContain('Drift');
		expect(dialog.textContent).not.toContain('0.x (dev)');
		expect(dialog.textContent).toMatch(/0\.\d+\./);
		expect(dialog.textContent).toContain(
			"Pixel sorting lineage: inspired by Kim Asendorf's ASDFPixelSort.",
		);

		expect(dialog.textContent).not.toContain('View licence');

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

		const externalLinks = [
			...dialog.querySelectorAll('a[href]:not([href^="#"])'),
		];
		expect(externalLinks.length).toBeGreaterThan(0);
		for (const link of externalLinks) {
			expect(link.getAttribute('target')).toBe('_blank');
			expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		}

		for (const expected of ABOUT_EXTERNAL_LINKS) {
			const anchor = dialog.querySelector<HTMLAnchorElement>(
				`a[href="${CSS.escape(expected.href)}"]`,
			);
			expect(anchor).not.toBeNull();
			expect(anchor?.textContent).toContain(expected.label);
			expect(anchor?.getAttribute('aria-label')).toBe(expected.accessibleName);
			expect(anchor?.getAttribute('aria-label')).toContain('opens GitHub');
			expect(anchor?.getAttribute('target')).toBe('_blank');
			expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
			expect(anchor?.querySelector('svg')).not.toBeNull();
		}
	});

	it('links the bundled full licence texts from the app origin and holds no licence text itself', async () => {
		const context = createTestStore();
		mountSettings(context, {
			estimate: async () => ({usage: 0, quota: 100_000_000}),
			persisted: async () => true,
		});
		openSettingsDialog();
		await flush();

		const dialog = document.querySelector('[role="dialog"]')!;
		const link = [...dialog.querySelectorAll('a')].find(
			(anchor) => anchor.textContent === 'Full licence texts',
		);
		expect(link).toBeDefined();
		const url = new URL(link!.getAttribute('href')!, 'https://app.test/');
		expect(url.origin).toBe('https://app.test');
		expect(url.pathname).toBe(`/${THIRD_PARTY_NOTICES_FILE}`);
		expect(THIRD_PARTY_NOTICES_FILE).toBe('THIRD-PARTY-NOTICES.txt');
		expect(link!.getAttribute('target')).toBe('_blank');
		expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
		expect(dialog.textContent).not.toContain('Permission is hereby granted');
	});

	it('shows Install app when beforeinstallprompt is captured and hides it after prompting', async () => {
		const context = createTestStore();
		mountSettings(context, {
			estimate: async () => ({usage: 0, quota: 100_000_000}),
			persisted: async () => true,
		});
		openSettingsDialog();
		await flush();

		const dialog = document.querySelector('[role="dialog"]')!;
		expect(dialog.textContent).not.toContain('Install app');

		const promptSpy = vi.fn(async () => {});
		const installEvent = new Event('beforeinstallprompt', {
			cancelable: true,
		}) as BeforeInstallPromptEvent;
		Object.defineProperties(installEvent, {
			prompt: {value: promptSpy, configurable: true},
			userChoice: {
				value: Promise.resolve({outcome: 'accepted' as const}),
				configurable: true,
			},
		});

		act(() => {
			usePwaStore.getState().setInstallPrompt(installEvent);
		});
		await flush();

		const installButton = [...dialog.querySelectorAll('button')].find(
			(button) => button.textContent?.includes('Install app'),
		);
		expect(installButton).toBeDefined();

		act(() => {
			installButton!.click();
		});
		await flush();

		expect(promptSpy).toHaveBeenCalledTimes(1);
		expect(dialog.textContent).not.toContain('Install app');
	});

	it('AC-F24.1: expands and collapses the bundled release notes', async () => {
		const context = createTestStore();
		mountSettings(context);
		openSettingsDialog();
		await flush();

		const toggle = [...document.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('View changelog'),
		)!;
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(document.querySelector('#settings-changelog')).toBeNull();

		act(() => {
			toggle.click();
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.textContent).toContain('Hide changelog');
		expect(
			document.querySelector('#settings-changelog')?.textContent,
		).toContain(CHANGELOG_TEXT);

		act(() => {
			toggle.click();
		});
		expect(document.querySelector('#settings-changelog')).toBeNull();
	});
});
