import {createRenderCoordinator} from '../render/coordinator.ts';
import {restoreStartup, type RestoreResult} from '../storage/restore.ts';

export * from './app-store.ts';
export * from './effect-utils.ts';
export * from './router.ts';
export * from './theme.ts';
export * from './thumbnail.ts';
export * from './transient.ts';

export type AppRuntime = {
	ready: Promise<RestoreResult>;
	result: RestoreResult | null;
	dispose(): void;
};

let activeRuntime: AppRuntime | null = null;

export function bootAppRuntime(): AppRuntime {
	if (activeRuntime) {
		return activeRuntime;
	}

	const coordinator = createRenderCoordinator();
	const runtime: AppRuntime = {
		ready: Promise.resolve({status: 'insecure-context'}),
		result: null,
		dispose() {
			if (runtime.result?.status === 'ready') {
				runtime.result.bundle.dispose();
				runtime.result.bundle.repository.close();
			}

			coordinator.dispose();
			if (activeRuntime === runtime) {
				activeRuntime = null;
			}
		},
	};

	runtime.ready = restoreStartup({coordinator}).then((result) => {
		runtime.result = result;
		if (result.status !== 'ready') {
			coordinator.dispose();
		}

		return result;
	});

	activeRuntime = runtime;
	return runtime;
}

export function getAppRuntime(): AppRuntime | null {
	return activeRuntime;
}
