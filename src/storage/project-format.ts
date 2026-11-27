// The `.glproj` format: types, limits and validation (persistence.md section
// 8.3). `project-file.ts` reads and writes the archive.
import {MASK_PIXEL_CAP, maskGridSize} from '../engine/mask/grid.ts';
import {MAX_STACK_INSTANCES, type EffectStack} from '../engine/types.ts';
import type {SourceTransform} from '../engine/transform.ts';
import {
	MAX_EXTRA_SOURCES,
	extraSourceHashes,
	type StackPair,
} from './extra-sources.ts';
import {resolveStoredGeometry} from './geometry.ts';
import {normalizeExportSettings, normalizeViewState} from './helpers.ts';
import {referencedMaskHashes} from './masks.ts';
import {
	MAX_HISTORY_ENTRIES,
	MAX_PROJECT_NAME_LENGTH,
	type ExportSettings,
	type HistoryEntryRecord,
	type MaskRecord,
	type ProjectRecord,
	type SourceRecord,
	type ViewState,
} from './types.ts';

// The newest version read. A file with no mask is written as version 1, which
// older builds open (persistence.md section 8.6).
export const PROJECT_FORMAT_VERSION = 2;
export const PROJECT_FILE_EXTENSION = '.glproj';

export const MAX_PROJECT_FILE_BYTES = 1024 * 1024 * 1024;
export const MAX_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
export const MAX_MASK_BYTES = 8 * 1024 * 1024;

const MAX_SIDE = 16_384;
const MAX_SLUG_LENGTH = 64;

const SOURCE_EXTENSIONS: Readonly<Record<string, string>> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/avif': 'avif',
	'image/gif': 'gif',
	'image/bmp': 'bmp',
	'image/tiff': 'tiff',
	'image/svg+xml': 'svg',
};

export const JSON_PATHS: readonly string[] = [
	'manifest.json',
	'project.json',
	'history.json',
];

export const THUMBNAIL_TYPES = {
	'thumbnail.webp': 'image/webp',
	'thumbnail.jpg': 'image/jpeg',
} as const;

export type ThumbnailPath = keyof typeof THUMBNAIL_TYPES;

export type ArchiveSourceEntry = {
	sha256: string;
	path: string;
	mimeType: string;
	byteLength: number;
	width: number;
	height: number;
};

export type ArchiveMaskEntry = {
	sha256: string;
	path: string;
	width: number;
	height: number;
	byteLength: number;
};

export type ProjectFileManifest = {
	kind: 'project';
	formatVersion: 1 | 2;
	appVersion: string;
	exportedAt: string;
	includesHistory: boolean;
	primarySourceHash: string;
	sources: ArchiveSourceEntry[];
	// Present exactly in version 2.
	masks?: ArchiveMaskEntry[];
	thumbnailPath: ThumbnailPath | null;
};

export type ProjectFilePayload = {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	openedAt: number;
	sourceHash: string;
	sourceWidth: number;
	sourceHeight: number;
	transform: SourceTransform;
	stack: EffectStack;
	selectedInstanceId: string | null;
	stackA?: EffectStack;
	selectedInstanceIdA?: string | null;
	viewState: ViewState;
	exportSettings: ExportSettings;
	historyHeadSeq: number;
	historyMinSeq: number;
	historyMaxSeq: number;
};

export type ProjectHistoryPayload = {entries: HistoryEntryRecord[]};

export type ProjectFileInput = {
	project: ProjectRecord;
	// The primary source and every other source the project refers to.
	sources: readonly SourceRecord[];
	// The painted masks the written stacks refer to.
	masks?: readonly MaskRecord[];
	// Omitted saves the project without undo history.
	history?: readonly HistoryEntryRecord[];
	thumbnail?: Blob;
	appVersion: string;
	exportedAt?: Date;
};

export type ProjectFileOutput = {blob: Blob; fileName: string};

export type ProjectFileContents = {
	manifest: ProjectFileManifest;
	project: ProjectFilePayload;
	// `null` when the file holds no history.
	history: HistoryEntryRecord[] | null;
	// Verified against their hashes; the primary source comes first.
	sources: Array<ArchiveSourceEntry & {blob: Blob}>;
	// Verified too.
	masks: Array<ArchiveMaskEntry & {blob: Blob}>;
	thumbnail: Blob | null;
};

export type ArchiveProgress = {
	// The archive entry being written or read.
	path: string;
	// 0..1 of the image bytes.
	fraction: number;
};

export type ArchiveOptions = {
	signal?: AbortSignal;
	onProgress?: (progress: ArchiveProgress) => void;
};

// `projectFileMigrations[v]` converts the parsed JSON of format `v` to `v + 1`.
export type ProjectFileDocuments = {
	manifest: Record<string, unknown>;
	project: unknown;
	history: unknown;
};

export type ProjectFileMigration = (
	documents: ProjectFileDocuments,
) => ProjectFileDocuments;

export const projectFileMigrations: Readonly<
	Record<number, ProjectFileMigration>
> = {
	// Version 2 only adds masks, which a version 1 file cannot hold.
	1: (documents) => documents,
};

// A value that breaks the format rules.
export class InvalidMetadata extends Error {
	override name = 'InvalidMetadata';
}

export function migrateProjectDocuments(
	documents: ProjectFileDocuments,
	fromVersion: number,
	toVersion: number = PROJECT_FORMAT_VERSION,
	migrations: Readonly<
		Record<number, ProjectFileMigration>
	> = projectFileMigrations,
): ProjectFileDocuments {
	let current = documents;
	for (let version = fromVersion; version < toVersion; version++) {
		const migrate = migrations[version];
		if (!migrate) {
			throw new InvalidMetadata(`No migration from format ${version}`);
		}

		current = migrate(current);
	}

	return current;
}

// The device's local time as `YYYYMMDD-HHmmss`, for file names.
export function fileTimestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
	const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return `${day}-${time}`;
}

export function projectFileName(name: string, date: Date): string {
	const words = name
		.toLocaleLowerCase('en')
		.split(/[^\p{Letter}\p{Mark}\p{Number}]+/u)
		.filter(Boolean)
		.join('-');
	const slug = [...words].slice(0, MAX_SLUG_LENGTH).join('').replace(/-$/, '');
	return `${slug || 'project'}-${fileTimestamp(date)}${PROJECT_FILE_EXTENSION}`;
}

export function ensure(condition: boolean, what: string): asserts condition {
	if (!condition) {
		throw new InvalidMetadata(`Invalid ${what}`);
	}
}

export function objectValue(
	value: unknown,
	what: string,
): Record<string, unknown> {
	ensure(
		typeof value === 'object' && value !== null && !Array.isArray(value),
		what,
	);
	return value as Record<string, unknown>;
}

export function stringValue(value: unknown, what: string): string {
	ensure(typeof value === 'string', what);
	return value;
}

export function booleanValue(value: unknown, what: string): boolean {
	ensure(typeof value === 'boolean', what);
	return value;
}

function numberValue(value: unknown, what: string): number {
	ensure(typeof value === 'number' && Number.isFinite(value), what);
	return value;
}

export function integerValue(
	value: unknown,
	min: number,
	max: number,
	what: string,
): number {
	ensure(
		typeof value === 'number' &&
			Number.isSafeInteger(value) &&
			value >= min &&
			value <= max,
		what,
	);
	return value;
}

export function oneOf<const Value extends string>(
	value: unknown,
	allowed: readonly Value[],
	what: string,
): Value {
	ensure(allowed.includes(value as Value), what);
	return value as Value;
}

function optionalId(value: unknown, what: string): string | null {
	return value === null ? null : stringValue(value, what);
}

export function timestamp(value: unknown, what: string): number {
	const time = numberValue(value, what);
	ensure(time >= 0, what);
	return time;
}

export function hashValue(value: unknown, what: string): string {
	const hash = stringValue(value, what);
	ensure(/^[\da-f]{64}$/.test(hash), what);
	return hash;
}

// Checks the envelope only and returns the stack itself, so effects this version
// does not know pass through unchanged (AC-F4.6).
export function stackValue(value: unknown, what: string): EffectStack {
	const stack = objectValue(value, what);
	integerValue(stack.schemaVersion, 1, Number.MAX_SAFE_INTEGER, what);
	const {instances} = stack;
	ensure(
		Array.isArray(instances) && instances.length <= MAX_STACK_INSTANCES,
		what,
	);
	for (const item of instances) {
		const instance = objectValue(item, what);
		stringValue(instance.id, what);
		ensure(stringValue(instance.type, what) !== '', what);
		integerValue(instance.version, 1, Number.MAX_SAFE_INTEGER, what);
		booleanValue(instance.enabled, what);
		objectValue(instance.params, what);
		const mix = numberValue(instance.mix, what);
		ensure(mix >= 0 && mix <= 1, what);
		stringValue(instance.blend, what);
	}

	return value as EffectStack;
}

function sideA(record: Record<string, unknown>, what: string) {
	if (record.stackA === undefined) {
		return {};
	}

	return {
		stackA: stackValue(record.stackA, what),
		selectedInstanceIdA: optionalId(record.selectedInstanceIdA ?? null, what),
	};
}

function withinSourceCap<Value extends StackPair>(
	record: Value,
	sourceHash: string,
): Value {
	ensure(
		extraSourceHashes(record, sourceHash).size <= MAX_EXTRA_SOURCES,
		'extra sources',
	);
	return record;
}

function transformValue(
	value: unknown,
	width: number,
	height: number,
): SourceTransform {
	const {transform, repaired} = resolveStoredGeometry(width, height, value);
	ensure(!repaired, 'transform');
	return transform;
}

function viewStateValue(value: unknown): ViewState {
	const state = objectValue(value, 'viewState');
	return normalizeViewState({
		fitMode: oneOf(state.fitMode, ['fit', 'custom'], 'fitMode'),
		zoom: numberValue(state.zoom, 'zoom'),
		centerX: numberValue(state.centerX, 'centerX'),
		centerY: numberValue(state.centerY, 'centerY'),
		splitPosition: numberValue(state.splitPosition, 'splitPosition'),
		splitOrientation: state.splitOrientation as ViewState['splitOrientation'],
		editSide: state.editSide as ViewState['editSide'],
	});
}

function exportSettingsValue(value: unknown): ExportSettings {
	const settings = objectValue(value, 'exportSettings');
	const {avifQuality, customLongestSide, maxFileSizeKb} = settings;
	return normalizeExportSettings({
		format: oneOf(
			settings.format,
			['png', 'jpeg', 'webp', 'avif', 'bmp', 'tiff'],
			'format',
		),
		quality: numberValue(settings.quality, 'quality'),
		...(avifQuality !== undefined && {
			avifQuality: numberValue(avifQuality, 'avifQuality'),
		}),
		sizeMode: oneOf(
			settings.sizeMode,
			['full', 'half', 'quarter', 'custom'],
			'sizeMode',
		),
		customLongestSide:
			customLongestSide === null
				? null
				: integerValue(customLongestSide, 1, MAX_SIDE, 'customLongestSide'),
		maxFileSizeKb:
			maxFileSizeKb === undefined || maxFileSizeKb === null
				? null
				: numberValue(maxFileSizeKb, 'maxFileSizeKb'),
	});
}

export function sourceExtension(mimeType: string): string {
	return SOURCE_EXTENSIONS[mimeType] ?? 'bin';
}

export function sourceEntryValue(value: unknown): ArchiveSourceEntry {
	const entry = objectValue(value, 'source entry');
	const sha256 = hashValue(entry.sha256, 'source sha256');
	const path = stringValue(entry.path, 'source path');
	ensure(
		path.startsWith(`sources/${sha256}.`) &&
			/^[\da-z]{1,8}$/.test(path.slice(`sources/${sha256}.`.length)),
		'source path',
	);
	return {
		sha256,
		path,
		mimeType: stringValue(entry.mimeType, 'source mimeType'),
		byteLength: integerValue(
			entry.byteLength,
			0,
			Number.MAX_SAFE_INTEGER,
			'source byteLength',
		),
		width: integerValue(entry.width, 1, MAX_SIDE, 'source width'),
		height: integerValue(entry.height, 1, MAX_SIDE, 'source height'),
	};
}

export function maskPath(sha256: string): string {
	return `masks/${sha256}.mask`;
}

function maskEntryValue(value: unknown): ArchiveMaskEntry {
	const entry = objectValue(value, 'mask entry');
	const sha256 = hashValue(entry.sha256, 'mask sha256');
	ensure(entry.path === maskPath(sha256), 'mask path');
	const width = integerValue(entry.width, 1, MASK_PIXEL_CAP, 'mask width');
	const height = integerValue(entry.height, 1, MASK_PIXEL_CAP, 'mask height');
	ensure(width * height <= MASK_PIXEL_CAP, 'mask grid');
	return {
		sha256,
		path: maskPath(sha256),
		width,
		height,
		byteLength: integerValue(
			entry.byteLength,
			0,
			Number.MAX_SAFE_INTEGER,
			'mask byteLength',
		),
	};
}

export function maskEntriesValue(value: unknown): ArchiveMaskEntry[] {
	ensure(Array.isArray(value), 'masks');
	const entries = value.map((entry) => maskEntryValue(entry));
	ensure(
		new Set(entries.map((entry) => entry.sha256)).size === entries.length,
		'masks',
	);
	return entries;
}

// Whether writing these stacks needs format version 2.
export function hasMask(stacks: ReadonlyArray<Partial<StackPair>>): boolean {
	return stacks.some((pair) =>
		[pair.stack, pair.stackA].some((stack) =>
			stack?.instances.some((instance) => instance.mask !== undefined),
		),
	);
}

// Every mask the project uses must be listed, on the grid of its source.
export function matchMasks(
	listed: ReadonlyMap<string, ArchiveMaskEntry>,
	project: ProjectFilePayload,
	history: readonly HistoryEntryRecord[] | null,
	missing: (path: string) => Error,
) {
	const grid = maskGridSize(project.sourceWidth, project.sourceHeight);
	for (const hash of referencedMaskHashes(project, history ?? [])) {
		const entry = listed.get(hash);
		if (!entry) {
			throw missing(maskPath(hash));
		}

		ensure(
			entry.width === grid.width && entry.height === grid.height,
			'mask grid',
		);
	}
}

export function manifestValue(
	value: Record<string, unknown>,
): ProjectFileManifest {
	const {sources, thumbnailPath} = value;
	ensure(Array.isArray(sources), 'sources');
	const entries = sources.map((entry) => sourceEntryValue(entry));
	ensure(
		new Set(entries.map((entry) => entry.sha256)).size === entries.length,
		'sources',
	);
	const exportedAt = stringValue(value.exportedAt, 'exportedAt');
	ensure(!Number.isNaN(Date.parse(exportedAt)), 'exportedAt');
	const formatVersion = value.formatVersion === 2 ? 2 : 1;
	return {
		kind: 'project',
		formatVersion,
		appVersion: stringValue(value.appVersion, 'appVersion'),
		exportedAt,
		includesHistory: booleanValue(value.includesHistory, 'includesHistory'),
		primarySourceHash: hashValue(value.primarySourceHash, 'primarySourceHash'),
		sources: entries,
		...(formatVersion === 2 && {masks: maskEntriesValue(value.masks)}),
		thumbnailPath:
			thumbnailPath === null
				? null
				: oneOf(
						thumbnailPath,
						['thumbnail.webp', 'thumbnail.jpg'],
						'thumbnailPath',
					),
	};
}

export function payloadValue(value: unknown): ProjectFilePayload {
	const project = objectValue(value, 'project');
	const name = stringValue(project.name, 'name').trim();
	ensure(name.length > 0 && name.length <= MAX_PROJECT_NAME_LENGTH, 'name');
	const sourceWidth = integerValue(
		project.sourceWidth,
		1,
		MAX_SIDE,
		'sourceWidth',
	);
	const sourceHeight = integerValue(
		project.sourceHeight,
		1,
		MAX_SIDE,
		'sourceHeight',
	);
	const seq = (key: 'historyHeadSeq' | 'historyMinSeq' | 'historyMaxSeq') =>
		integerValue(project[key], 0, Number.MAX_SAFE_INTEGER, key);
	const payload: ProjectFilePayload = {
		id: stringValue(project.id, 'id'),
		name,
		createdAt: timestamp(project.createdAt, 'createdAt'),
		updatedAt: timestamp(project.updatedAt, 'updatedAt'),
		openedAt: timestamp(project.openedAt, 'openedAt'),
		sourceHash: hashValue(project.sourceHash, 'sourceHash'),
		sourceWidth,
		sourceHeight,
		transform: transformValue(project.transform, sourceWidth, sourceHeight),
		stack: stackValue(project.stack, 'stack'),
		selectedInstanceId: optionalId(
			project.selectedInstanceId,
			'selectedInstanceId',
		),
		...sideA(project, 'stackA'),
		viewState: viewStateValue(project.viewState),
		exportSettings: exportSettingsValue(project.exportSettings),
		historyHeadSeq: seq('historyHeadSeq'),
		historyMinSeq: seq('historyMinSeq'),
		historyMaxSeq: seq('historyMaxSeq'),
	};
	return withinSourceCap(payload, payload.sourceHash);
}

export function historyValue(
	value: unknown,
	project: ProjectFilePayload,
): HistoryEntryRecord[] {
	const {entries} = objectValue(value, 'history');
	ensure(
		Array.isArray(entries) &&
			entries.length > 0 &&
			entries.length <= MAX_HISTORY_ENTRIES,
		'history entries',
	);
	const parsed = entries.map((item): HistoryEntryRecord => {
		const entry = objectValue(item, 'history entry');
		const record: HistoryEntryRecord = {
			projectId: stringValue(entry.projectId, 'history projectId'),
			seq: integerValue(entry.seq, 0, Number.MAX_SAFE_INTEGER, 'seq'),
			label: stringValue(entry.label, 'label'),
			stack: stackValue(entry.stack, 'history stack'),
			selectedInstanceId: optionalId(
				entry.selectedInstanceId,
				'history selectedInstanceId',
			),
			...sideA(entry, 'history stackA'),
			transform: transformValue(
				entry.transform,
				project.sourceWidth,
				project.sourceHeight,
			),
			createdAt: timestamp(entry.createdAt, 'history createdAt'),
		};
		return withinSourceCap(record, project.sourceHash);
	});
	const first = parsed[0].seq;
	ensure(
		parsed.every((entry, index) => entry.seq === first + index) &&
			project.historyMinSeq === first &&
			project.historyMaxSeq === first + parsed.length - 1 &&
			project.historyHeadSeq >= project.historyMinSeq &&
			project.historyHeadSeq <= project.historyMaxSeq,
		'history sequence',
	);
	return parsed;
}

// The rules that tie the manifest and the project together.
export function matchPrimarySource(
	manifest: ProjectFileManifest,
	project: ProjectFilePayload,
) {
	ensure(project.sourceHash === manifest.primarySourceHash, 'sourceHash');
	const primary = manifest.sources.find(
		(entry) => entry.sha256 === manifest.primarySourceHash,
	);
	if (primary) {
		ensure(
			manifest.sources[0] === primary &&
				primary.width === project.sourceWidth &&
				primary.height === project.sourceHeight,
			'primary source',
		);
	}

	return primary;
}
