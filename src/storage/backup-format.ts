// The backup format: types, limits and validation (persistence.md section 8.4).
// `backup.ts` reads and writes the archive.
import {
	booleanValue,
	ensure,
	fileTimestamp,
	hashValue,
	integerValue,
	objectValue,
	oneOf,
	sourceEntryValue,
	stackValue,
	stringValue,
	timestamp,
	PROJECT_FORMAT_VERSION,
	type ArchiveSourceEntry,
	type ProjectFilePayload,
} from './project-format.ts';
import {
	MAX_PRESET_NAME_LENGTH,
	MAX_PROJECT_NAME_LENGTH,
	type CompareMode,
	type HistoryEntryRecord,
	type ProjectRecord,
	type SourceRecord,
	type ThemePreference,
	type UserPresetRecord,
} from './types.ts';

export const BACKUP_FORMAT_VERSION = 1;

// Below 4 GiB, so a backup never needs ZIP64 records (decisions.md D44).
export const MAX_BACKUP_BYTES = 4_000_000_000;
// 65,535 in a ZIP end record means "see the ZIP64 record".
export const MAX_BACKUP_ENTRIES = 65_534;

const MAX_SIDE = 16_384;

export type BackupSettingsPayload = {
	theme: ThemePreference;
	compareMode: CompareMode;
};

export type BackupProjectEntry = {
	id: string;
	name: string;
	sourceHash: string;
	sourceWidth: number;
	sourceHeight: number;
	updatedAt: number;
	path: string;
	historyPath: string | null;
	thumbnailPath: string | null;
	// The bytes of every source the project uses.
	totalSourceBytes: number;
};

export type BackupManifest = {
	kind: 'backup';
	backupVersion: 1;
	// Of every `project.json` and `history.json` inside.
	projectFormatVersion: 1;
	appVersion: string;
	exportedAt: string;
	scope: 'library' | 'selection';
	includesHistory: boolean;
	includesPresets: boolean;
	includesSettings: boolean;
	// Each source the projects use, once.
	sources: ArchiveSourceEntry[];
	projects: BackupProjectEntry[];
	presetCount: number;
};

export type BackupProjectInput = {
	project: ProjectRecord;
	// Written only when the backup includes history.
	history?: readonly HistoryEntryRecord[];
	thumbnail?: Blob;
};

export type BackupInput = {
	scope: BackupManifest['scope'];
	includesHistory: boolean;
	projects: readonly BackupProjectInput[];
	// Every source the projects refer to.
	sources: readonly SourceRecord[];
	// Omitted leaves presets out.
	presets?: readonly UserPresetRecord[];
	// Omitted leaves settings out.
	settings?: BackupSettingsPayload;
	appVersion: string;
	exportedAt?: Date;
};

export type BackupOutput = {blob: Blob; fileName: string};

export type BackupProjectContents = {
	project: ProjectFilePayload;
	// `null` when the backup holds no history.
	history: HistoryEntryRecord[] | null;
	thumbnail: Blob | null;
};

export type BackupContents = {
	manifest: BackupManifest;
	// In the manifest's order.
	projects: BackupProjectContents[];
	// Verified against their hashes.
	sources: Array<ArchiveSourceEntry & {blob: Blob}>;
	// `null` when the backup leaves them out.
	presets: UserPresetRecord[] | null;
	settings: BackupSettingsPayload | null;
};

export type BackupStage = 'reading' | 'packing' | 'validating' | 'importing';

export type BackupProgress = {
	stage: BackupStage;
	// 0..1 within the stage.
	fraction: number;
	// The archive entry being written or read.
	path?: string;
};

export type BackupOptions = {
	signal?: AbortSignal;
	onProgress?: (progress: BackupProgress) => void;
};

export type ExportBackupOptions = BackupOptions & {
	// Absent exports every project.
	projectIds?: readonly string[];
	// Each of the three is `true` when absent.
	includeHistory?: boolean;
	includePresets?: boolean;
	includeSettings?: boolean;
};

export function backupFileName(date: Date): string {
	return `glitch-backup-${fileTimestamp(date)}.zip`;
}

// The sources a project needs. T8.8 adds the `image` parameters of the stacks
// and history here (persistence.md section 8.4.4).
export function backupSourceHashes(
	project: Pick<ProjectRecord, 'sourceHash'>,
): string[] {
	return [project.sourceHash];
}

// The image bytes of a backup of `projects`, each shared source counted once.
export function estimateBackupBytes(
	projects: ReadonlyArray<Pick<ProjectRecord, 'sourceHash'>>,
	sourceSizes: Readonly<Record<string, number>>,
): number {
	const hashes = new Set(
		projects.flatMap((project) => backupSourceHashes(project)),
	);
	let bytes = 0;
	for (const hash of hashes) {
		bytes += sourceSizes[hash] ?? 0;
	}

	return bytes;
}

export function backupProjectPaths(id: string) {
	const folder = `projects/${id}`;
	return {
		project: `${folder}/project.json`,
		history: `${folder}/history.json`,
		thumbnail: (name: string) => `${folder}/${name}`,
	};
}

// Ids end up in archive paths and in the editor's URL.
export function projectIdValue(value: unknown): string {
	const id = stringValue(value, 'project id');
	ensure(/^[\w-]{1,64}$/.test(id), 'project id');
	return id;
}

function projectEntryValue(
	value: unknown,
	includesHistory: boolean,
): BackupProjectEntry {
	const entry = objectValue(value, 'project entry');
	const id = projectIdValue(entry.id);
	const paths = backupProjectPaths(id);
	const name = stringValue(entry.name, 'name').trim();
	ensure(name.length > 0 && name.length <= MAX_PROJECT_NAME_LENGTH, 'name');
	ensure(entry.path === paths.project, 'path');
	const historyPath = includesHistory ? paths.history : null;
	ensure(entry.historyPath === historyPath, 'historyPath');
	const {thumbnailPath} = entry;
	return {
		id,
		name,
		sourceHash: hashValue(entry.sourceHash, 'sourceHash'),
		sourceWidth: integerValue(entry.sourceWidth, 1, MAX_SIDE, 'sourceWidth'),
		sourceHeight: integerValue(entry.sourceHeight, 1, MAX_SIDE, 'sourceHeight'),
		updatedAt: timestamp(entry.updatedAt, 'updatedAt'),
		path: paths.project,
		historyPath,
		thumbnailPath:
			thumbnailPath === null
				? null
				: oneOf(
						thumbnailPath,
						[
							paths.thumbnail('thumbnail.webp'),
							paths.thumbnail('thumbnail.jpg'),
						],
						'thumbnailPath',
					),
		totalSourceBytes: integerValue(
			entry.totalSourceBytes,
			0,
			Number.MAX_SAFE_INTEGER,
			'totalSourceBytes',
		),
	};
}

function unique<Value>(
	values: readonly Value[],
	key: (value: Value) => string,
	what: string,
) {
	ensure(
		new Set(values.map((value) => key(value))).size === values.length,
		what,
	);
}

// The caller checks `kind` and both versions first.
export function backupManifestValue(
	value: Record<string, unknown>,
): BackupManifest {
	const includesHistory = booleanValue(
		value.includesHistory,
		'includesHistory',
	);
	const includesPresets = booleanValue(
		value.includesPresets,
		'includesPresets',
	);
	const {sources, projects} = value;
	ensure(Array.isArray(sources), 'sources');
	ensure(Array.isArray(projects), 'projects');
	const sourceEntries = sources.map((entry) => sourceEntryValue(entry));
	unique(sourceEntries, (entry) => entry.sha256, 'sources');
	const projectEntries = projects.map((entry) =>
		projectEntryValue(entry, includesHistory),
	);
	unique(projectEntries, (entry) => entry.id, 'projects');
	const exportedAt = stringValue(value.exportedAt, 'exportedAt');
	ensure(!Number.isNaN(Date.parse(exportedAt)), 'exportedAt');
	return {
		kind: 'backup',
		backupVersion: BACKUP_FORMAT_VERSION,
		projectFormatVersion: PROJECT_FORMAT_VERSION,
		appVersion: stringValue(value.appVersion, 'appVersion'),
		exportedAt,
		scope: oneOf(value.scope, ['library', 'selection'], 'scope'),
		includesHistory,
		includesPresets,
		includesSettings: booleanValue(value.includesSettings, 'includesSettings'),
		sources: sourceEntries,
		projects: projectEntries,
		presetCount: integerValue(
			value.presetCount,
			0,
			includesPresets ? Number.MAX_SAFE_INTEGER : 0,
			'presetCount',
		),
	};
}

function presetValue(value: unknown): UserPresetRecord {
	const preset = objectValue(value, 'preset');
	const id = stringValue(preset.id, 'preset id');
	ensure(/^user:[\w-]{1,64}$/.test(id), 'preset id');
	const name = stringValue(preset.name, 'preset name').trim();
	ensure(
		name.length > 0 && name.length <= MAX_PRESET_NAME_LENGTH,
		'preset name',
	);
	return {
		id,
		name,
		nameLower: name.toLocaleLowerCase('en'),
		stack: stackValue(preset.stack, 'preset stack'),
		createdAt: timestamp(preset.createdAt, 'preset createdAt'),
		updatedAt: timestamp(preset.updatedAt, 'preset updatedAt'),
	};
}

// The contents of `presets.json`.
export function presetsValue(value: unknown): UserPresetRecord[] {
	const {presets} = objectValue(value, 'presets file');
	ensure(Array.isArray(presets), 'presets');
	const parsed = presets.map((preset) => presetValue(preset));
	unique(parsed, (preset) => preset.id, 'preset ids');
	return parsed;
}

// The contents of `settings.json`.
export function settingsValue(value: unknown): BackupSettingsPayload {
	const settings = objectValue(value, 'settings');
	return {
		theme: oneOf(settings.theme, ['system', 'light', 'dark'], 'theme'),
		compareMode: oneOf(
			settings.compareMode,
			['toggle', 'split'],
			'compareMode',
		),
	};
}
