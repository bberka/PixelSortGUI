import {registerSW} from 'virtual:pwa-register';
import {
	attachServiceWorkerUpdateChecks,
	bindInstallPromptListeners,
	usePwaStore,
} from '@/state/pwa.ts';

export function initPwa(): () => void {
	if (typeof globalThis.addEventListener !== 'function') {
		return () => {};
	}

	const cleanups: Array<() => void> = [bindInstallPromptListeners(globalThis)];

	if (
		import.meta.env.PROD &&
		globalThis.isSecureContext &&
		'serviceWorker' in navigator
	) {
		const updateServiceWorker = registerSW({
			immediate: true,
			onNeedRefresh() {
				usePwaStore
					.getState()
					.setUpdateReady(true, () => updateServiceWorker(true));
			},
			// eslint-disable-next-line @typescript-eslint/naming-convention -- vite-plugin-pwa callback option name
			onRegisteredSW(_swUrl, registration) {
				if (registration) {
					cleanups.push(attachServiceWorkerUpdateChecks(registration));
				}
			},
		});
	}

	return () => {
		for (const cleanup of cleanups) {
			cleanup();
		}
	};
}
