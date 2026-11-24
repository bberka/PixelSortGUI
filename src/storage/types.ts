import type {EffectStack} from '../engine/types.ts';

export const DB_NAME = 'pixelsortgui';
export const DB_VERSION = 1;

export const STORE_NAMES = {
	sources: 'sources',
	projects: 'projects',
	thumbnails: 'thumbnails',
	history: 'history',
	presets: 'presets',
	meta: 'meta',
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

export const MAX_HISTORY_ENTRIES = 201;
export const MAX_PROJECT_NAME_LENGTH = 120;
export const MAX_PRESET_NAME_LENGTH = 80;
export const MIN_EXPORT_QUALITY = 50;
export const MAX_EXPORT_QUALITY = 100;
export const DEFAULT_EXPORT_QUALITY = 92;
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 32;
export const DEFAULT_SPLIT_POSITION = 0.5;
export const QUOTA_HEADROOM_MULTIPLIER = 1.15;
export const THEME_STORAGE_KEY = 'psg:theme';

export type SourceRecord = {
	sha256: string;
	blob: Blob;
	mimeType: string;
	byteLength: number;
	width: number;
	height: number;
	createdAt: number;
};

export type ViewState = {
	fitMode: 'fit' | 'custom';
	zoom: number;
	centerX: number;
	centerY: number;
	splitPosition: number;
};

export type ExportFormat = 'png' | 'jpeg' | 'webp';
export type ExportSizeMode = 'full' | 'half' | 'quarter' | 'custom';

export type ExportSettings = {
	format: ExportFormat;
	quality: number;
	sizeMode: ExportSizeMode;
	customLongestSide: number | null;
};

export type ProjectRecord = {
	id: string;
	name: string;
	sourceHash: string;
	sourceWidth: number;
	sourceHeight: number;
	stack: EffectStack;
	selectedInstanceId: string | null;
	historyHeadSeq: number;
	historyMinSeq: number;
	historyMaxSeq: number;
	viewState: ViewState;
	exportSettings: ExportSettings;
	createdAt: number;
	updatedAt: number;
	openedAt: number;
};

export type ThumbnailRecord = {
	projectId: string;
	blob: Blob;
	width: number;
	height: number;
	stackSignature: string;
	updatedAt: number;
};

export type HistoryEntryRecord = {
	projectId: string;
	seq: number;
	label: string;
	stack: EffectStack;
	selectedInstanceId: string | null;
	createdAt: number;
};

export type UserPresetRecord = {
	id: string;
	name: string;
	nameLower: string;
	stack: EffectStack;
	createdAt: number;
	updatedAt: number;
};

export type ThemePreference = 'system' | 'light' | 'dark';
export type CompareMode = 'toggle' | 'split';

export type AppStateRecord = {
	key: 'appState';
	activeProjectId: string | null;
	theme: ThemePreference;
	compareMode: CompareMode;
};

export type SchemaInfoRecord = {
	key: 'schemaInfo';
	dbVersion: number;
	migratedAt: number;
};

export type MetaRecord = AppStateRecord | SchemaInfoRecord;

export type CreateProjectInput = {
	name: string;
	blob: Blob;
	mimeType?: string;
	width: number;
	height: number;
	stripExtension?: boolean;
	setActive?: boolean;
};

export type CreateProjectResult = {
	project: ProjectRecord;
	source: SourceRecord;
	deduplicated: boolean;
};

export type CommitStackInput = {
	projectId: string;
	stack: EffectStack;
	selectedInstanceId: string | null;
	label: string;
};

export type CommitStackResult = {
	project: ProjectRecord;
	entry: HistoryEntryRecord;
};

export type HistoryStepResult = {
	project: ProjectRecord;
	entry: HistoryEntryRecord;
};

export type DeleteProjectResult = {
	deleted: boolean;
	sourceDeleted: boolean;
};

export type CreatePresetInput = {
	name: string;
	stack: EffectStack;
};

export type StartupSnapshot = {
	appState: AppStateRecord;
	projects: ProjectRecord[];
	presets: UserPresetRecord[];
};

export type StorageRepository = {
	createProject(input: CreateProjectInput): Promise<CreateProjectResult>;
	listProjects(): Promise<ProjectRecord[]>;
	getProject(id: string): Promise<ProjectRecord | undefined>;
	getSource(sha256: string): Promise<SourceRecord | undefined>;
	hasSource(sha256: string): Promise<boolean>;
	openProject(id: string): Promise<ProjectRecord>;
	closeActiveProject(): Promise<AppStateRecord>;
	renameProject(id: string, name: string): Promise<ProjectRecord>;
	duplicateProject(id: string): Promise<ProjectRecord>;
	deleteProject(id: string): Promise<DeleteProjectResult>;
	commitStack(input: CommitStackInput): Promise<CommitStackResult>;
	saveProjectStack(
		id: string,
		stack: EffectStack,
		selectedInstanceId?: string | null,
	): Promise<ProjectRecord>;
	undo(projectId: string): Promise<HistoryStepResult | null>;
	redo(projectId: string): Promise<HistoryStepResult | null>;
	getHistory(projectId: string): Promise<HistoryEntryRecord[]>;
	getHistoryEntry(
		projectId: string,
		seq: number,
	): Promise<HistoryEntryRecord | undefined>;
	updateViewState(
		id: string,
		viewState: ViewState,
		selectedInstanceId?: string | null,
	): Promise<ProjectRecord>;
	updateExportSettings(
		id: string,
		exportSettings: ExportSettings,
	): Promise<ProjectRecord>;
	getThumbnail(projectId: string): Promise<ThumbnailRecord | undefined>;
	putThumbnail(thumbnail: ThumbnailRecord): Promise<void>;
	deleteThumbnail(projectId: string): Promise<void>;
	listPresets(): Promise<UserPresetRecord[]>;
	getPreset(id: string): Promise<UserPresetRecord | undefined>;
	createPreset(input: CreatePresetInput): Promise<UserPresetRecord>;
	renamePreset(id: string, name: string): Promise<UserPresetRecord>;
	deletePreset(id: string): Promise<boolean>;
	getAppState(): Promise<AppStateRecord>;
	updateAppState(
		patch: Partial<Omit<AppStateRecord, 'key'>>,
	): Promise<AppStateRecord>;
	getStartupSnapshot(): Promise<StartupSnapshot>;
	getSchemaInfo(): Promise<SchemaInfoRecord | undefined>;
	cleanupOrphanedSources(): Promise<number>;
	close(): void;
};

export class StorageError extends Error {
	override name = 'StorageError';
}

export class StorageQuotaError extends StorageError {
	override name = 'StorageQuotaError';

	constructor(
		message = 'Browser storage quota exceeded',
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}

export class StorageVersionError extends StorageError {
	override name = 'StorageVersionError';
	readonly expectedVersion: number;

	constructor(
		expectedVersion: number,
		message = `Stored database schema is newer than supported version ${expectedVersion}`,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.expectedVersion = expectedVersion;
	}
}

export class StorageNotFoundError extends StorageError {
	override name = 'StorageNotFoundError';
}

export class StorageValidationError extends StorageError {
	override name = 'StorageValidationError';
}

export function isQuotaExceededError(error: unknown): boolean {
	if (error instanceof StorageQuotaError) {
		return true;
	}

	if (typeof error === 'object' && error !== null && 'name' in error) {
		const {name} = error;
		return (
			name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
		);
	}

	return false;
}
