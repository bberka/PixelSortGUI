import {createStore, type StoreApi} from 'zustand/vanilla';
import {effectRegistry} from '../engine/effects/index.ts';
import {
	canonicalStackJson,
	type BlendMode,
	type EffectInstance,
	type EffectRegistry,
	type EffectStack,
	type ParamValue,
	type RenderLevel,
} from '../engine/types.ts';
import {
	BUILTIN_PRESETS,
	getBuiltinPreset,
	type BuiltinPreset,
} from '../presets/builtin.ts';
import type {
	Frame,
	FullFrame,
	RenderCoordinator,
	RenderError,
	RenderEvent,
	SourceInfo,
} from '../render/coordinator.ts';
import {normalizeViewState} from '../storage/helpers.ts';
import {
	resolveStoredStack,
	type UnsupportedInstanceInfo,
} from '../storage/migrations.ts';
import {
	requestPersistentStorage,
	type StorageManagerLike,
	type StorageQuotaEstimate,
} from '../storage/quota.ts';
import {
	isQuotaExceededError,
	StorageValidationError,
	type CompareMode,
	type CreateProjectInput,
	type CreateProjectResult,
	type DeleteProjectResult,
	type ExportSettings,
	type HistoryEntryRecord,
	type ProjectRecord,
	type SourceRecord,
	type StorageRepository,
	type ThemePreference,
	type ThumbnailRecord,
	type UserPresetRecord,
	type ViewState,
} from '../storage/types.ts';
import {
	assertStackCapacity,
	cloneEffectStack,
	cloneInstanceWithNewId,
	cloneStackWithNewIds,
	createEffectInstance,
	createInstanceDefaults,
	getEffectLabel,
	normalizeBlend,
	normalizeMix,
	validateSingleParam,
	type RandomBytesSource,
} from './effect-utils.ts';
import {
	createBrowserHashRouterEnv,
	formatHashRoute,
	parseHashRoute,
	type AppRoute,
	type HashRouterEnv,
} from './router.ts';
import {useThemeStore} from './theme.ts';
import {
	createCanvasThumbnailGenerator,
	type ThumbnailGenerator,
} from './thumbnail.ts';
import {
	applyTransientDragToStack,
	createTransientStore,
	type TransientStore,
} from './transient.ts';

export const VIEW_STATE_DEBOUNCE_MS = 200;
export const KEYBOARD_COMMIT_DEBOUNCE_MS = 500;
export const MISSING_PROJECT_NOTICE = 'That project no longer exists.';

export type BootStatus =
	'booting' | 'ready' | 'insecure-context' | 'version-error';

export type DebugViewTarget = {
	instanceId: string;
	view: 'selection';
};

export type RenderStatus = {
	source: SourceInfo | undefined;
	frame: Frame | undefined;
	full: FullFrame | undefined;
	busy: Record<RenderLevel, boolean>;
	progress: Record<RenderLevel, number>;
	error: RenderError | null;
	failed: boolean;
};

export type StorageStatus = {
	storageUnavailable: boolean;
	estimate: StorageQuotaEstimate;
	persisted: boolean;
	quotaFull: boolean;
	versionErrorMessage: string | null;
};

export type AppStoreTimerEnv = {
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	now(): number;
	getDevicePixelRatio(): number;
	addLifecycleListeners(onFlush: () => void): () => void;
};

export type AppStoreDependencies = {
	repository: StorageRepository;
	coordinator: RenderCoordinator;
	registry?: EffectRegistry;
	routerEnv?: HashRouterEnv;
	timerEnv?: AppStoreTimerEnv;
	storageManager?: StorageManagerLike;
	thumbnailGenerator?: ThumbnailGenerator;
	transientStore?: TransientStore;
	getRandomValues?: RandomBytesSource;
	syncTheme?: (theme: ThemePreference) => void;
};

export type AppState = {
	bootStatus: BootStatus;
	route: AppRoute;
	notice: string | null;

	projects: ProjectRecord[];
	activeProjectId: string | null;
	activeProject: ProjectRecord | null;
	activeSource: SourceRecord | null;
	activeThumbnail: ThumbnailRecord | null;
	thumbnailVersions: Record<string, number>;
	history: HistoryEntryRecord[];
	stackNeedsWriteBack: boolean;
	stackEnvelopeStatus: 'ok' | 'newer-version';
	unsupportedInstances: UnsupportedInstanceInfo[];
	debugView: DebugViewTarget | null;

	builtinPresets: readonly BuiltinPreset[];
	presets: UserPresetRecord[];
	compareMode: CompareMode;
	theme: ThemePreference;

	storage: StorageStatus;
	render: RenderStatus;

	// Internal / restore hydration
	hydrateFromRestore(payload: {
		projects: ProjectRecord[];
		presets: UserPresetRecord[];
		theme: ThemePreference;
		compareMode: CompareMode;
		storageUnavailable: boolean;
		route: AppRoute;
		notice: string | null;
		activeProject: ProjectRecord | null;
	}): void;
	setBootError(
		status: 'insecure-context' | 'version-error',
		message?: string,
	): void;
	setStorageMetrics(estimate: StorageQuotaEstimate, persisted: boolean): void;
	clearNotice(): void;
	clearQuotaFull(): void;
	notifyThumbnailUpdated(projectId: string): void;

	// Library & project actions
	importImage(input: CreateProjectInput): Promise<CreateProjectResult>;
	importImages(
		inputs: readonly CreateProjectInput[],
	): Promise<CreateProjectResult[]>;
	openProject(
		id: string,
		options?: {updateHash?: boolean; replaceHash?: boolean},
	): Promise<ProjectRecord | null>;
	closeProject(options?: {
		updateHash?: boolean;
		replaceHash?: boolean;
	}): Promise<void>;
	renameProject(id: string, name: string): Promise<ProjectRecord>;
	duplicateProject(id: string): Promise<ProjectRecord>;
	deleteProject(id: string): Promise<DeleteProjectResult>;

	// Effect stack actions
	addEffect(type: string): Promise<EffectInstance>;
	removeEffect(instanceId: string): Promise<void>;
	reorderEffect(fromIndex: number, toIndex: number): Promise<void>;
	duplicateEffect(instanceId: string): Promise<EffectInstance>;
	setEffectEnabled(instanceId: string, enabled: boolean): Promise<void>;
	selectEffect(instanceId: string | null): void;
	setDebugView(debugView: DebugViewTarget | null): void;

	// Parameter, mix, blend, and reset actions
	dragParam(instanceId: string, paramKey: string, value: ParamValue): void;
	commitParam(
		instanceId: string,
		paramKey: string,
		value: ParamValue,
		label?: string,
	): Promise<void>;
	nudgeParam(
		instanceId: string,
		paramKey: string,
		value: ParamValue,
		label?: string,
	): void;
	dragMix(instanceId: string, mix: number): void;
	commitMix(instanceId: string, mix: number): Promise<void>;
	nudgeMix(instanceId: string, mix: number): void;
	setBlend(instanceId: string, blend: BlendMode): Promise<void>;
	resetParam(instanceId: string, paramKey: string): Promise<void>;
	resetInstance(instanceId: string): Promise<void>;
	cancelDrag(): void;
	flushPendingCommit(): Promise<void>;

	// Undo / redo
	undo(): Promise<boolean>;
	redo(): Promise<boolean>;

	// Presets
	applyPreset(presetId: string): Promise<void>;
	addPresetToStack(presetId: string): Promise<void>;
	saveStackAsPreset(name: string): Promise<UserPresetRecord>;
	renameUserPreset(id: string, name: string): Promise<UserPresetRecord>;
	deleteUserPreset(id: string): Promise<boolean>;

	// View state, compare, export settings, theme
	setViewState(
		patch: Partial<ViewState>,
		options?: {devicePixelRatio?: number},
	): void;
	dragSplitPosition(position: number): void;
	commitSplitPosition(position: number): void;
	flushViewState(): Promise<void>;
	setCompareMode(mode: CompareMode): Promise<void>;
	setTheme(theme: ThemePreference): Promise<void>;
	updateExportSettings(settings: ExportSettings): Promise<ProjectRecord>;

	// Hash navigation & teardown
	syncFromHash(): Promise<void>;
	attachListeners(): () => void;
	dispose(): void;
};

export type AppStore = StoreApi<AppState>;

export type AppStoreBundle = {
	store: AppStore;
	transientStore: TransientStore;
	repository: StorageRepository;
	coordinator: RenderCoordinator;
	dispose(): void;
};

function createDefaultRenderStatus(): RenderStatus {
	return {
		source: undefined,
		frame: undefined,
		full: undefined,
		busy: {drag: false, settle: false, full: false},
		progress: {drag: 0, settle: 0, full: 0},
		error: null,
		failed: false,
	};
}

export function createBrowserTimerEnv(): AppStoreTimerEnv {
	return {
		setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
		clearTimeout(handle) {
			globalThis.clearTimeout(handle as number);
		},
		now: () => Date.now(),
		getDevicePixelRatio: () =>
			typeof globalThis.devicePixelRatio === 'number' &&
			Number.isFinite(globalThis.devicePixelRatio) &&
			globalThis.devicePixelRatio > 0
				? globalThis.devicePixelRatio
				: 1,
		addLifecycleListeners(onFlush) {
			const cleanups: Array<() => void> = [];
			if (globalThis.document !== undefined) {
				const handleVisibility = () => {
					if (globalThis.document.visibilityState === 'hidden') {
						onFlush();
					}
				};

				globalThis.document.addEventListener(
					'visibilitychange',
					handleVisibility,
				);
				cleanups.push(() => {
					globalThis.document.removeEventListener(
						'visibilitychange',
						handleVisibility,
					);
				});
			}

			if (typeof globalThis.addEventListener === 'function') {
				const handlePageHide = () => {
					onFlush();
				};

				globalThis.addEventListener('pagehide', handlePageHide);
				cleanups.push(() => {
					globalThis.removeEventListener('pagehide', handlePageHide);
				});
			}

			return () => {
				for (const cleanup of cleanups) {
					cleanup();
				}
			};
		},
	};
}

function sortProjectsByOpenedAt(projects: ProjectRecord[]): ProjectRecord[] {
	return projects.toSorted((a, b) => b.openedAt - a.openedAt);
}

function sortPresetsByName(presets: UserPresetRecord[]): UserPresetRecord[] {
	return presets.toSorted((a, b) =>
		a.nameLower.localeCompare(b.nameLower, 'en'),
	);
}

function upsertProject(
	projects: ProjectRecord[],
	project: ProjectRecord,
): ProjectRecord[] {
	const next = projects.filter((item) => item.id !== project.id);
	next.push(project);
	return sortProjectsByOpenedAt(next);
}

export function selectCanUndo(state: AppState): boolean {
	return (
		state.activeProject !== null &&
		state.activeProject.historyHeadSeq > state.activeProject.historyMinSeq
	);
}

export function selectCanRedo(state: AppState): boolean {
	return (
		state.activeProject !== null &&
		state.activeProject.historyHeadSeq < state.activeProject.historyMaxSeq
	);
}

export function selectUndoLabel(state: AppState): string | null {
	if (!selectCanUndo(state) || !state.activeProject) {
		return null;
	}

	const head = state.history.find(
		(entry) => entry.seq === state.activeProject?.historyHeadSeq,
	);
	return head?.label ?? null;
}

export function selectRedoLabel(state: AppState): string | null {
	if (!selectCanRedo(state) || !state.activeProject) {
		return null;
	}

	const nextSeq = state.activeProject.historyHeadSeq + 1;
	const next = state.history.find((entry) => entry.seq === nextSeq);
	return next?.label ?? null;
}

type PendingKeyboardCommit =
	| {
			kind: 'param';
			projectId: string;
			instanceId: string;
			paramKey: string;
			value: ParamValue;
			label?: string;
			timer: unknown;
	  }
	| {
			kind: 'mix';
			projectId: string;
			instanceId: string;
			mix: number;
			timer: unknown;
	  };

export function createAppStore(deps: AppStoreDependencies): AppStoreBundle {
	const {repository, coordinator} = deps;
	const registry = deps.registry ?? effectRegistry;
	const routerEnv = deps.routerEnv ?? createBrowserHashRouterEnv();
	const timerEnv = deps.timerEnv ?? createBrowserTimerEnv();
	const thumbnailGenerator =
		deps.thumbnailGenerator ?? createCanvasThumbnailGenerator();
	const transientStore = deps.transientStore ?? createTransientStore();
	const {getRandomValues} = deps;
	const syncTheme =
		deps.syncTheme ??
		((theme: ThemePreference) => {
			useThemeStore.getState().setTheme(theme);
		});

	let viewStateTimer: unknown;
	let viewStateDirty = false;
	let pendingKeyboard: PendingKeyboardCommit | null = null;
	let persistenceRequested = false;
	let lastThumbnailKey: string | null = null;
	let openProjectRequestId = 0;
	let detachCoordinator: (() => void) | null = null;
	let detachRouter: (() => void) | null = null;
	let detachLifecycle: (() => void) | null = null;
	let disposed = false;

	const clearViewStateTimer = () => {
		if (viewStateTimer === undefined) {
			return;
		}

		timerEnv.clearTimeout(viewStateTimer);
		viewStateTimer = undefined;
	};

	const clearKeyboardTimer = () => {
		if (!pendingKeyboard) {
			return;
		}

		timerEnv.clearTimeout(pendingKeyboard.timer);
		pendingKeyboard = null;
	};

	const handleQuotaError = (error: unknown) => {
		if (isQuotaExceededError(error)) {
			store.setState((state) => ({
				storage: {...state.storage, quotaFull: true},
			}));
		}
	};

	const dispatchStackToCoordinator = (
		stack: EffectStack,
		debugView: DebugViewTarget | null,
		dragging: boolean,
	) => {
		coordinator.setStack(
			{
				stack,
				debug: debugView ?? undefined,
			},
			dragging ? {dragging: true} : undefined,
		);
	};

	const syncCoordinatorViewScale = (
		viewState: ViewState,
		devicePixelRatio?: number,
	) => {
		const dpr = devicePixelRatio ?? timerEnv.getDevicePixelRatio();
		coordinator.setViewScale(
			viewState.fitMode === 'custom' ? viewState.zoom * dpr : 0,
		);
	};

	const maybeCaptureThumbnail = (frame: Frame) => {
		if (frame.level !== 'settle' || disposed) {
			return;
		}

		const state = store.getState();
		const {activeProject, debugView} = state;
		if (
			!activeProject ||
			debugView !== null ||
			transientStore.getState().activeDrag !== null
		) {
			return;
		}

		const stackSignature = canonicalStackJson(activeProject.stack);
		const thumbKey = `${activeProject.id}:${stackSignature}`;
		if (thumbKey === lastThumbnailKey) {
			return;
		}

		const projectId = activeProject.id;
		lastThumbnailKey = thumbKey;
		const thumbnailPromise = thumbnailGenerator(frame);
		void thumbnailPromise
			.then(async (generated) => {
				if (!generated || disposed) {
					return;
				}

				const record: ThumbnailRecord = {
					projectId,
					blob: generated.blob,
					width: generated.width,
					height: generated.height,
					stackSignature,
					updatedAt: timerEnv.now(),
				};
				try {
					await repository.putThumbnail(record);
					store.setState((current) => ({
						...(current.activeProjectId === projectId && {
							activeThumbnail: record,
						}),
						thumbnailVersions: {
							...current.thumbnailVersions,
							[projectId]: (current.thumbnailVersions[projectId] ?? 0) + 1,
						},
					}));
				} catch (error) {
					handleQuotaError(error);
				}
			})
			.catch(() => {});
	};

	const onCoordinatorEvent = (event: RenderEvent) => {
		switch (event.type) {
			case 'source': {
				store.setState((state) => ({
					render: {
						...state.render,
						source: event.source,
						frame: event.source ? state.render.frame : undefined,
						full: event.source ? state.render.full : undefined,
					},
				}));
				break;
			}

			case 'frame': {
				store.setState((state) => ({
					render: {
						...state.render,
						frame: event.frame,
						error: null,
					},
				}));
				maybeCaptureThumbnail(event.frame);
				break;
			}

			case 'full': {
				store.setState((state) => ({
					render: {
						...state.render,
						full: event.full,
					},
				}));
				break;
			}

			case 'busy': {
				store.setState((state) => ({
					render: {
						...state.render,
						busy: {...state.render.busy, [event.level]: event.busy},
						progress: event.busy
							? state.render.progress
							: {...state.render.progress, [event.level]: 0},
					},
				}));
				break;
			}

			case 'progress': {
				store.setState((state) => ({
					render: {
						...state.render,
						progress: {...state.render.progress, [event.level]: event.fraction},
					},
				}));
				break;
			}

			case 'error': {
				store.setState((state) => ({
					render: {
						...state.render,
						error: event.error,
						failed: event.failed,
					},
				}));
				break;
			}
		}
	};

	const requireActiveProject = (): ProjectRecord => {
		const {activeProject} = store.getState();
		if (!activeProject) {
			throw new StorageValidationError('No active project');
		}

		return activeProject;
	};

	const commitNextStack = async (
		nextStack: EffectStack,
		selectedInstanceId: string | null,
		label: string,
	): Promise<ProjectRecord> => {
		const active = requireActiveProject();
		assertStackCapacity(nextStack.instances.length);

		try {
			const {project, entry} = await repository.commitStack({
				projectId: active.id,
				stack: nextStack,
				selectedInstanceId,
				label,
			});

			const currentState = store.getState();
			const trimmedHistory = currentState.history
				.filter((item) => item.seq <= active.historyHeadSeq)
				.concat(entry)
				.filter((item) => item.seq >= project.historyMinSeq);

			const nextDebugView =
				currentState.debugView &&
				project.stack.instances.some(
					(item) => item.id === currentState.debugView?.instanceId,
				)
					? currentState.debugView
					: null;

			transientStore.setState({activeDrag: null});
			store.setState((state) => {
				const nextProject: ProjectRecord =
					viewStateDirty && state.activeProject?.id === project.id
						? {...project, viewState: state.activeProject.viewState}
						: project;
				return {
					activeProject: nextProject,
					projects: upsertProject(state.projects, nextProject),
					history: trimmedHistory,
					stackNeedsWriteBack: false,
					debugView: nextDebugView,
				};
			});

			dispatchStackToCoordinator(project.stack, nextDebugView, false);
			return project;
		} catch (error) {
			handleQuotaError(error);
			throw error;
		}
	};

	const flushViewStateImpl = async (): Promise<void> => {
		clearViewStateTimer();
		if (!viewStateDirty) {
			return;
		}

		const {activeProject} = store.getState();
		viewStateDirty = false;
		if (!activeProject) {
			return;
		}

		try {
			const updated = await repository.updateViewState(
				activeProject.id,
				activeProject.viewState,
				activeProject.selectedInstanceId,
			);
			if (store.getState().activeProjectId === updated.id) {
				store.setState((state) => ({
					projects: upsertProject(state.projects, updated),
				}));
			}
		} catch (error) {
			handleQuotaError(error);
		}
	};

	const scheduleViewStateSave = () => {
		viewStateDirty = true;
		clearViewStateTimer();
		viewStateTimer = timerEnv.setTimeout(() => {
			viewStateTimer = undefined;
			void flushViewStateImpl();
		}, VIEW_STATE_DEBOUNCE_MS);
	};

	const flushPendingCommitImpl = async (): Promise<void> => {
		const pending = pendingKeyboard;
		if (!pending) {
			return;
		}

		clearKeyboardTimer();
		const {activeProject} = store.getState();
		if (!activeProject || activeProject.id !== pending.projectId) {
			transientStore.setState({activeDrag: null});
			return;
		}

		if (pending.kind === 'param') {
			await store
				.getState()
				.commitParam(
					pending.instanceId,
					pending.paramKey,
					pending.value,
					pending.label,
				);
			return;
		}

		await store.getState().commitMix(pending.instanceId, pending.mix);
	};

	const loadActiveProjectResources = async (
		project: ProjectRecord,
		requestId: number,
	) => {
		const resolved = resolveStoredStack(project.stack, registry);
		const [source, history, thumbnail] = await Promise.all([
			repository.getSource(project.sourceHash),
			repository.getHistory(project.id),
			repository.getThumbnail(project.id),
		]);

		if (
			disposed ||
			requestId !== openProjectRequestId ||
			store.getState().activeProjectId !== project.id
		) {
			return;
		}

		const hydratedProject: ProjectRecord = resolved.needsWriteBack
			? {...project, stack: resolved.stack}
			: project;

		lastThumbnailKey = thumbnail
			? `${project.id}:${thumbnail.stackSignature}`
			: null;

		store.setState({
			activeProject: hydratedProject,
			activeSource: source ?? null,
			activeThumbnail: thumbnail ?? null,
			history,
			stackNeedsWriteBack: resolved.needsWriteBack,
			stackEnvelopeStatus: resolved.envelopeStatus,
			unsupportedInstances: resolved.unsupportedInstances,
		});

		if (!source) {
			return;
		}

		coordinator.setSource({
			key: source.sha256,
			blob: source.blob,
			width: source.width,
			height: source.height,
		});
		dispatchStackToCoordinator(hydratedProject.stack, null, false);
		syncCoordinatorViewScale(hydratedProject.viewState);
	};

	const store = createStore<AppState>((set, get) => ({
		bootStatus: 'booting',
		route: {screen: 'library'},
		notice: null,

		projects: [],
		activeProjectId: null,
		activeProject: null,
		activeSource: null,
		activeThumbnail: null,
		thumbnailVersions: {},
		history: [],
		stackNeedsWriteBack: false,
		stackEnvelopeStatus: 'ok',
		unsupportedInstances: [],
		debugView: null,

		builtinPresets: BUILTIN_PRESETS,
		presets: [],
		compareMode: 'toggle',
		theme: 'system',

		storage: {
			storageUnavailable: false,
			estimate: {usage: null, quota: null, available: null},
			persisted: false,
			quotaFull: false,
			versionErrorMessage: null,
		},
		render: createDefaultRenderStatus(),

		hydrateFromRestore(payload) {
			const resolved = payload.activeProject
				? resolveStoredStack(payload.activeProject.stack, registry)
				: null;
			const activeProject =
				payload.activeProject && resolved?.needsWriteBack
					? {...payload.activeProject, stack: resolved.stack}
					: payload.activeProject;

			set((state) => ({
				bootStatus: 'ready',
				projects: sortProjectsByOpenedAt(payload.projects),
				presets: sortPresetsByName(payload.presets),
				theme: payload.theme,
				compareMode: payload.compareMode,
				route: payload.route,
				notice: payload.notice,
				activeProjectId: activeProject?.id ?? null,
				activeProject,
				stackNeedsWriteBack: resolved?.needsWriteBack ?? false,
				stackEnvelopeStatus: resolved?.envelopeStatus ?? 'ok',
				unsupportedInstances: resolved?.unsupportedInstances ?? [],
				storage: {
					...state.storage,
					storageUnavailable: payload.storageUnavailable,
				},
			}));
		},

		setBootError(status, message) {
			set((state) => ({
				bootStatus: status,
				storage: {
					...state.storage,
					versionErrorMessage:
						status === 'version-error' ? (message ?? null) : null,
				},
			}));
		},

		setStorageMetrics(estimate, persisted) {
			set((state) => ({
				storage: {
					...state.storage,
					estimate,
					persisted,
				},
			}));
		},

		clearNotice() {
			set({notice: null});
		},

		clearQuotaFull() {
			set((state) => ({
				storage: {...state.storage, quotaFull: false},
			}));
		},

		notifyThumbnailUpdated(projectId) {
			set((state) => ({
				thumbnailVersions: {
					...state.thumbnailVersions,
					[projectId]: (state.thumbnailVersions[projectId] ?? 0) + 1,
				},
			}));
		},

		async importImage(input) {
			await flushPendingCommitImpl();
			await flushViewStateImpl();

			try {
				const result = await repository.createProject(input);
				if (!persistenceRequested) {
					persistenceRequested = true;
					requestPersistentStorage(deps.storageManager, (persisted) => {
						if (!disposed) {
							set((state) => ({
								storage: {...state.storage, persisted},
							}));
						}
					});
				}

				const activate = input.setActive ?? true;
				set((state) => ({
					projects: upsertProject(state.projects, result.project),
				}));

				if (activate) {
					openProjectRequestId++;
					const initialEntry: HistoryEntryRecord = {
						projectId: result.project.id,
						seq: 0,
						label: 'Initial',
						stack: result.project.stack,
						selectedInstanceId: null,
						createdAt: result.project.createdAt,
					};
					transientStore.setState({activeDrag: null, splitPosition: null});
					lastThumbnailKey = null;
					const nextRoute: AppRoute = {
						screen: 'editor',
						projectId: result.project.id,
					};
					set({
						activeProjectId: result.project.id,
						activeProject: result.project,
						activeSource: result.source,
						activeThumbnail: null,
						history: [initialEntry],
						stackNeedsWriteBack: false,
						stackEnvelopeStatus: 'ok',
						unsupportedInstances: [],
						debugView: null,
						route: nextRoute,
						notice: null,
					});
					routerEnv.setHash(formatHashRoute(nextRoute));
					coordinator.setSource({
						key: result.source.sha256,
						blob: result.source.blob,
						width: result.source.width,
						height: result.source.height,
					});
					dispatchStackToCoordinator(result.project.stack, null, false);
					syncCoordinatorViewScale(result.project.viewState);
				}

				return result;
			} catch (error) {
				handleQuotaError(error);
				throw error;
			}
		},

		async importImages(inputs) {
			const results: CreateProjectResult[] = [];
			for (const [index, item] of inputs.entries()) {
				const created = await get().importImage({
					...item,
					setActive: index === 0,
				});
				results.push(created);
			}

			return results;
		},

		async openProject(id, options = {}) {
			await flushPendingCommitImpl();
			await flushViewStateImpl();

			const existing = await repository.getProject(id);
			if (!existing) {
				const currentAppState = await repository.getAppState();
				if (currentAppState.activeProjectId === id) {
					await repository.closeActiveProject();
				}

				const libraryRoute: AppRoute = {screen: 'library'};
				set({
					activeProjectId: null,
					activeProject: null,
					activeSource: null,
					activeThumbnail: null,
					history: [],
					debugView: null,
					route: libraryRoute,
					notice: MISSING_PROJECT_NOTICE,
				});
				coordinator.setSource(undefined);
				routerEnv.replaceHash(formatHashRoute(libraryRoute));
				return null;
			}

			const opened = await repository.openProject(id);
			const nextRoute: AppRoute = {screen: 'editor', projectId: opened.id};
			transientStore.setState({activeDrag: null, splitPosition: null});
			openProjectRequestId++;
			const requestId = openProjectRequestId;

			set((state) => ({
				projects: upsertProject(state.projects, opened),
				activeProjectId: opened.id,
				activeProject: opened,
				activeThumbnail: null,
				debugView: null,
				route: nextRoute,
				notice: null,
			}));

			if (options.updateHash !== false) {
				const hash = formatHashRoute(nextRoute);
				if (options.replaceHash) {
					routerEnv.replaceHash(hash);
				} else {
					routerEnv.setHash(hash);
				}
			}

			await loadActiveProjectResources(opened, requestId);
			return get().activeProject ?? opened;
		},

		async closeProject(options = {}) {
			await flushPendingCommitImpl();
			await flushViewStateImpl();
			openProjectRequestId++;

			await repository.closeActiveProject();
			transientStore.setState({activeDrag: null, splitPosition: null});
			const nextRoute: AppRoute = {screen: 'library'};

			set({
				activeProjectId: null,
				activeProject: null,
				activeSource: null,
				activeThumbnail: null,
				history: [],
				stackNeedsWriteBack: false,
				stackEnvelopeStatus: 'ok',
				unsupportedInstances: [],
				debugView: null,
				route: nextRoute,
			});

			coordinator.setSource(undefined);

			if (options.updateHash === false) {
				return;
			}

			const hash = formatHashRoute(nextRoute);
			if (options.replaceHash) {
				routerEnv.replaceHash(hash);
			} else {
				routerEnv.setHash(hash);
			}
		},

		async renameProject(id, name) {
			const updated = await repository.renameProject(id, name);
			set((state) => ({
				projects: upsertProject(state.projects, updated),
				activeProject:
					state.activeProjectId === updated.id
						? {
								...state.activeProject!,
								name: updated.name,
								updatedAt: updated.updatedAt,
							}
						: state.activeProject,
			}));
			return updated;
		},

		async duplicateProject(id) {
			if (get().activeProjectId === id) {
				await flushPendingCommitImpl();
				await flushViewStateImpl();
			}

			try {
				const copy = await repository.duplicateProject(id);
				set((state) => ({
					projects: upsertProject(state.projects, copy),
				}));
				return copy;
			} catch (error) {
				handleQuotaError(error);
				throw error;
			}
		},

		async deleteProject(id) {
			const wasActive = get().activeProjectId === id;
			if (wasActive) {
				clearKeyboardTimer();
				clearViewStateTimer();
				viewStateDirty = false;
				openProjectRequestId++;
			}

			const result = await repository.deleteProject(id);
			set((state) => ({
				projects: state.projects.filter((item) => item.id !== id),
			}));

			if (wasActive) {
				transientStore.setState({activeDrag: null, splitPosition: null});
				const nextRoute: AppRoute = {screen: 'library'};
				set({
					activeProjectId: null,
					activeProject: null,
					activeSource: null,
					activeThumbnail: null,
					history: [],
					stackNeedsWriteBack: false,
					stackEnvelopeStatus: 'ok',
					unsupportedInstances: [],
					debugView: null,
					route: nextRoute,
				});
				coordinator.setSource(undefined);
				routerEnv.replaceHash(formatHashRoute(nextRoute));
			}

			return result;
		},

		async addEffect(type) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			assertStackCapacity(active.stack.instances.length + 1);

			const existingIds = new Set(
				active.stack.instances.map((item) => item.id),
			);
			const instance = createEffectInstance(
				type,
				registry,
				existingIds,
				getRandomValues,
			);
			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: [...active.stack.instances, instance],
			};
			const label = `Add ${getEffectLabel(instance, registry)}`;
			await commitNextStack(nextStack, instance.id, label);
			return instance;
		},

		async removeEffect(instanceId) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			const index = active.stack.instances.findIndex(
				(item) => item.id === instanceId,
			);
			if (index === -1) {
				return;
			}

			const removed = active.stack.instances[index];
			const remaining = active.stack.instances.filter(
				(item) => item.id !== instanceId,
			);
			let nextSelected = active.selectedInstanceId;
			if (nextSelected === instanceId) {
				if (remaining.length === 0) {
					nextSelected = null;
				} else {
					const fallbackIndex = Math.min(index, remaining.length - 1);
					nextSelected = remaining[fallbackIndex].id;
				}
			}

			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: remaining,
			};
			await commitNextStack(
				nextStack,
				nextSelected,
				`Remove ${getEffectLabel(removed, registry)}`,
			);
		},

		async reorderEffect(fromIndex, toIndex) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			const {instances} = active.stack;
			if (
				fromIndex === toIndex ||
				fromIndex < 0 ||
				toIndex < 0 ||
				fromIndex >= instances.length ||
				toIndex >= instances.length
			) {
				return;
			}

			const nextInstances = [...instances];
			const [moved] = nextInstances.splice(fromIndex, 1);
			nextInstances.splice(toIndex, 0, moved);

			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: nextInstances,
			};
			await commitNextStack(
				nextStack,
				active.selectedInstanceId,
				`Reorder ${getEffectLabel(moved, registry)}`,
			);
		},

		async duplicateEffect(instanceId) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			const index = active.stack.instances.findIndex(
				(item) => item.id === instanceId,
			);
			if (index === -1) {
				throw new StorageValidationError(
					`Effect instance "${instanceId}" not found`,
				);
			}

			assertStackCapacity(active.stack.instances.length + 1);
			const sourceInstance = active.stack.instances[index];
			const existingIds = new Set(
				active.stack.instances.map((item) => item.id),
			);
			const duplicate = cloneInstanceWithNewId(
				sourceInstance,
				existingIds,
				getRandomValues,
			);
			const nextInstances = [...active.stack.instances];
			nextInstances.splice(index + 1, 0, duplicate);

			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: nextInstances,
			};
			await commitNextStack(
				nextStack,
				duplicate.id,
				`Duplicate ${getEffectLabel(sourceInstance, registry)}`,
			);
			return duplicate;
		},

		async setEffectEnabled(instanceId, enabled) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			const target = active.stack.instances.find(
				(item) => item.id === instanceId,
			);
			if (!target || target.enabled === enabled) {
				return;
			}

			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: active.stack.instances.map((item) =>
					item.id === instanceId ? {...item, enabled} : item,
				),
			};
			const verb = enabled ? 'Enable' : 'Disable';
			await commitNextStack(
				nextStack,
				active.selectedInstanceId,
				`${verb} ${getEffectLabel(target, registry)}`,
			);
		},

		selectEffect(instanceId) {
			const {activeProject} = get();
			if (!activeProject) {
				return;
			}

			const nextSelected =
				instanceId !== null &&
				activeProject.stack.instances.some((item) => item.id === instanceId)
					? instanceId
					: null;
			if (activeProject.selectedInstanceId === nextSelected) {
				return;
			}

			set({
				activeProject: {
					...activeProject,
					selectedInstanceId: nextSelected,
				},
			});
			scheduleViewStateSave();
		},

		setDebugView(debugView) {
			const {activeProject} = get();
			if (!activeProject) {
				return;
			}

			const validDebug =
				debugView !== null &&
				activeProject.stack.instances.some(
					(item) => item.id === debugView.instanceId,
				)
					? debugView
					: null;
			set({debugView: validDebug});
			const effectiveStack = applyTransientDragToStack(
				activeProject.stack,
				transientStore.getState().activeDrag,
			);
			dispatchStackToCoordinator(effectiveStack, validDebug, false);
		},

		dragParam(instanceId, paramKey, value) {
			const {activeProject, debugView} = get();
			if (!activeProject) {
				return;
			}

			const target = activeProject.stack.instances.find(
				(item) => item.id === instanceId,
			);
			if (!target) {
				return;
			}

			const definition = registry.get(target.type);
			if (!definition) {
				return;
			}

			const prevDrag = transientStore.getState().activeDrag;
			const baseParams =
				prevDrag?.instanceId === instanceId
					? {...target.params, ...prevDrag.params}
					: target.params;
			const validated = validateSingleParam(
				definition,
				baseParams,
				paramKey,
				value,
			);
			const nextDrag = {
				instanceId,
				params: {
					...(prevDrag?.instanceId === instanceId && prevDrag.params),
					[paramKey]: validated[paramKey],
				},
				mix: prevDrag?.instanceId === instanceId ? prevDrag.mix : undefined,
			};
			transientStore.setState({activeDrag: nextDrag});

			const effectiveStack = applyTransientDragToStack(
				activeProject.stack,
				nextDrag,
			);
			dispatchStackToCoordinator(effectiveStack, debugView, true);
		},

		async commitParam(instanceId, paramKey, value, label) {
			if (
				pendingKeyboard?.kind === 'param' &&
				pendingKeyboard.instanceId === instanceId &&
				pendingKeyboard.paramKey === paramKey
			) {
				clearKeyboardTimer();
			} else if (pendingKeyboard) {
				await flushPendingCommitImpl();
			}

			const active = requireActiveProject();
			const target = active.stack.instances.find(
				(item) => item.id === instanceId,
			);
			if (!target) {
				transientStore.setState({activeDrag: null});
				return;
			}

			const definition = registry.get(target.type);
			if (!definition) {
				transientStore.setState({activeDrag: null});
				return;
			}

			const validated = validateSingleParam(
				definition,
				target.params,
				paramKey,
				value,
			);
			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: active.stack.instances.map((item) =>
					item.id === instanceId ? {...item, params: validated} : item,
				),
			};

			transientStore.setState({activeDrag: null});
			if (
				!get().stackNeedsWriteBack &&
				canonicalStackJson(nextStack) === canonicalStackJson(active.stack)
			) {
				coordinator.endDrag();
				return;
			}

			const paramLabel = definition.params[paramKey].label;
			await commitNextStack(
				nextStack,
				active.selectedInstanceId,
				label ?? `Change ${paramLabel}`,
			);
		},

		nudgeParam(instanceId, paramKey, value, label) {
			const {activeProject} = get();
			if (!activeProject) {
				return;
			}

			if (
				pendingKeyboard &&
				(pendingKeyboard.kind !== 'param' ||
					pendingKeyboard.instanceId !== instanceId ||
					pendingKeyboard.paramKey !== paramKey)
			) {
				void flushPendingCommitImpl();
			} else if (pendingKeyboard) {
				timerEnv.clearTimeout(pendingKeyboard.timer);
			}

			get().dragParam(instanceId, paramKey, value);
			const timer = timerEnv.setTimeout(() => {
				void flushPendingCommitImpl();
			}, KEYBOARD_COMMIT_DEBOUNCE_MS);

			pendingKeyboard = {
				kind: 'param',
				projectId: activeProject.id,
				instanceId,
				paramKey,
				value,
				label,
				timer,
			};
		},

		dragMix(instanceId, mix) {
			const {activeProject, debugView} = get();
			if (
				!activeProject ||
				activeProject.stack.instances.every((item) => item.id !== instanceId)
			) {
				return;
			}

			const normalized = normalizeMix(mix);
			const prevDrag = transientStore.getState().activeDrag;
			const nextDrag = {
				instanceId,
				params: prevDrag?.instanceId === instanceId ? prevDrag.params : {},
				mix: normalized,
			};
			transientStore.setState({activeDrag: nextDrag});

			const effectiveStack = applyTransientDragToStack(
				activeProject.stack,
				nextDrag,
			);
			dispatchStackToCoordinator(effectiveStack, debugView, true);
		},

		async commitMix(instanceId, mix) {
			if (
				pendingKeyboard?.kind === 'mix' &&
				pendingKeyboard.instanceId === instanceId
			) {
				clearKeyboardTimer();
			} else if (pendingKeyboard) {
				await flushPendingCommitImpl();
			}

			const active = requireActiveProject();
			const target = active.stack.instances.find(
				(item) => item.id === instanceId,
			);
			if (!target) {
				transientStore.setState({activeDrag: null});
				return;
			}

			const normalized = normalizeMix(mix);
			transientStore.setState({activeDrag: null});
			if (!get().stackNeedsWriteBack && target.mix === normalized) {
				coordinator.endDrag();
				return;
			}

			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: active.stack.instances.map((item) =>
					item.id === instanceId ? {...item, mix: normalized} : item,
				),
			};
			await commitNextStack(nextStack, active.selectedInstanceId, 'Change Mix');
		},

		nudgeMix(instanceId, mix) {
			const {activeProject} = get();
			if (!activeProject) {
				return;
			}

			if (
				pendingKeyboard &&
				(pendingKeyboard.kind !== 'mix' ||
					pendingKeyboard.instanceId !== instanceId)
			) {
				void flushPendingCommitImpl();
			} else if (pendingKeyboard) {
				timerEnv.clearTimeout(pendingKeyboard.timer);
			}

			get().dragMix(instanceId, mix);
			const timer = timerEnv.setTimeout(() => {
				void flushPendingCommitImpl();
			}, KEYBOARD_COMMIT_DEBOUNCE_MS);

			pendingKeyboard = {
				kind: 'mix',
				projectId: activeProject.id,
				instanceId,
				mix,
				timer,
			};
		},

		async setBlend(instanceId, blend) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			const target = active.stack.instances.find(
				(item) => item.id === instanceId,
			);
			if (!target) {
				return;
			}

			const normalized = normalizeBlend(blend);
			if (!get().stackNeedsWriteBack && target.blend === normalized) {
				return;
			}

			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: active.stack.instances.map((item) =>
					item.id === instanceId ? {...item, blend: normalized} : item,
				),
			};
			await commitNextStack(
				nextStack,
				active.selectedInstanceId,
				'Change Blend',
			);
		},

		async resetParam(instanceId, paramKey) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			const target = active.stack.instances.find(
				(item) => item.id === instanceId,
			);
			if (!target) {
				return;
			}

			const definition = registry.get(target.type);
			if (!definition || !Object.hasOwn(definition.params, paramKey)) {
				return;
			}

			const defaults = createInstanceDefaults(definition, getRandomValues);
			await get().commitParam(
				instanceId,
				paramKey,
				defaults[paramKey],
				`Reset ${definition.params[paramKey].label}`,
			);
		},

		async resetInstance(instanceId) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			const target = active.stack.instances.find(
				(item) => item.id === instanceId,
			);
			if (!target) {
				return;
			}

			const definition = registry.get(target.type);
			if (!definition) {
				return;
			}

			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: active.stack.instances.map((item) =>
					item.id === instanceId
						? {
								...item,
								version: definition.version,
								params: createInstanceDefaults(definition, getRandomValues),
								mix: 1,
								blend: 'normal',
							}
						: item,
				),
			};
			await commitNextStack(
				nextStack,
				active.selectedInstanceId,
				`Reset ${definition.label}`,
			);
		},

		cancelDrag() {
			clearKeyboardTimer();
			transientStore.setState({activeDrag: null, splitPosition: null});
			const {activeProject, debugView} = get();
			if (activeProject) {
				dispatchStackToCoordinator(activeProject.stack, debugView, false);
			}
		},

		flushPendingCommit: flushPendingCommitImpl,

		async undo() {
			await flushPendingCommitImpl();
			const active = get().activeProject;
			if (!active) {
				return false;
			}

			const result = await repository.undo(active.id);
			if (!result) {
				return false;
			}

			const resolved = resolveStoredStack(result.project.stack, registry);
			const nextProject: ProjectRecord = {
				...active,
				stack: resolved.stack,
				selectedInstanceId: result.project.selectedInstanceId,
				historyHeadSeq: result.project.historyHeadSeq,
				historyMinSeq: result.project.historyMinSeq,
				historyMaxSeq: result.project.historyMaxSeq,
				updatedAt: result.project.updatedAt,
			};

			const currentDebug = get().debugView;
			const nextDebugView =
				currentDebug &&
				nextProject.stack.instances.some(
					(item) => item.id === currentDebug.instanceId,
				)
					? currentDebug
					: null;

			transientStore.setState({activeDrag: null});
			set((state) => ({
				activeProject: nextProject,
				projects: upsertProject(state.projects, nextProject),
				stackNeedsWriteBack: resolved.needsWriteBack,
				stackEnvelopeStatus: resolved.envelopeStatus,
				unsupportedInstances: resolved.unsupportedInstances,
				debugView: nextDebugView,
			}));

			dispatchStackToCoordinator(nextProject.stack, nextDebugView, false);
			return true;
		},

		async redo() {
			await flushPendingCommitImpl();
			const active = get().activeProject;
			if (!active) {
				return false;
			}

			const result = await repository.redo(active.id);
			if (!result) {
				return false;
			}

			const resolved = resolveStoredStack(result.project.stack, registry);
			const nextProject: ProjectRecord = {
				...active,
				stack: resolved.stack,
				selectedInstanceId: result.project.selectedInstanceId,
				historyHeadSeq: result.project.historyHeadSeq,
				historyMinSeq: result.project.historyMinSeq,
				historyMaxSeq: result.project.historyMaxSeq,
				updatedAt: result.project.updatedAt,
			};

			const currentDebug = get().debugView;
			const nextDebugView =
				currentDebug &&
				nextProject.stack.instances.some(
					(item) => item.id === currentDebug.instanceId,
				)
					? currentDebug
					: null;

			transientStore.setState({activeDrag: null});
			set((state) => ({
				activeProject: nextProject,
				projects: upsertProject(state.projects, nextProject),
				stackNeedsWriteBack: resolved.needsWriteBack,
				stackEnvelopeStatus: resolved.envelopeStatus,
				unsupportedInstances: resolved.unsupportedInstances,
				debugView: nextDebugView,
			}));

			dispatchStackToCoordinator(nextProject.stack, nextDebugView, false);
			return true;
		},

		async applyPreset(presetId) {
			await flushPendingCommitImpl();
			requireActiveProject();
			const preset =
				getBuiltinPreset(presetId) ??
				get().presets.find((item) => item.id === presetId);
			if (!preset) {
				throw new StorageValidationError(`Preset "${presetId}" not found`);
			}

			const nextStack = cloneStackWithNewIds(
				preset.stack,
				undefined,
				getRandomValues,
			);
			const selectedId = nextStack.instances[0]?.id ?? null;
			await commitNextStack(nextStack, selectedId, `Apply ${preset.name}`);
		},

		async addPresetToStack(presetId) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			const preset =
				getBuiltinPreset(presetId) ??
				get().presets.find((item) => item.id === presetId);
			if (!preset) {
				throw new StorageValidationError(`Preset "${presetId}" not found`);
			}

			assertStackCapacity(
				active.stack.instances.length + preset.stack.instances.length,
			);
			const existingIds = new Set(
				active.stack.instances.map((item) => item.id),
			);
			const cloned = cloneStackWithNewIds(
				preset.stack,
				existingIds,
				getRandomValues,
			);
			const nextStack: EffectStack = {
				schemaVersion: active.stack.schemaVersion,
				instances: [...active.stack.instances, ...cloned.instances],
			};
			const selectedId = cloned.instances[0]?.id ?? active.selectedInstanceId;
			await commitNextStack(nextStack, selectedId, `Add ${preset.name}`);
		},

		async saveStackAsPreset(name) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			try {
				const created = await repository.createPreset({
					name,
					stack: cloneEffectStack(active.stack),
				});
				set((state) => ({
					presets: sortPresetsByName([...state.presets, created]),
				}));
				return created;
			} catch (error) {
				handleQuotaError(error);
				throw error;
			}
		},

		async renameUserPreset(id, name) {
			if (id.startsWith('builtin:')) {
				throw new StorageValidationError('Built-in presets cannot be renamed');
			}

			const updated = await repository.renamePreset(id, name);
			set((state) => ({
				presets: sortPresetsByName(
					state.presets.map((item) => (item.id === id ? updated : item)),
				),
			}));
			return updated;
		},

		async deleteUserPreset(id) {
			if (id.startsWith('builtin:')) {
				throw new StorageValidationError('Built-in presets cannot be deleted');
			}

			const deleted = await repository.deletePreset(id);
			if (deleted) {
				set((state) => ({
					presets: state.presets.filter((item) => item.id !== id),
				}));
			}

			return deleted;
		},

		setViewState(patch, options) {
			const {activeProject} = get();
			if (!activeProject) {
				return;
			}

			const nextViewState = normalizeViewState({
				...activeProject.viewState,
				...patch,
			});
			set({
				activeProject: {
					...activeProject,
					viewState: nextViewState,
				},
			});
			syncCoordinatorViewScale(nextViewState, options?.devicePixelRatio);
			scheduleViewStateSave();
		},

		dragSplitPosition(position) {
			const clamped = Number.isFinite(position)
				? Math.min(1, Math.max(0, position))
				: 0.5;
			transientStore.setState({splitPosition: clamped});
		},

		commitSplitPosition(position) {
			transientStore.setState({splitPosition: null});
			get().setViewState({splitPosition: position});
		},

		flushViewState: flushViewStateImpl,

		async setCompareMode(mode) {
			set({compareMode: mode});
			try {
				await repository.updateAppState({compareMode: mode});
			} catch (error) {
				handleQuotaError(error);
			}
		},

		async setTheme(theme) {
			syncTheme(theme);
			set({theme});
			try {
				await repository.updateAppState({theme});
			} catch (error) {
				handleQuotaError(error);
			}
		},

		async updateExportSettings(settings) {
			const active = requireActiveProject();
			try {
				const updated = await repository.updateExportSettings(
					active.id,
					settings,
				);
				set((state) => ({
					activeProject:
						state.activeProjectId === updated.id
							? {
									...state.activeProject!,
									exportSettings: updated.exportSettings,
								}
							: state.activeProject,
					projects: upsertProject(state.projects, updated),
				}));
				return updated;
			} catch (error) {
				handleQuotaError(error);
				throw error;
			}
		},

		async syncFromHash() {
			const parsed = parseHashRoute(routerEnv.getHash());
			const current = get().route;

			if (parsed.screen === 'gallery') {
				if (current.screen !== 'gallery') {
					await flushPendingCommitImpl();
					await flushViewStateImpl();
					set({route: parsed});
				}

				return;
			}

			if (parsed.screen === 'library') {
				if (get().activeProjectId !== null || current.screen !== 'library') {
					await get().closeProject({updateHash: false});
				}

				return;
			}

			if (
				current.screen === 'editor' &&
				current.projectId === parsed.projectId &&
				get().activeProjectId === parsed.projectId
			) {
				return;
			}

			await get().openProject(parsed.projectId, {updateHash: false});
		},

		attachListeners() {
			detachCoordinator?.();
			detachRouter?.();
			detachLifecycle?.();

			detachCoordinator = coordinator.subscribe(onCoordinatorEvent);
			detachRouter = routerEnv.addHashChangeListener(() => {
				void get().syncFromHash();
			});
			detachLifecycle = timerEnv.addLifecycleListeners(() => {
				void flushPendingCommitImpl();
				void flushViewStateImpl();
			});

			return () => {
				detachCoordinator?.();
				detachCoordinator = null;
				detachRouter?.();
				detachRouter = null;
				detachLifecycle?.();
				detachLifecycle = null;
			};
		},

		dispose() {
			if (disposed) {
				return;
			}

			disposed = true;
			clearViewStateTimer();
			clearKeyboardTimer();
			detachCoordinator?.();
			detachCoordinator = null;
			detachRouter?.();
			detachRouter = null;
			detachLifecycle?.();
			detachLifecycle = null;
		},
	}));

	return {
		store,
		transientStore,
		repository,
		coordinator,
		dispose() {
			store.getState().dispose();
		},
	};
}
