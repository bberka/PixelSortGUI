import {effectRegistry} from '../engine/effects/index.ts';
import type {EffectRegistry} from '../engine/types.ts';
import type {RenderCoordinator} from '../render/coordinator.ts';
import {renderSourceFor} from '../render/render-source.ts';
import {
	createAppStore,
	MISSING_PROJECT_NOTICE,
	type AppStoreBundle,
	type AppStoreTimerEnv,
} from '../state/app-store.ts';
import {
	createBrowserHashRouterEnv,
	formatHashRoute,
	parseHashRoute,
	type AppRoute,
	type HashRouterEnv,
} from '../state/router.ts';
import {applyThemePreference, useThemeStore} from '../state/theme.ts';
import type {ThumbnailGenerator} from '../state/thumbnail.ts';
import type {TransientStore} from '../state/transient.ts';
import {repairProjectGeometry} from './geometry.ts';
import {
	openStorage,
	type OpenStorageOptions,
	type OpenStorageResult,
} from './index.ts';
import {resolveProjectStacks} from './migrations.ts';
import {
	getStorageEstimate,
	isStoragePersisted,
	type StorageManagerLike,
} from './quota.ts';
import {
	StorageVersionError,
	THEME_STORAGE_KEY,
	type ProjectRecord,
	type StorageRepository,
	type ThemePreference,
} from './types.ts';

export type RestoreOptions = {
	coordinator: RenderCoordinator;
	createSideCoordinator?: () => RenderCoordinator;
	registry?: EffectRegistry;
	routerEnv?: HashRouterEnv;
	timerEnv?: AppStoreTimerEnv;
	storageManager?: StorageManagerLike;
	thumbnailGenerator?: ThumbnailGenerator;
	transientStore?: TransientStore;
	isSecureContext?: boolean;
	openStorageFn?: (options?: OpenStorageOptions) => Promise<OpenStorageResult>;
	storageOptions?: OpenStorageOptions;
	mirrorTheme?: (theme: ThemePreference) => void;
	readLocalTheme?: () => string | null;
	scheduleIdle?: (callback: () => void) => void;
};

export type RestoreResult =
	| {
			status: 'insecure-context';
			bundle?: undefined;
	  }
	| {
			status: 'version-error';
			expectedVersion: number;
			message: string;
			bundle?: undefined;
	  }
	| {
			status: 'ready';
			bundle: AppStoreBundle;
			storageUnavailable: boolean;
			route: AppRoute;
			notice: string | null;
			hydrationPromise: Promise<void>;
			housekeepingPromise: Promise<void>;
	  };

function defaultIsSecureContext(): boolean {
	return typeof globalThis.isSecureContext === 'boolean'
		? globalThis.isSecureContext
		: true;
}

function defaultReadLocalTheme(): string | null {
	try {
		return globalThis.localStorage === undefined
			? null
			: globalThis.localStorage.getItem(THEME_STORAGE_KEY);
	} catch {
		return null;
	}
}

function defaultMirrorTheme(theme: ThemePreference): void {
	applyThemePreference(theme);
	useThemeStore.getState().setTheme(theme);
}

function defaultScheduleIdle(callback: () => void): void {
	if (typeof globalThis.requestIdleCallback === 'function') {
		globalThis.requestIdleCallback(() => {
			callback();
		});
		return;
	}

	globalThis.setTimeout(callback, 0);
}

/**
 Startup restore sequence implementing persistence.md section 9 (steps 1 to 7).
 Step 0 (synchronous theme boot) runs in index.html before first paint.
 */
export async function restoreStartup(
	options: RestoreOptions,
): Promise<RestoreResult> {
	// Step 1: Secure context gate
	const isSecure = options.isSecureContext ?? defaultIsSecureContext();
	if (!isSecure) {
		return {status: 'insecure-context'};
	}

	const openStorageFn = options.openStorageFn ?? openStorage;
	const registry = options.registry ?? effectRegistry;
	const routerEnv = options.routerEnv ?? createBrowserHashRouterEnv();
	const readLocalTheme = options.readLocalTheme ?? defaultReadLocalTheme;
	const mirrorTheme = options.mirrorTheme ?? defaultMirrorTheme;
	const scheduleIdle = options.scheduleIdle ?? defaultScheduleIdle;

	// Step 2: Open database (VersionError stops; other errors fall back to memory)
	let versionChanged = false;
	let createdBundle: AppStoreBundle | null = null;
	let opened: OpenStorageResult;
	try {
		opened = await openStorageFn({
			...options.storageOptions,
			onVersionChange(event) {
				versionChanged = true;
				createdBundle?.store.getState().markDatabaseClosedByUpgrade();
				options.storageOptions?.onVersionChange?.(event);
			},
		});
	} catch (error) {
		if (error instanceof StorageVersionError) {
			return {
				status: 'version-error',
				expectedVersion: error.expectedVersion,
				message: error.message,
			};
		}

		throw error;
	}

	const {repository, storageUnavailable} = opened;

	// Step 3: Fast metadata read in one readonly transaction across meta, projects, presets
	const snapshot = await repository.getStartupSnapshot();
	const {appState, projects, presets} = snapshot;

	if (readLocalTheme() === null) {
		mirrorTheme(appState.theme);
	}

	// Step 4: Route resolution
	const parsedHash = parseHashRoute(routerEnv.getHash());
	const projectById = new Map<string, ProjectRecord>(
		projects.map((project) => [project.id, project]),
	);

	let targetRoute: AppRoute;
	let activeProject: ProjectRecord | null = null;
	let notice: string | null = null;
	let shouldClearActiveProjectId = false;

	if (parsedHash.screen === 'gallery' || parsedHash.screen === 'guide') {
		targetRoute = parsedHash;
	} else if (parsedHash.screen === 'editor') {
		const found = projectById.get(parsedHash.projectId);
		if (found) {
			targetRoute = parsedHash;
			activeProject = found;
		} else {
			targetRoute = {screen: 'library'};
			routerEnv.replaceHash(formatHashRoute(targetRoute));
			notice = MISSING_PROJECT_NOTICE;
			if (appState.activeProjectId === parsedHash.projectId) {
				shouldClearActiveProjectId = true;
			}
		}
	} else if (
		appState.activeProjectId !== null &&
		projectById.has(appState.activeProjectId)
	) {
		activeProject = projectById.get(appState.activeProjectId)!;
		targetRoute = {screen: 'editor', projectId: activeProject.id};
		routerEnv.replaceHash(formatHashRoute(targetRoute));
	} else {
		targetRoute = {screen: 'library'};
		if (appState.activeProjectId !== null) {
			shouldClearActiveProjectId = true;
		}
	}

	if (shouldClearActiveProjectId) {
		void repository.updateAppState({activeProjectId: null}).catch(() => {});
	}

	// Step 5: First meaningful paint — populate store immediately from snapshot
	const bundle = createAppStore({
		repository,
		coordinator: options.coordinator,
		createSideCoordinator: options.createSideCoordinator,
		registry,
		routerEnv,
		timerEnv: options.timerEnv,
		storageManager: options.storageManager,
		thumbnailGenerator: options.thumbnailGenerator,
		transientStore: options.transientStore,
	});
	bundle.store.getState().attachListeners();
	bundle.store.getState().hydrateFromRestore({
		projects,
		presets,
		theme: appState.theme,
		compareMode: appState.compareMode,
		welcomeDismissed: appState.welcomeDismissed === true,
		storageUnavailable,
		route: targetRoute,
		notice,
		activeProject,
	});
	createdBundle = bundle;
	if (versionChanged) {
		bundle.store.getState().markDatabaseClosedByUpgrade();
	}

	// Step 6: Async editor hydration (Editor target only)
	const hydrationPromise = activeProject
		? hydrateActiveEditor(
				bundle,
				repository,
				options.coordinator,
				registry,
				activeProject,
				options.timerEnv,
			)
		: Promise.resolve();

	// Step 7: Idle housekeeping (storage estimate/persisted + orphaned source cleanup)
	const housekeepingPromise = new Promise<void>((resolve) => {
		scheduleIdle(() => {
			void runIdleHousekeeping(bundle, repository, options.storageManager)
				.catch(() => {})
				.finally(resolve);
		});
	});

	return {
		status: 'ready',
		bundle,
		storageUnavailable,
		route: targetRoute,
		notice,
		hydrationPromise,
		housekeepingPromise,
	};
}

async function hydrateActiveEditor(
	bundle: AppStoreBundle,
	repository: StorageRepository,
	coordinator: RenderCoordinator,
	registry: EffectRegistry,
	project: ProjectRecord,
	timerEnv?: AppStoreTimerEnv,
): Promise<void> {
	// Single key thumbnail lookup for fast placeholder (step 5) alongside step 6 hydration
	const thumbnailPromise = repository
		.getThumbnail(project.id)
		.then((thumbnail) => {
			if (bundle.store.getState().activeProjectId === project.id && thumbnail) {
				bundle.store.setState({activeThumbnail: thumbnail});
			}
		})
		.catch(() => {});

	const [source, history] = await Promise.all([
		repository.getSource(project.sourceHash),
		repository.getHistory(project.id),
	]);

	await thumbnailPromise;

	if (bundle.store.getState().activeProjectId !== project.id) {
		return;
	}

	const resolved = resolveProjectStacks(
		repairProjectGeometry(project),
		registry,
	);
	const hydratedProject = resolved.project;

	bundle.store.setState({
		activeProject: hydratedProject,
		activeSource: source ?? null,
		history,
		stackNeedsWriteBack: resolved.needsWriteBack,
		stackEnvelopeStatus: resolved.envelopeStatus,
		unsupportedInstances: resolved.unsupportedInstances,
	});

	if (!source) {
		return;
	}

	coordinator.setSource(renderSourceFor(hydratedProject, source));
	coordinator.setStack({stack: hydratedProject.stack});
	const dpr =
		timerEnv?.getDevicePixelRatio() ??
		(typeof globalThis.devicePixelRatio === 'number' &&
		Number.isFinite(globalThis.devicePixelRatio) &&
		globalThis.devicePixelRatio > 0
			? globalThis.devicePixelRatio
			: 1);
	if (hydratedProject.viewState.fitMode === 'custom') {
		bundle.store
			.getState()
			.setRenderViewScale(hydratedProject.viewState.zoom * dpr);
	}
}

async function runIdleHousekeeping(
	bundle: AppStoreBundle,
	repository: StorageRepository,
	storageManager?: StorageManagerLike,
): Promise<void> {
	const [estimate, persisted] = await Promise.all([
		getStorageEstimate(storageManager),
		isStoragePersisted(storageManager),
	]);
	bundle.store.getState().setStorageMetrics(estimate, persisted);
	await repository.cleanupOrphanedSources();
}
