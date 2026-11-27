import {createStore, type StoreApi} from 'zustand/vanilla';
import {effectRegistry} from '../engine/effects/index.ts';
import {validateParams} from '../engine/params.ts';
import {transformKey, type SourceTransform} from '../engine/transform.ts';
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
import {renderSourceFor} from '../render/render-source.ts';
import type {
	BackupOptions,
	BackupOutput,
	ExportBackupOptions,
} from '../storage/backup-format.ts';
import {
	backupImportSummary,
	type BackupImportResult,
	type BackupInspection,
	type BackupSelection,
} from '../storage/backup-transfer.ts';
import {
	geometryForWrite,
	repairProjectGeometry,
	resolveStoredGeometry,
} from '../storage/geometry.ts';
import {
	hashBlobSha256,
	normalizeViewState,
	withSideA,
} from '../storage/helpers.ts';
import {
	resolveProjectStacks,
	type UnsupportedInstanceInfo,
} from '../storage/migrations.ts';
import type {ProjectFileOutput} from '../storage/project-format.ts';
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
	type ExportProjectOptions,
	type ExportSettings,
	type HistoryEntryRecord,
	type ImportProjectOptions,
	type NewSource,
	type ProjectRecord,
	type SourceRecord,
	type SplitOrientation,
	type SplitSide,
	type StorageRepository,
	type ThemePreference,
	type ThumbnailRecord,
	type UserPresetRecord,
	type ViewState,
	type HistoryStepResult,
} from '../storage/types.ts';
import {
	formatBlendCommitLabel,
	formatMixCommitLabel,
	formatParamCommitLabel,
	formatTransformCommitLabel,
} from './commit-labels.ts';
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
import {createSideRenderer} from './side-renderer.ts';
import {
	EMPTY_STACK,
	findInstanceSide,
	otherSide,
	projectInstanceIds,
	selectEditingSide,
	selectSplitChosen,
	sideHistoryLabel,
	sideLetter,
	sideSelectedId,
	sideStack,
} from './split-sides.ts';
import {createCropPreview} from './crop-preview.ts';
import {CLOSED_GEOMETRY} from './geometry.ts';
import {useThemeStore} from './theme.ts';
import {
	createCanvasThumbnailGenerator,
	thumbnailSignature,
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

export function invalidGeometryNotice(projectName: string): string {
	return `The saved crop, rotation and size of ${projectName} were invalid and have been reset.`;
}

export function unsupportedEffectsNotice(
	projectName: string,
	count: number,
): string {
	return `Opened ${projectName} with ${count} unsupported effect(s).`;
}

// The notice for a stored transform that this project's source cannot take.
function geometryNotice(
	{name, sourceWidth, sourceHeight}: ProjectRecord,
	stored: unknown,
): string | null {
	return resolveStoredGeometry(sourceWidth, sourceHeight, stored).repaired
		? invalidGeometryNotice(name)
		: null;
}

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
	databaseClosedByUpgrade: boolean;
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
	// Renders split side A and the crop preview. Absent: neither is rendered.
	createSideCoordinator?: () => RenderCoordinator;
	registry?: EffectRegistry;
	routerEnv?: HashRouterEnv;
	timerEnv?: AppStoreTimerEnv;
	storageManager?: StorageManagerLike;
	thumbnailGenerator?: ThumbnailGenerator;
	transientStore?: TransientStore;
	getRandomValues?: RandomBytesSource;
	syncTheme?: (theme: ThemePreference) => void;
};

// What an `image` parameter is set to: a stored source (`''` for none), or an
// image from the device that the same commit stores.
export type ImageChoice =
	{readonly sha256: string} | {readonly image: Omit<NewSource, 'sha256'>};

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
	// Transient pinned history step for F31 comparison (not persisted).
	compareHistorySeq: number | null;
	// The mode to return to when pinning a step turned the split view on.
	compareHistoryRestoreMode: CompareMode | null;
	stackNeedsWriteBack: boolean;
	stackEnvelopeStatus: 'ok' | 'newer-version';
	unsupportedInstances: UnsupportedInstanceInfo[];
	debugView: DebugViewTarget | null;

	builtinPresets: readonly BuiltinPreset[];
	presets: UserPresetRecord[];
	compareMode: CompareMode;
	theme: ThemePreference;
	welcomeDismissed: boolean;

	storage: StorageStatus;
	// Side B, the main stack.
	render: RenderStatus;
	// Split side A. Idle while that side is hidden or empty.
	renderA: RenderStatus;
	// The rotated and flipped source without effects, while crop mode is on.
	cropSource: SourceInfo | undefined;

	// Internal / restore hydration
	hydrateFromRestore(payload: {
		projects: ProjectRecord[];
		presets: UserPresetRecord[];
		theme: ThemePreference;
		compareMode: CompareMode;
		welcomeDismissed?: boolean;
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
	markDatabaseClosedByUpgrade(): void;
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
	// The project file of `id`, holding every edit made so far.
	exportProjectFile(
		id: string,
		options?: ExportProjectOptions,
	): Promise<ProjectFileOutput>;
	// Adds the file's project to the library and opens it, unless `setActive` is
	// `false`. Rejects as `StorageRepository.importProjectFile` does.
	importProjectFile(
		file: Blob,
		fileName: string,
		options?: ImportProjectOptions,
	): Promise<CreateProjectResult>;

	// Backup and restore. Export and inspection see every edit made so far, and
	// all of them reject as the repository method of the same name does.
	exportBackup(options?: ExportBackupOptions): Promise<BackupOutput>;
	getSourceSizes(): Promise<Record<string, number>>;
	inspectBackup(file: Blob, options?: BackupOptions): Promise<BackupInspection>;
	// Reloads the library and settings; a Replace also leaves the editor.
	importBackup(
		backup: BackupInspection,
		selection: BackupSelection,
		options?: BackupOptions,
	): Promise<BackupImportResult>;

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
	commitInstanceParams(
		instanceId: string,
		params: Readonly<Record<string, ParamValue>>,
		label: string,
	): Promise<void>;
	// Sets an `image` parameter as one history entry. `false` when nothing
	// changed or the project or the instance is gone. Rejects as `commitStack`
	// does, and then nothing was stored.
	commitImageParam(
		projectId: string,
		instanceId: string,
		paramKey: string,
		choice: ImageChoice,
	): Promise<boolean>;
	cancelDrag(): void;
	flushPendingCommit(): Promise<void>;

	// Undo / redo
	undo(): Promise<boolean>;
	redo(): Promise<boolean>;
	jumpToHistory(projectId: string, seq: number): Promise<boolean>;
	setCompareHistorySeq(seq: number | null): void;
	clearCompareHistory(): void;

	// Geometry. One history entry; `false` when nothing changed or the project
	// is not the active one.
	setTransform(
		projectId: string,
		transform: SourceTransform,
		label?: string,
	): Promise<boolean>;

	// Split sides
	setEditSide(side: SplitSide): Promise<void>;
	setSplitOrientation(orientation: SplitOrientation): void;
	copyToOtherSide(): Promise<void>;
	swapSides(): Promise<void>;
	setRenderViewScale(devicePixelsPerSourcePixel: number): void;
	retryRender(): void;

	// Presets
	/**
	 Replaces the edited side's stack with a copy of `stack`, as one history
	 entry named `label`.
	 */
	applyStack(stack: EffectStack, label: string): Promise<void>;
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
	dismissWelcome(): Promise<void>;
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

function applyRenderEvent(
	render: RenderStatus,
	event: RenderEvent,
): RenderStatus {
	switch (event.type) {
		case 'source': {
			return {
				...render,
				source: event.source,
				frame: event.source ? render.frame : undefined,
				full: event.source ? render.full : undefined,
			};
		}

		case 'frame': {
			return {...render, frame: event.frame, error: null};
		}

		case 'full': {
			return {...render, full: event.full};
		}

		case 'busy': {
			return {
				...render,
				busy: {...render.busy, [event.level]: event.busy},
				progress: event.busy
					? render.progress
					: {...render.progress, [event.level]: 0},
			};
		}

		case 'progress': {
			return {
				...render,
				progress: {...render.progress, [event.level]: event.fraction},
			};
		}

		case 'error': {
			return {...render, error: event.error, failed: event.failed};
		}
	}
}

function stackHas(stack: EffectStack, instanceId: string | undefined): boolean {
	return stack.instances.some((item) => item.id === instanceId);
}

// The debug view, while its instance is on either side.
function keepDebugView(
	debugView: DebugViewTarget | null,
	project: ProjectRecord,
): DebugViewTarget | null {
	return debugView && findInstanceSide(project, debugView.instanceId)
		? debugView
		: null;
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

// Every project enters the list here, so all of them hold a valid geometry.
function sortProjectsByOpenedAt(projects: ProjectRecord[]): ProjectRecord[] {
	return projects
		.map((project) => repairProjectGeometry(project))
		.toSorted((a, b) => b.openedAt - a.openedAt);
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

export function selectCompareHistoryEntry(
	state: Pick<AppState, 'history' | 'compareHistorySeq'>,
): HistoryEntryRecord | null {
	if (state.compareHistorySeq === null) {
		return null;
	}

	return (
		state.history.find((entry) => entry.seq === state.compareHistorySeq) ?? null
	);
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
	let editQueue: Promise<unknown> = Promise.resolve();
	let disposed = false;
	let unsubscribeSideA: (() => void) | null = null;
	let lastSideInputs: readonly unknown[] = [];

	const loadExtraSource = async (sha256: string) =>
		repository.getSource(sha256);
	coordinator.setExtraSourceLoader(loadExtraSource);

	const sideRenderer = createSideRenderer({
		createCoordinator: deps.createSideCoordinator,
		loadExtraSource,
		onEvent(event) {
			store.setState((state) => ({
				renderA: applyRenderEvent(state.renderA, event),
			}));
		},
		onClose() {
			store.setState({renderA: createDefaultRenderStatus()});
		},
	});

	// The state change that unpins a history step.
	const releaseHistoryCompare = () => {
		const restoreMode = store.getState().compareHistoryRestoreMode;
		return {
			compareHistorySeq: null,
			compareHistoryRestoreMode: null,
			...(restoreMode !== null && {compareMode: restoreMode}),
		};
	};

	// Side A follows the state, so every path that changes it is covered.
	// When a history step is pinned (F31), sideRenderer renders that snapshot
	// instead of side A's stack.
	const syncSideA = () => {
		const {
			activeProject,
			activeSource,
			compareMode,
			debugView,
			history,
			compareHistorySeq,
		} = store.getState();
		const source =
			activeSource && activeSource.sha256 === activeProject?.sourceHash
				? activeSource
				: null;

		const pinnedEntry =
			compareHistorySeq === null
				? null
				: (history.find((entry) => entry.seq === compareHistorySeq) ?? null);
		if (pinnedEntry) {
			const pinnedTransform =
				activeProject &&
				resolveStoredGeometry(
					activeProject.sourceWidth,
					activeProject.sourceHeight,
					pinnedEntry.transform,
				).transform;
			const sameTransform =
				activeProject !== null &&
				pinnedTransform !== null &&
				transformKey(pinnedTransform) === transformKey(activeProject.transform);
			const needsRender =
				pinnedEntry.stack.instances.length > 0 || !sameTransform;
			const inputs = [
				'history',
				pinnedEntry.seq,
				pinnedEntry.stack,
				pinnedEntry.transform,
				source,
				activeProject?.transform,
			];
			if (inputs.every((value, index) => value === lastSideInputs[index])) {
				return;
			}

			lastSideInputs = inputs;
			if (!source || !pinnedTransform || !needsRender) {
				sideRenderer.sync(null);
				return;
			}

			sideRenderer.sync({
				source: {
					key: source.sha256,
					blob: source.blob,
					width: source.width,
					height: source.height,
					transform: pinnedTransform,
				},
				request: {
					stack: pinnedEntry.stack,
				},
				dragging: false,
			});
			return;
		}

		const stack = activeProject?.stackA;
		const {activeDrag} = transientStore.getState();
		const drag =
			stack && stackHas(stack, activeDrag?.instanceId) ? activeDrag : null;
		const visible = compareMode === 'split';
		const transform = activeProject?.transform;
		const inputs = [
			'sideA',
			stack,
			source,
			visible,
			debugView,
			drag,
			transform,
		];
		if (inputs.every((value, index) => value === lastSideInputs[index])) {
			return;
		}

		lastSideInputs = inputs;
		if (!visible || !source || !stack || stack.instances.length === 0) {
			sideRenderer.sync(null);
			return;
		}

		sideRenderer.sync({
			// Side A shows the same transformed source as side B.
			source: activeProject
				? renderSourceFor(activeProject, source)
				: {
						key: source.sha256,
						blob: source.blob,
						width: source.width,
						height: source.height,
					},
			request: {
				stack: applyTransientDragToStack(stack, drag),
				debug:
					debugView && stackHas(stack, debugView.instanceId)
						? debugView
						: undefined,
			},
			dragging: drag !== null,
		});
	};

	const cropPreview = createCropPreview({
		createCoordinator: deps.createSideCoordinator,
		onSource(cropSource) {
			store.setState({cropSource});
		},
	});
	let lastCropInputs: readonly unknown[] = [];

	const syncCropPreview = () => {
		const {activeProject, activeSource, compareHistorySeq} = store.getState();
		const {cropping} = transientStore.getState().geometry;
		if (cropping && compareHistorySeq !== null) {
			store.getState().clearCompareHistory();
		}

		const inputs = [cropping, activeSource, activeProject?.transform];
		if (inputs.every((value, index) => value === lastCropInputs[index])) {
			return;
		}

		lastCropInputs = inputs;
		cropPreview.sync(
			cropping &&
				activeProject &&
				activeSource?.sha256 === activeProject.sourceHash
				? renderSourceFor(activeProject, activeSource)
				: null,
		);
	};

	const closeGeometry = () => {
		if (transientStore.getState().geometry !== CLOSED_GEOMETRY) {
			transientStore.setState({geometry: CLOSED_GEOMETRY});
		}
	};

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
				debug:
					debugView && stackHas(stack, debugView.instanceId)
						? debugView
						: undefined,
			},
			dragging ? {dragging: true} : undefined,
		);
	};

	const setRenderViewScale = (scale: number) => {
		coordinator.setViewScale(scale);
		sideRenderer.setViewScale(scale);
	};

	const syncCoordinatorViewScale = (
		viewState: ViewState,
		devicePixelRatio?: number,
	) => {
		const dpr = devicePixelRatio ?? timerEnv.getDevicePixelRatio();
		setRenderViewScale(viewState.zoom * dpr);
	};

	const maybeCaptureThumbnail = (frame: Frame) => {
		// A frame still waiting for an extra source is not what the stack looks like.
		if (frame.level !== 'settle' || frame.sourcesPending || disposed) {
			return;
		}

		const state = store.getState();
		const {activeProject, debugView} = state;
		if (
			!activeProject ||
			stackHas(activeProject.stack, debugView?.instanceId) ||
			stackHas(
				activeProject.stack,
				transientStore.getState().activeDrag?.instanceId,
			)
		) {
			return;
		}

		const stackSignature = thumbnailSignature(activeProject);
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
		store.setState((state) => ({
			render: applyRenderEvent(state.render, event),
		}));
		if (event.type === 'frame') {
			maybeCaptureThumbnail(event.frame);
		}
	};

	const requireActiveProject = (): ProjectRecord => {
		const {activeProject} = store.getState();
		if (!activeProject) {
			throw new StorageValidationError('No active project');
		}

		return activeProject;
	};

	// Hands the active project's geometry to the preview. The coordinator ignores
	// an unchanged one; side A follows the state by itself.
	const renderGeometry = () => {
		const {activeProject, activeSource} = store.getState();
		if (activeProject && activeSource?.sha256 === activeProject.sourceHash) {
			coordinator.setSource(renderSourceFor(activeProject, activeSource));
		}
	};

	// Writes both sides and the geometry as one history entry.
	const commitSides = async (
		next: Pick<
			ProjectRecord,
			'stack' | 'selectedInstanceId' | 'stackA' | 'selectedInstanceIdA'
		>,
		label: string,
		changesMain: boolean,
		transform?: SourceTransform,
		newSource?: NewSource,
	): Promise<ProjectRecord> => {
		const active = requireActiveProject();

		try {
			const {project, entry} = await repository.commitStack({
				projectId: active.id,
				stack: next.stack,
				selectedInstanceId: next.selectedInstanceId,
				stackA: next.stackA ?? EMPTY_STACK,
				selectedInstanceIdA: next.selectedInstanceIdA ?? null,
				transform,
				label,
				newSource,
			});

			const currentState = store.getState();
			const trimmedHistory = currentState.history
				.filter((item) => item.seq <= active.historyHeadSeq)
				.concat(entry)
				.filter((item) => item.seq >= project.historyMinSeq);

			const nextDebugView = keepDebugView(currentState.debugView, project);
			const draggingMain = stackHas(
				active.stack,
				transientStore.getState().activeDrag?.instanceId,
			);

			// The new stack lands before the drag overlay goes, so no render ever
			// sees the old committed value.
			const pinnedDropped =
				currentState.compareHistorySeq !== null &&
				(currentState.compareHistorySeq > active.historyHeadSeq ||
					currentState.compareHistorySeq < project.historyMinSeq);
			store.setState((state) => {
				// The open project's view state lives here: a save that started
				// during the commit leaves the stored copy older.
				const nextProject: ProjectRecord =
					state.activeProject?.id === project.id
						? {...project, viewState: state.activeProject.viewState}
						: project;
				return {
					activeProject: nextProject,
					projects: upsertProject(state.projects, nextProject),
					history: trimmedHistory,
					...(pinnedDropped && releaseHistoryCompare()),
					stackNeedsWriteBack: false,
					debugView: nextDebugView,
				};
			});
			transientStore.setState({
				activeDrag: null,
				...(pinnedDropped && {compareLatched: false, compareHolding: false}),
			});
			if (transform) {
				renderGeometry();
			}

			if (
				changesMain ||
				draggingMain ||
				nextDebugView !== currentState.debugView
			) {
				dispatchStackToCoordinator(project.stack, nextDebugView, false);
			}

			return project;
		} catch (error) {
			transientStore.setState({activeDrag: null});
			handleQuotaError(error);
			throw error;
		}
	};

	// The active project's two sides with one of them replaced.
	const withSide = (
		project: ProjectRecord,
		side: SplitSide,
		stack: EffectStack,
		selectedInstanceId: string | null,
	) =>
		side === 'a'
			? {
					stack: project.stack,
					selectedInstanceId: project.selectedInstanceId,
					stackA: stack,
					selectedInstanceIdA: selectedInstanceId,
				}
			: {
					stack,
					selectedInstanceId,
					stackA: project.stackA,
					selectedInstanceIdA: project.selectedInstanceIdA,
				};

	const commitNextStack = async (
		side: SplitSide,
		nextStack: EffectStack,
		selectedInstanceId: string | null,
		label: string,
		newSource?: NewSource,
	): Promise<ProjectRecord> => {
		const active = requireActiveProject();
		assertStackCapacity(nextStack.instances.length);
		return commitSides(
			withSide(active, side, nextStack, selectedInstanceId),
			sideHistoryLabel(label, side, selectSplitChosen(store.getState())),
			side === 'b',
			undefined,
			newSource,
		);
	};

	// The side, stack and instance an instance id belongs to.
	const locateInstance = (project: ProjectRecord, instanceId: string) => {
		const side = findInstanceSide(project, instanceId);
		if (!side) {
			return null;
		}

		const stack = sideStack(project, side);
		return {
			side,
			stack,
			selectedId: sideSelectedId(project, side),
			target: stack.instances.find((item) => item.id === instanceId)!,
		};
	};

	const applyHistoryStep = (
		active: ProjectRecord,
		result: HistoryStepResult | null,
	): boolean => {
		if (!result) {
			return false;
		}

		// The view state may have changed while the step was being written.
		const latest = store.getState().activeProject;
		const base = latest?.id === active.id ? latest : active;
		const resolved = resolveProjectStacks(result.project, registry);
		const nextProject = withSideA<ProjectRecord>(
			{
				...base,
				stack: resolved.project.stack,
				selectedInstanceId: result.project.selectedInstanceId,
				transform: result.project.transform,
				effectiveWidth: result.project.effectiveWidth,
				effectiveHeight: result.project.effectiveHeight,
				historyHeadSeq: result.project.historyHeadSeq,
				historyMinSeq: result.project.historyMinSeq,
				historyMaxSeq: result.project.historyMaxSeq,
				updatedAt: result.project.updatedAt,
			},
			resolved.project.stackA,
			result.project.selectedInstanceIdA,
		);

		const currentDebug = store.getState().debugView;
		const nextDebugView = keepDebugView(currentDebug, nextProject);
		const wasDragging = transientStore.getState().activeDrag !== null;
		const notice = geometryNotice(active, result.entry.transform);

		const hadCompareHistory = store.getState().compareHistorySeq !== null;
		transientStore.setState({
			activeDrag: null,
			...(hadCompareHistory && {compareLatched: false, compareHolding: false}),
		});
		store.setState((state) => ({
			activeProject: nextProject,
			projects: upsertProject(state.projects, nextProject),
			...(hadCompareHistory && releaseHistoryCompare()),
			stackNeedsWriteBack: resolved.needsWriteBack,
			stackEnvelopeStatus: resolved.envelopeStatus,
			unsupportedInstances: resolved.unsupportedInstances,
			debugView: nextDebugView,
			...(notice && {notice}),
		}));
		if (transformKey(base.transform) !== transformKey(nextProject.transform)) {
			renderGeometry();
		}

		if (
			wasDragging ||
			nextDebugView !== currentDebug ||
			// Compare with the stack in state now, not the one captured before the
			// await: an overlapping undo may already have sent another stack.
			canonicalStackJson(nextProject.stack) !== canonicalStackJson(base.stack)
		) {
			dispatchStackToCoordinator(nextProject.stack, nextDebugView, false);
		}

		return true;
	};

	const patchViewState = (patch: Partial<ViewState>) => {
		const {activeProject} = store.getState();
		if (!activeProject) {
			return;
		}

		store.setState({
			activeProject: {
				...activeProject,
				viewState: normalizeViewState({...activeProject.viewState, ...patch}),
			},
		});
		scheduleViewStateSave();
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
				activeProject.selectedInstanceIdA,
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

	// After a saved import: asks for persistent storage once and ends the first
	// launch.
	const finishFirstImport = async (): Promise<void> => {
		if (!persistenceRequested) {
			persistenceRequested = true;
			requestPersistentStorage(deps.storageManager, (persisted) => {
				if (!disposed) {
					store.setState((state) => ({
						storage: {...state.storage, persisted},
					}));
				}
			});
		}

		if (!store.getState().welcomeDismissed) {
			// A first import ends the first launch, saved or not.
			await store
				.getState()
				.dismissWelcome()
				.catch(() => {});
		}
	};

	const commitHeldKeys = async (): Promise<void> => {
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

	// Commits a held keyboard change and waits for every edit still being written.
	const flushPendingCommitImpl = async (): Promise<void> => {
		await commitHeldKeys();
		await editQueue;
	};

	// Runs `edit` after the held keyboard change and every edit asked for before
	// it. An edit reads the project, writes it, then updates the state, so one
	// started during another's write would build on the old stack and drop it.
	// `edit` must not call another queued action: that would never finish.
	const editInOrder = async <T>(edit: () => T | Promise<T>): Promise<T> => {
		const held = commitHeldKeys();
		const result = editQueue.then(async () => {
			await held;
			return edit();
		});
		editQueue = result.catch(() => {});
		return result;
	};

	const loadActiveProjectResources = async (
		project: ProjectRecord,
		requestId: number,
	) => {
		const resolved = resolveProjectStacks(project, registry);
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

		const hydratedProject = resolved.project;

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

		coordinator.setSource(renderSourceFor(hydratedProject, source));
		dispatchStackToCoordinator(hydratedProject.stack, null, false);
		syncCoordinatorViewScale(hydratedProject.viewState);
	};

	// Cancels the open project's pending saves and loads, as its records are
	// about to go.
	const abandonActiveProjectWork = () => {
		clearKeyboardTimer();
		clearViewStateTimer();
		viewStateDirty = false;
		openProjectRequestId++;
	};

	// Closes the open project without saving it and shows `route`.
	const dropActiveProject = (route: AppRoute) => {
		transientStore.setState({
			activeDrag: null,
			splitPosition: null,
			compareLatched: false,
			compareHolding: false,
		});
		store.setState({
			activeProjectId: null,
			activeProject: null,
			activeSource: null,
			activeThumbnail: null,
			history: [],
			...releaseHistoryCompare(),
			stackNeedsWriteBack: false,
			stackEnvelopeStatus: 'ok',
			unsupportedInstances: [],
			debugView: null,
			route,
		});
		coordinator.setSource(undefined);
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
		compareHistorySeq: null,
		compareHistoryRestoreMode: null,
		stackNeedsWriteBack: false,
		stackEnvelopeStatus: 'ok',
		unsupportedInstances: [],
		debugView: null,

		builtinPresets: BUILTIN_PRESETS,
		presets: [],
		compareMode: 'toggle',
		theme: 'system',
		welcomeDismissed: false,

		storage: {
			storageUnavailable: false,
			estimate: {usage: null, quota: null, available: null},
			persisted: false,
			quotaFull: false,
			databaseClosedByUpgrade: false,
			versionErrorMessage: null,
		},
		render: createDefaultRenderStatus(),
		renderA: createDefaultRenderStatus(),
		cropSource: undefined,

		hydrateFromRestore(payload) {
			const stored = payload.activeProject;
			const resolved = stored
				? resolveProjectStacks(repairProjectGeometry(stored), registry)
				: null;
			const activeProject = resolved?.project ?? null;

			set((state) => ({
				bootStatus: 'ready',
				projects: sortProjectsByOpenedAt(payload.projects),
				presets: sortPresetsByName(payload.presets),
				theme: payload.theme,
				compareMode: payload.compareMode,
				welcomeDismissed: payload.welcomeDismissed ?? false,
				route: payload.route,
				// Keep both: a restore notice must not hide a geometry reset.
				notice:
					[
						payload.notice,
						stored ? geometryNotice(stored, stored.transform) : null,
					]
						.filter(Boolean)
						.join(' ') || null,
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

		markDatabaseClosedByUpgrade() {
			set((state) => ({
				storage: {...state.storage, databaseClosedByUpgrade: true},
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
				await finishFirstImport();

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
						transform: result.project.transform,
						createdAt: result.project.createdAt,
					};
					transientStore.setState({
						activeDrag: null,
						splitPosition: null,
						compareLatched: false,
						compareHolding: false,
					});
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
						...releaseHistoryCompare(),
						stackNeedsWriteBack: false,
						stackEnvelopeStatus: 'ok',
						unsupportedInstances: [],
						debugView: null,
						route: nextRoute,
					});
					routerEnv.setHash(formatHashRoute(nextRoute));
					coordinator.setSource(renderSourceFor(result.project, result.source));
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
				transientStore.setState({
					activeDrag: null,
					splitPosition: null,
					compareLatched: false,
					compareHolding: false,
				});
				set({
					activeProjectId: null,
					activeProject: null,
					activeSource: null,
					activeThumbnail: null,
					history: [],
					...releaseHistoryCompare(),
					debugView: null,
					route: libraryRoute,
					notice: MISSING_PROJECT_NOTICE,
				});
				coordinator.setSource(undefined);
				routerEnv.replaceHash(formatHashRoute(libraryRoute));
				return null;
			}

			const stored = await repository.openProject(id);
			const opened = repairProjectGeometry(stored);
			const nextRoute: AppRoute = {screen: 'editor', projectId: opened.id};
			transientStore.setState({
				activeDrag: null,
				splitPosition: null,
				compareLatched: false,
				compareHolding: false,
			});
			openProjectRequestId++;
			const requestId = openProjectRequestId;

			set((state) => ({
				projects: upsertProject(state.projects, opened),
				activeProjectId: opened.id,
				activeProject: opened,
				activeThumbnail: null,
				...releaseHistoryCompare(),
				debugView: null,
				route: nextRoute,
				// A notice still waiting to be shown stays.
				notice:
					[state.notice, geometryNotice(stored, stored.transform)]
						.filter(Boolean)
						.join(' ') || null,
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
			transientStore.setState({
				activeDrag: null,
				splitPosition: null,
				compareLatched: false,
				compareHolding: false,
			});
			const nextRoute: AppRoute = {screen: 'library'};

			set({
				activeProjectId: null,
				activeProject: null,
				activeSource: null,
				activeThumbnail: null,
				history: [],
				...releaseHistoryCompare(),
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
				abandonActiveProjectWork();
			}

			const result = await repository.deleteProject(id);
			set((state) => ({
				projects: state.projects.filter((item) => item.id !== id),
			}));

			if (wasActive) {
				const nextRoute: AppRoute = {screen: 'library'};
				dropActiveProject(nextRoute);
				routerEnv.replaceHash(formatHashRoute(nextRoute));
			}

			return result;
		},

		async exportProjectFile(id, options) {
			if (get().activeProjectId === id) {
				await flushPendingCommitImpl();
				await flushViewStateImpl();
			}

			return repository.exportProjectFile(id, options);
		},

		async importProjectFile(file, fileName, options = {}) {
			await flushPendingCommitImpl();
			await flushViewStateImpl();

			try {
				const result = await repository.importProjectFile(
					file,
					fileName,
					options,
				);
				await finishFirstImport();
				set((state) => ({
					projects: upsertProject(state.projects, result.project),
				}));
				if (options.setActive ?? true) {
					await get().openProject(result.project.id);
				}

				const {unsupportedInstances} = resolveProjectStacks(
					result.project,
					registry,
				);
				if (unsupportedInstances.length > 0) {
					const added = unsupportedEffectsNotice(
						result.project.name,
						unsupportedInstances.length,
					);
					// Several files may be opened at once: keep every notice.
					set(({notice}) => ({
						notice: notice ? `${notice} ${added}` : added,
					}));
				}

				return result;
			} catch (error) {
				handleQuotaError(error);
				throw error;
			}
		},

		async exportBackup(options) {
			await flushPendingCommitImpl();
			await flushViewStateImpl();
			return repository.exportBackup(options);
		},

		async getSourceSizes() {
			return repository.getSourceSizes();
		},

		async inspectBackup(file, options) {
			await flushPendingCommitImpl();
			await flushViewStateImpl();
			return repository.inspectBackup(file, options);
		},

		async importBackup(backup, selection, options) {
			await flushPendingCommitImpl();
			await flushViewStateImpl();

			let result: BackupImportResult;
			try {
				result = await repository.importBackup(backup, selection, options);
			} catch (error) {
				handleQuotaError(error);
				throw error;
			}

			// Before any `await`, so nothing saves over the imported records.
			if (result.mode === 'replace' && get().activeProjectId !== null) {
				const {route} = get();
				const nextRoute: AppRoute =
					route.screen === 'editor' ? {screen: 'library'} : route;
				abandonActiveProjectWork();
				dropActiveProject(nextRoute);
				if (route.screen === 'editor') {
					routerEnv.replaceHash(formatHashRoute(nextRoute));
				}
			}

			if (result.projects.length > 0) {
				await finishFirstImport();
			}

			const snapshot = await repository.getStartupSnapshot();
			if (result.settings) {
				syncTheme(result.settings.theme);
			}

			set((state) => ({
				projects: sortProjectsByOpenedAt(snapshot.projects),
				presets: sortPresetsByName(snapshot.presets),
				...result.settings,
				// A replaced project keeps its id, so its card reloads the picture.
				thumbnailVersions: {
					...state.thumbnailVersions,
					...Object.fromEntries(
						result.projects.map((project) => [
							project.id,
							(state.thumbnailVersions[project.id] ?? 0) + 1,
						]),
					),
				},
				notice: backupImportSummary(result),
			}));
			return result;
		},

		async addEffect(type) {
			// The new effect's parameters take the place of the geometry panel.
			closeGeometry();
			return editInOrder(async () => {
				const active = requireActiveProject();
				const side = selectEditingSide(get());
				const stack = sideStack(active, side);
				assertStackCapacity(stack.instances.length + 1);

				const instance = createEffectInstance(
					type,
					registry,
					projectInstanceIds(active),
					getRandomValues,
				);
				const nextStack: EffectStack = {
					schemaVersion: stack.schemaVersion,
					instances: [...stack.instances, instance],
				};
				const label = `Add ${getEffectLabel(instance, registry)}`;
				await commitNextStack(side, nextStack, instance.id, label);
				return instance;
			});
		},

		async removeEffect(instanceId) {
			return editInOrder(async () => {
				const found = locateInstance(requireActiveProject(), instanceId);
				if (!found) {
					return;
				}

				const {side, stack, target: removed} = found;
				const index = stack.instances.indexOf(removed);
				const remaining = stack.instances.filter(
					(item) => item.id !== instanceId,
				);
				let nextSelected = found.selectedId;
				if (nextSelected === instanceId) {
					if (remaining.length === 0) {
						nextSelected = null;
					} else {
						const fallbackIndex = Math.min(index, remaining.length - 1);
						nextSelected = remaining[fallbackIndex].id;
					}
				}

				const nextStack: EffectStack = {
					schemaVersion: stack.schemaVersion,
					instances: remaining,
				};
				await commitNextStack(
					side,
					nextStack,
					nextSelected,
					`Remove ${getEffectLabel(removed, registry)}`,
				);
			});
		},

		async reorderEffect(fromIndex, toIndex) {
			return editInOrder(async () => {
				const active = requireActiveProject();
				const side = selectEditingSide(get());
				const stack = sideStack(active, side);
				const {instances} = stack;
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
					schemaVersion: stack.schemaVersion,
					instances: nextInstances,
				};
				await commitNextStack(
					side,
					nextStack,
					sideSelectedId(active, side),
					`Reorder ${getEffectLabel(moved, registry)}`,
				);
			});
		},

		async duplicateEffect(instanceId) {
			return editInOrder(async () => {
				const active = requireActiveProject();
				const found = locateInstance(active, instanceId);
				if (!found) {
					throw new StorageValidationError(
						`Effect instance "${instanceId}" not found`,
					);
				}

				const {side, stack, target: sourceInstance} = found;
				assertStackCapacity(stack.instances.length + 1);
				const duplicate = cloneInstanceWithNewId(
					sourceInstance,
					projectInstanceIds(active),
					getRandomValues,
				);
				const nextInstances = [...stack.instances];
				nextInstances.splice(
					stack.instances.indexOf(sourceInstance) + 1,
					0,
					duplicate,
				);

				const nextStack: EffectStack = {
					schemaVersion: stack.schemaVersion,
					instances: nextInstances,
				};
				await commitNextStack(
					side,
					nextStack,
					duplicate.id,
					`Duplicate ${getEffectLabel(sourceInstance, registry)}`,
				);
				return duplicate;
			});
		},

		async setEffectEnabled(instanceId, enabled) {
			return editInOrder(async () => {
				const found = locateInstance(requireActiveProject(), instanceId);
				if (!found || found.target.enabled === enabled) {
					return;
				}

				const {side, stack, target} = found;
				const nextStack: EffectStack = {
					schemaVersion: stack.schemaVersion,
					instances: stack.instances.map((item) =>
						item.id === instanceId ? {...item, enabled} : item,
					),
				};
				const verb = enabled ? 'Enable' : 'Disable';
				await commitNextStack(
					side,
					nextStack,
					found.selectedId,
					`${verb} ${getEffectLabel(target, registry)}`,
				);
			});
		},

		selectEffect(instanceId) {
			closeGeometry();
			const {activeProject} = get();
			if (!activeProject) {
				return;
			}

			const owner =
				instanceId === null
					? null
					: findInstanceSide(activeProject, instanceId);
			const side = owner ?? selectEditingSide(get());
			const nextSelected = owner ? instanceId : null;
			if (sideSelectedId(activeProject, side) === nextSelected) {
				return;
			}

			set({
				activeProject: {
					...activeProject,
					...(side === 'a'
						? {selectedInstanceIdA: nextSelected}
						: {selectedInstanceId: nextSelected}),
				},
			});
			scheduleViewStateSave();
		},

		setDebugView(debugView) {
			const {activeProject} = get();
			if (!activeProject) {
				return;
			}

			const validDebug = keepDebugView(debugView, activeProject);
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

			const found = locateInstance(activeProject, instanceId);
			if (!found) {
				return;
			}

			const {target} = found;
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
			if (found.side === 'a') {
				return;
			}

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
			}

			return editInOrder(async () => {
				const found = locateInstance(requireActiveProject(), instanceId);
				if (!found) {
					transientStore.setState({activeDrag: null});
					return;
				}

				const {side, stack, target} = found;
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
					schemaVersion: stack.schemaVersion,
					instances: stack.instances.map((item) =>
						item.id === instanceId ? {...item, params: validated} : item,
					),
				};

				if (
					!get().stackNeedsWriteBack &&
					canonicalStackJson(nextStack) === canonicalStackJson(stack)
				) {
					transientStore.setState({activeDrag: null});
					if (side === 'b') {
						coordinator.endDrag();
					}

					return;
				}

				await commitNextStack(
					side,
					nextStack,
					found.selectedId,
					label ??
						formatParamCommitLabel(
							definition.params[paramKey],
							validated[paramKey],
						),
				);
			});
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
				void commitHeldKeys();
			} else if (pendingKeyboard) {
				timerEnv.clearTimeout(pendingKeyboard.timer);
			}

			get().dragParam(instanceId, paramKey, value);
			const timer = timerEnv.setTimeout(() => {
				void commitHeldKeys();
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
			const side = activeProject && findInstanceSide(activeProject, instanceId);
			if (!activeProject || !side) {
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
			if (side === 'a') {
				return;
			}

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
			}

			return editInOrder(async () => {
				const found = locateInstance(requireActiveProject(), instanceId);
				if (!found) {
					transientStore.setState({activeDrag: null});
					return;
				}

				const {side, stack, target} = found;
				const normalized = normalizeMix(mix);
				if (!get().stackNeedsWriteBack && target.mix === normalized) {
					transientStore.setState({activeDrag: null});
					if (side === 'b') {
						coordinator.endDrag();
					}

					return;
				}

				const nextStack: EffectStack = {
					schemaVersion: stack.schemaVersion,
					instances: stack.instances.map((item) =>
						item.id === instanceId ? {...item, mix: normalized} : item,
					),
				};
				await commitNextStack(
					side,
					nextStack,
					found.selectedId,
					formatMixCommitLabel(normalized),
				);
			});
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
				void commitHeldKeys();
			} else if (pendingKeyboard) {
				timerEnv.clearTimeout(pendingKeyboard.timer);
			}

			get().dragMix(instanceId, mix);
			const timer = timerEnv.setTimeout(() => {
				void commitHeldKeys();
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
			return editInOrder(async () => {
				const found = locateInstance(requireActiveProject(), instanceId);
				if (!found) {
					return;
				}

				const {side, stack, target} = found;
				const normalized = normalizeBlend(blend);
				if (!get().stackNeedsWriteBack && target.blend === normalized) {
					return;
				}

				const nextStack: EffectStack = {
					schemaVersion: stack.schemaVersion,
					instances: stack.instances.map((item) =>
						item.id === instanceId ? {...item, blend: normalized} : item,
					),
				};
				await commitNextStack(
					side,
					nextStack,
					found.selectedId,
					formatBlendCommitLabel(normalized),
				);
			});
		},

		async resetParam(instanceId, paramKey) {
			const held = commitHeldKeys();
			const target = locateInstance(requireActiveProject(), instanceId)?.target;
			if (!target) {
				return;
			}

			const definition = registry.get(target.type);
			if (!definition || !Object.hasOwn(definition.params, paramKey)) {
				return;
			}

			const defaults = createInstanceDefaults(definition, getRandomValues);
			await Promise.all([
				held,
				get().commitParam(
					instanceId,
					paramKey,
					defaults[paramKey],
					`Reset ${definition.params[paramKey].label}`,
				),
			]);
		},

		async resetInstance(instanceId) {
			return editInOrder(async () => {
				const found = locateInstance(requireActiveProject(), instanceId);
				if (!found) {
					return;
				}

				const {side, stack, target} = found;
				const definition = registry.get(target.type);
				if (!definition) {
					return;
				}

				const nextStack: EffectStack = {
					schemaVersion: stack.schemaVersion,
					instances: stack.instances.map((item) =>
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
					side,
					nextStack,
					found.selectedId,
					`Reset ${definition.label}`,
				);
			});
		},

		async commitInstanceParams(instanceId, params, label) {
			return editInOrder(async () => {
				const found = locateInstance(requireActiveProject(), instanceId);
				const definition = found ? registry.get(found.target.type) : undefined;
				if (!found || !definition) {
					return;
				}

				const nextStack: EffectStack = {
					schemaVersion: found.stack.schemaVersion,
					instances: found.stack.instances.map((item) =>
						item.id === instanceId
							? {
									...item,
									version: definition.version,
									params: validateParams(definition.params, params),
								}
							: item,
					),
				};
				await commitNextStack(found.side, nextStack, found.selectedId, label);
			});
		},

		async commitImageParam(projectId, instanceId, paramKey, choice) {
			return editInOrder(async () => {
				const newSource =
					'image' in choice
						? {
								...choice.image,
								sha256: await hashBlobSha256(choice.image.blob),
							}
						: undefined;
				const sha256 = 'image' in choice ? newSource!.sha256 : choice.sha256;
				// A picked file that is already stored changes nothing by itself.
				const stores = newSource && !(await repository.hasSource(sha256));
				const active = get().activeProject;
				if (active?.id !== projectId) {
					return false;
				}

				const found = locateInstance(active, instanceId);
				const definition = found ? registry.get(found.target.type) : undefined;
				const spec = definition?.params[paramKey];
				if (!found || !definition || spec?.kind !== 'image') {
					return false;
				}

				const {side, stack, target} = found;
				const params = validateSingleParam(
					definition,
					target.params,
					paramKey,
					sha256,
				);
				const nextStack: EffectStack = {
					schemaVersion: stack.schemaVersion,
					instances: stack.instances.map((item) =>
						item.id === instanceId
							? {...item, version: definition.version, params}
							: item,
					),
				};
				if (
					!stores &&
					!get().stackNeedsWriteBack &&
					canonicalStackJson(nextStack) === canonicalStackJson(stack)
				) {
					return false;
				}

				await commitNextStack(
					side,
					nextStack,
					found.selectedId,
					formatParamCommitLabel(spec, params[paramKey]),
					newSource,
				);
				return true;
			});
		},

		cancelDrag() {
			clearKeyboardTimer();
			const drag = transientStore.getState().activeDrag;
			transientStore.setState({activeDrag: null, splitPosition: null});
			const {activeProject, debugView} = get();
			if (
				activeProject &&
				!(drag && stackHas(sideStack(activeProject, 'a'), drag.instanceId))
			) {
				dispatchStackToCoordinator(activeProject.stack, debugView, false);
			}
		},

		flushPendingCommit: flushPendingCommitImpl,

		async undo() {
			return editInOrder(async () => {
				const active = get().activeProject;
				return active
					? applyHistoryStep(active, await repository.undo(active.id))
					: false;
			});
		},

		async redo() {
			return editInOrder(async () => {
				const active = get().activeProject;
				return active
					? applyHistoryStep(active, await repository.redo(active.id))
					: false;
			});
		},

		async jumpToHistory(projectId, seq) {
			return editInOrder(async () => {
				const active = get().activeProject;
				if (active?.id !== projectId) {
					return false;
				}

				return applyHistoryStep(
					active,
					await repository.jumpToHistory(projectId, seq),
				);
			});
		},

		setCompareHistorySeq(seq) {
			if (seq === null) {
				const hadPin = get().compareHistorySeq !== null;
				set(releaseHistoryCompare());
				if (hadPin) {
					const {compareLatched, compareHolding} = transientStore.getState();
					if (compareLatched || compareHolding) {
						transientStore.setState({
							compareLatched: false,
							compareHolding: false,
						});
					}
				}

				return;
			}

			const state = get();
			if (
				!state.activeProject ||
				transientStore.getState().geometry.cropping ||
				state.history.every((entry) => entry.seq !== seq)
			) {
				return;
			}

			transientStore.setState({compareLatched: false, compareHolding: false});
			if (state.compareMode === 'toggle') {
				set({
					compareHistorySeq: seq,
					compareHistoryRestoreMode: 'toggle',
					compareMode: 'split',
				});
				return;
			}

			set({compareHistorySeq: seq});
		},

		clearCompareHistory() {
			get().setCompareHistorySeq(null);
		},

		async setTransform(projectId, transform, label) {
			return editInOrder(async () => {
				const active = get().activeProject;
				if (active?.id !== projectId) {
					return false;
				}

				const {transform: next} = geometryForWrite(
					active.sourceWidth,
					active.sourceHeight,
					transform,
				);
				if (transformKey(next) === transformKey(active.transform)) {
					return false;
				}

				await commitSides(
					active,
					label ?? formatTransformCommitLabel(active.transform, next),
					false,
					next,
				);
				return true;
			});
		},

		async setEditSide(side) {
			await editInOrder(() => {
				patchViewState({editSide: side});
			});
		},

		setSplitOrientation(orientation) {
			patchViewState({splitOrientation: orientation});
		},

		async copyToOtherSide() {
			return editInOrder(async () => {
				const active = requireActiveProject();
				const from = selectEditingSide(get());
				const to = otherSide(from);
				const source = sideStack(active, from);
				if (source.instances.length === 0) {
					return;
				}

				const copy = cloneStackWithNewIds(
					source,
					new Set(source.instances.map((item) => item.id)),
					getRandomValues,
				);
				const selectedIndex = source.instances.findIndex(
					(item) => item.id === sideSelectedId(active, from),
				);
				const selected = copy.instances[Math.max(0, selectedIndex)]?.id ?? null;
				await commitSides(
					withSide(active, to, copy, selected),
					`Copy ${sideLetter(from)} to ${sideLetter(to)}`,
					to === 'b',
				);
			});
		},

		async swapSides() {
			return editInOrder(async () => {
				const active = requireActiveProject();
				const sideA = sideStack(active, 'a');
				if (sideA.instances.length + active.stack.instances.length === 0) {
					return;
				}

				await commitSides(
					{
						stack: sideA,
						selectedInstanceId: sideSelectedId(active, 'a'),
						stackA: active.stack,
						selectedInstanceIdA: active.selectedInstanceId,
					},
					'Swap sides',
					true,
				);
			});
		},

		setRenderViewScale,

		retryRender() {
			coordinator.retry();
			sideRenderer.retry();
		},

		async applyStack(stack, label) {
			return editInOrder(async () => {
				const active = requireActiveProject();
				const side = selectEditingSide(get());
				const nextStack = cloneStackWithNewIds(
					stack,
					new Set(
						sideStack(active, otherSide(side)).instances.map((item) => item.id),
					),
					getRandomValues,
				);
				const selectedId = nextStack.instances[0]?.id ?? null;
				await commitNextStack(side, nextStack, selectedId, label);
			});
		},

		async applyPreset(presetId) {
			const preset =
				getBuiltinPreset(presetId) ??
				get().presets.find((item) => item.id === presetId);
			if (!preset) {
				throw new StorageValidationError(`Preset "${presetId}" not found`);
			}

			await get().applyStack(preset.stack, `Apply preset ${preset.name}`);
		},

		async addPresetToStack(presetId) {
			return editInOrder(async () => {
				const active = requireActiveProject();
				const preset =
					getBuiltinPreset(presetId) ??
					get().presets.find((item) => item.id === presetId);
				if (!preset) {
					throw new StorageValidationError(`Preset "${presetId}" not found`);
				}

				const side = selectEditingSide(get());
				const stack = sideStack(active, side);
				assertStackCapacity(
					stack.instances.length + preset.stack.instances.length,
				);
				const cloned = cloneStackWithNewIds(
					preset.stack,
					projectInstanceIds(active),
					getRandomValues,
				);
				const nextStack: EffectStack = {
					schemaVersion: stack.schemaVersion,
					instances: [...stack.instances, ...cloned.instances],
				};
				const selectedId =
					cloned.instances[0]?.id ?? sideSelectedId(active, side);
				await commitNextStack(
					side,
					nextStack,
					selectedId,
					`Add ${preset.name}`,
				);
			});
		},

		async saveStackAsPreset(name) {
			await flushPendingCommitImpl();
			const active = requireActiveProject();
			try {
				const created = await repository.createPreset({
					name,
					stack: cloneEffectStack(sideStack(active, selectEditingSide(get()))),
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
			set({compareMode: mode, compareHistoryRestoreMode: null});
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

		async dismissWelcome() {
			set({welcomeDismissed: true});
			await repository.updateAppState({welcomeDismissed: true});
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

			// The guide and the dev gallery leave the open project as it is.
			if (parsed.screen === 'gallery' || parsed.screen === 'guide') {
				if (current.screen !== parsed.screen) {
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
				void commitHeldKeys();
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
			unsubscribeSideA?.();
			unsubscribeSideA = null;
			sideRenderer.dispose();
			cropPreview.dispose();
			detachCoordinator?.();
			detachCoordinator = null;
			detachRouter?.();
			detachRouter = null;
			detachLifecycle?.();
			detachLifecycle = null;
		},
	}));

	const unsubscribeStore = store.subscribe(syncSideA);
	const unsubscribeDrag = transientStore.subscribe(syncSideA);
	const unsubscribeProject = store.subscribe((state, previous) => {
		// Geometry edits belong to one open project.
		if (state.activeProjectId !== previous.activeProjectId) {
			closeGeometry();
		}

		syncCropPreview();
	});
	const unsubscribeCropMode = transientStore.subscribe(syncCropPreview);
	unsubscribeSideA = () => {
		unsubscribeStore();
		unsubscribeDrag();
		unsubscribeProject();
		unsubscribeCropMode();
	};

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
