import {create} from 'zustand';

export type InstallPromptChoice = {
	readonly outcome: 'accepted' | 'dismissed';
	readonly platform?: string;
};

export type BeforeInstallPromptEvent = Event & {
	prompt(): Promise<void>;
	readonly userChoice: Promise<InstallPromptChoice>;
};

export type UpdateApplicator = () => Promise<void>;

type PwaState = {
	updateReady: boolean;
	installPrompt: BeforeInstallPromptEvent | null;
	installing: boolean;
	applyUpdateHandler: UpdateApplicator | null;
	setUpdateReady: (ready: boolean, applyHandler?: UpdateApplicator) => void;
	dismissUpdate: () => void;
	applyUpdate: () => Promise<void>;
	setInstallPrompt: (event: BeforeInstallPromptEvent | null) => void;
	promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
	reset: () => void;
};

export function isBeforeInstallPromptEvent(
	event: Event,
): event is BeforeInstallPromptEvent {
	return (
		typeof (event as Partial<BeforeInstallPromptEvent>).prompt === 'function' &&
		typeof (event as Partial<BeforeInstallPromptEvent>).userChoice === 'object'
	);
}

export const usePwaStore = create<PwaState>((set, get) => ({
	updateReady: false,
	installPrompt: null,
	installing: false,
	applyUpdateHandler: null,

	setUpdateReady(ready, applyHandler) {
		set((state) => ({
			updateReady: ready,
			applyUpdateHandler:
				applyHandler === undefined ? state.applyUpdateHandler : applyHandler,
		}));
	},

	dismissUpdate() {
		set({updateReady: false});
	},

	async applyUpdate() {
		const handler = get().applyUpdateHandler;
		set({updateReady: false});
		if (handler) {
			await handler();
		}
	},

	setInstallPrompt(event) {
		set({installPrompt: event, installing: false});
	},

	async promptInstall() {
		const {installPrompt, installing} = get();
		if (!installPrompt || installing) {
			return 'unavailable';
		}

		set({installing: true});
		try {
			await installPrompt.prompt();
			const choice = await installPrompt.userChoice;
			set({installPrompt: null, installing: false});
			return choice.outcome;
		} catch {
			set({installPrompt: null, installing: false});
			return 'dismissed';
		}
	},

	reset() {
		set({
			updateReady: false,
			installPrompt: null,
			installing: false,
			applyUpdateHandler: null,
		});
	},
}));

export function bindInstallPromptListeners(
	target: Pick<
		EventTarget,
		'addEventListener' | 'removeEventListener'
	> = globalThis,
): () => void {
	const handleBeforeInstallPrompt = (event: Event) => {
		if (!isBeforeInstallPromptEvent(event)) {
			return;
		}

		event.preventDefault();
		usePwaStore.getState().setInstallPrompt(event);
	};

	const handleAppInstalled = () => {
		usePwaStore.getState().setInstallPrompt(null);
	};

	target.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
	target.addEventListener('appinstalled', handleAppInstalled);

	return () => {
		target.removeEventListener(
			'beforeinstallprompt',
			handleBeforeInstallPrompt,
		);
		target.removeEventListener('appinstalled', handleAppInstalled);
	};
}

export function attachServiceWorkerUpdateChecks(
	registration: {update(): Promise<unknown> | void},
	target: Pick<
		EventTarget,
		'addEventListener' | 'removeEventListener'
	> = globalThis,
	doc: Pick<
		Document,
		'visibilityState' | 'addEventListener' | 'removeEventListener'
	> = document,
): () => void {
	const triggerUpdate = () => {
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			return;
		}

		void Promise.resolve(registration.update()).catch(() => {});
	};

	const handleVisibilityChange = () => {
		if (doc.visibilityState === 'visible') {
			triggerUpdate();
		}
	};

	target.addEventListener('focus', triggerUpdate);
	target.addEventListener('hashchange', triggerUpdate);
	doc.addEventListener('visibilitychange', handleVisibilityChange);

	return () => {
		target.removeEventListener('focus', triggerUpdate);
		target.removeEventListener('hashchange', triggerUpdate);
		doc.removeEventListener('visibilitychange', handleVisibilityChange);
	};
}
