// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {
	attachServiceWorkerUpdateChecks,
	bindInstallPromptListeners,
	usePwaStore,
	type BeforeInstallPromptEvent,
} from './pwa.ts';

function createInstallEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): {
	event: BeforeInstallPromptEvent;
	promptSpy: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
	const promptSpy = vi.fn(async () => {});
	const event = new Event('beforeinstallprompt', {
		cancelable: true,
	}) as BeforeInstallPromptEvent;
	Object.defineProperties(event, {
		prompt: {value: promptSpy, configurable: true},
		userChoice: {value: Promise.resolve({outcome}), configurable: true},
	});
	return {event, promptSpy};
}

afterEach(() => {
	usePwaStore.getState().reset();
	vi.restoreAllMocks();
});

describe('PWA state and listeners', () => {
	it('captures beforeinstallprompt, prevents default, triggers prompt, and clears state', async () => {
		const cleanup = bindInstallPromptListeners(globalThis);
		try {
			const {event, promptSpy} = createInstallEvent('accepted');
			globalThis.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(true);
			expect(usePwaStore.getState().installPrompt).toBe(event);

			const outcome = await usePwaStore.getState().promptInstall();
			expect(promptSpy).toHaveBeenCalledTimes(1);
			expect(outcome).toBe('accepted');
			expect(usePwaStore.getState().installPrompt).toBeNull();
			expect(usePwaStore.getState().installing).toBe(false);

			expect(await usePwaStore.getState().promptInstall()).toBe('unavailable');
		} finally {
			cleanup();
		}
	});

	it('clears install prompt when appinstalled fires', () => {
		const cleanup = bindInstallPromptListeners(globalThis);
		try {
			const {event} = createInstallEvent('accepted');
			globalThis.dispatchEvent(event);
			expect(usePwaStore.getState().installPrompt).toBe(event);

			globalThis.dispatchEvent(new Event('appinstalled'));
			expect(usePwaStore.getState().installPrompt).toBeNull();
		} finally {
			cleanup();
		}
	});

	it('tracks update readiness without auto-reloading and applies only when requested', async () => {
		const applySpy = vi.fn(async () => {});
		usePwaStore.getState().setUpdateReady(true, applySpy);

		expect(usePwaStore.getState().updateReady).toBe(true);
		expect(applySpy).not.toHaveBeenCalled();

		usePwaStore.getState().dismissUpdate();
		expect(usePwaStore.getState().updateReady).toBe(false);
		expect(applySpy).not.toHaveBeenCalled();

		usePwaStore.getState().setUpdateReady(true, applySpy);
		await usePwaStore.getState().applyUpdate();
		expect(applySpy).toHaveBeenCalledTimes(1);
		expect(usePwaStore.getState().updateReady).toBe(false);
	});

	it('checks for service worker updates on focus, hashchange, and visible tab transitions', () => {
		const updateSpy = vi.fn(async () => {});
		const fakeTarget = new EventTarget();
		let visibilityState: DocumentVisibilityState = 'hidden';
		const fakeDoc = new EventTarget() as EventTarget & {
			readonly visibilityState: DocumentVisibilityState;
		};
		Object.defineProperty(fakeDoc, 'visibilityState', {
			get() {
				return visibilityState;
			},
			configurable: true,
		});

		const cleanup = attachServiceWorkerUpdateChecks(
			{update: updateSpy},
			fakeTarget,
			fakeDoc,
		);
		try {
			fakeTarget.dispatchEvent(new Event('focus'));
			expect(updateSpy).toHaveBeenCalledTimes(1);

			fakeTarget.dispatchEvent(new Event('hashchange'));
			expect(updateSpy).toHaveBeenCalledTimes(2);

			fakeDoc.dispatchEvent(new Event('visibilitychange'));
			expect(updateSpy).toHaveBeenCalledTimes(2);

			visibilityState = 'visible';
			fakeDoc.dispatchEvent(new Event('visibilitychange'));
			expect(updateSpy).toHaveBeenCalledTimes(3);
		} finally {
			cleanup();
		}
	});
});
