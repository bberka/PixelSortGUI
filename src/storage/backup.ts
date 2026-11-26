// The backup ZIP codec (persistence.md section 8.4). It runs in the archive
// worker: the main thread must import only its types.
import {
	BackupError,
	backupExportMessage,
	backupImportMessage,
	type BackupExportErrorCode,
	type BackupImportErrorCode,
	type BackupImportErrorDetail,
} from './backup-error.ts';
import {readBackupDocuments} from './backup-documents.ts';
import {
	BACKUP_FORMAT_VERSION,
	MAX_BACKUP_BYTES,
	MAX_BACKUP_ENTRIES,
	backupFileName,
	backupManifestValue,
	backupProjectPaths,
	backupSourceHashes,
	presetsValue,
	projectIdValue,
	settingsValue,
	type BackupContents,
	type BackupInput,
	type BackupManifest,
	type BackupOutput,
	type BackupProjectContents,
	type BackupProjectEntry,
} from './backup-format.ts';
import {
	archiveSource,
	createZipWriter,
	progressReporter,
	savedHistory,
	savedPayload,
	sha256Hex,
	thumbnailPathFor,
} from './project-file.ts';
import {
	InvalidMetadata,
	MAX_JSON_BYTES,
	MAX_SOURCE_BYTES,
	MAX_THUMBNAIL_BYTES,
	PROJECT_FORMAT_VERSION,
	THUMBNAIL_TYPES,
	ensure,
	type ArchiveOptions,
	type ArchiveSourceEntry,
	type ThumbnailPath,
} from './project-format.ts';
import {
	readZipDirectory,
	readZipEntry,
	zipEntryData,
	ZipFormatError,
	ZipLimitError,
	type ZipEntry,
} from './zip-reader.ts';

function exportError(
	code: BackupExportErrorCode,
	projectName?: string,
	cause?: unknown,
): BackupError {
	return new BackupError(code, backupExportMessage(code, projectName), {cause});
}

// Runs `build`, naming what is wrong when a stored record breaks the format.
function checked<Value>(
	build: () => Value,
	code: BackupExportErrorCode,
	projectName?: string,
): Value {
	try {
		return build();
	} catch (error) {
		if (error instanceof InvalidMetadata) {
			throw exportError(code, projectName, error);
		}

		throw error;
	}
}

type Media = {path: string; blob: Blob};

/**
 Builds a backup archive without decoding any pixels. Every limit is checked
 before the first image is packed. Rejects with `BackupError`, or with the
 signal's reason when cancelled.
 */
export async function writeBackup(
	input: BackupInput,
	{signal, onProgress}: ArchiveOptions = {},
): Promise<BackupOutput> {
	signal?.throwIfAborted();
	const exportedAt = input.exportedAt ?? new Date();
	const encoder = new TextEncoder();
	const documents: Array<[string, Uint8Array]> = [];
	const media: Media[] = [];
	let totalBytes = 0;
	const reserve = (bytes: number) => {
		totalBytes += bytes;
		if (
			totalBytes > MAX_BACKUP_BYTES ||
			documents.length + media.length > MAX_BACKUP_ENTRIES
		) {
			throw exportError('export-too-large');
		}
	};

	const addJson = (path: string, value: unknown) => {
		const bytes = encoder.encode(JSON.stringify(value));
		if (bytes.length > MAX_JSON_BYTES) {
			throw exportError('export-too-large');
		}

		documents.push([path, bytes]);
		reserve(bytes.length);
	};

	const addMedia = (path: string, blob: Blob) => {
		media.push({path, blob});
		reserve(blob.size);
	};

	const stored = new Map(
		input.sources.map((source) => [source.sha256, source]),
	);
	const sources = new Map<string, ArchiveSourceEntry>();
	const projects: BackupProjectEntry[] = [];
	const ids = new Set<string>();
	for (const item of input.projects) {
		signal?.throwIfAborted();
		const {name} = item.project;
		const {payload, history} = checked(
			() => {
				const payload = savedPayload(item.project, input.includesHistory);
				ensure(!ids.has(projectIdValue(payload.id)), 'project id');
				return {
					payload,
					history: input.includesHistory
						? savedHistory(item.history ?? [], payload)
						: null,
				};
			},
			'export-invalid-project',
			name,
		);
		ids.add(payload.id);

		let totalSourceBytes = 0;
		for (const hash of backupSourceHashes(payload)) {
			const source = stored.get(hash);
			if (!source) {
				throw exportError('export-missing-source', name);
			}

			// An import refuses sizes that disagree, so the export must too.
			if (
				hash === payload.sourceHash &&
				(source.width !== payload.sourceWidth ||
					source.height !== payload.sourceHeight)
			) {
				throw exportError('export-invalid-project', name);
			}

			if (!sources.has(hash)) {
				if (source.blob.size > MAX_SOURCE_BYTES) {
					throw exportError('export-too-large');
				}

				const entry = archiveSource(source);
				sources.set(hash, entry);
				addMedia(entry.path, source.blob);
			}

			totalSourceBytes += source.blob.size;
		}

		const paths = backupProjectPaths(payload.id);
		addJson(paths.project, payload);
		if (history) {
			addJson(paths.history, {entries: history});
		}

		const {thumbnail} = item;
		const thumbnailName = thumbnail ? thumbnailPathFor(thumbnail) : null;
		const thumbnailPath = thumbnailName ? paths.thumbnail(thumbnailName) : null;
		if (thumbnailPath) {
			addMedia(thumbnailPath, thumbnail!);
		}

		projects.push({
			id: payload.id,
			name: payload.name,
			sourceHash: payload.sourceHash,
			sourceWidth: payload.sourceWidth,
			sourceHeight: payload.sourceHeight,
			updatedAt: payload.updatedAt,
			path: paths.project,
			historyPath: history ? paths.history : null,
			thumbnailPath,
			totalSourceBytes,
		});
	}

	const {presets, settings} = input;
	if (presets) {
		addJson('presets.json', {
			presets: checked(() => presetsValue({presets}), 'export-invalid-record'),
		});
	}

	if (settings) {
		addJson(
			'settings.json',
			checked(() => settingsValue(settings), 'export-invalid-record'),
		);
	}

	const manifest: BackupManifest = checked(
		() =>
			backupManifestValue({
				kind: 'backup',
				backupVersion: BACKUP_FORMAT_VERSION,
				projectFormatVersion: PROJECT_FORMAT_VERSION,
				appVersion: input.appVersion,
				exportedAt: exportedAt.toISOString(),
				scope: input.scope,
				includesHistory: input.includesHistory,
				includesPresets: presets !== undefined,
				includesSettings: settings !== undefined,
				sources: [...sources.values()],
				projects,
				presetCount: presets?.length ?? 0,
			}),
		'export-invalid-record',
	);
	addJson('manifest.json', manifest);

	const zip = createZipWriter(exportedAt, signal);
	// The manifest was built last and goes first.
	for (const [path, bytes] of [documents.at(-1)!, ...documents.slice(0, -1)]) {
		zip.addJson(path, bytes);
	}

	const report = progressReporter(
		media.reduce((sum, item) => sum + item.blob.size, 0),
		onProgress,
	);
	for (const {path, blob} of media) {
		report(path, 0);
		await zip.addMedia(path, blob, (count) => {
			report(path, count);
		});
	}

	const blob = zip.finish();
	if (blob.size > MAX_BACKUP_BYTES) {
		throw exportError('export-too-large');
	}

	signal?.throwIfAborted();
	return {blob, fileName: backupFileName(exportedAt)};
}

function thumbnailEntryName(path: string): ThumbnailPath {
	return path.slice(path.lastIndexOf('/') + 1) as ThumbnailPath;
}

// The cap of an entry the layout knows; other entries are never read.
function entryLimit(path: string): number | undefined {
	if (
		['manifest.json', 'presets.json', 'settings.json'].includes(path) ||
		/^projects\/[^/]+\/(?:project|history)\.json$/.test(path)
	) {
		return MAX_JSON_BYTES;
	}

	if (/^projects\/[^/]+\/thumbnail\.(?:webp|jpg)$/.test(path)) {
		return MAX_THUMBNAIL_BYTES;
	}

	return path.startsWith('sources/') ? MAX_SOURCE_BYTES : undefined;
}

function importError(
	code: BackupImportErrorCode,
	detail?: BackupImportErrorDetail,
	cause?: unknown,
): BackupError {
	return new BackupError(code, backupImportMessage(code, detail), {cause});
}

async function readContents(
	file: Blob,
	{signal, onProgress}: ArchiveOptions,
): Promise<BackupContents> {
	if (file.size > MAX_BACKUP_BYTES) {
		throw importError('too-large');
	}

	const directory = await readZipDirectory(file);
	// The declared sizes, before any data is read.
	let declaredBytes = 0;
	for (const entry of directory.entries.values()) {
		declaredBytes += entry.size;
		if (entry.size > (entryLimit(entry.name) ?? entry.size)) {
			throw importError('too-large');
		}
	}

	if (declaredBytes > MAX_BACKUP_BYTES) {
		throw importError('too-large');
	}

	const documents = await readBackupDocuments({
		async read(path, limit) {
			const entry = directory.entries.get(path);
			return entry && readZipEntry(file, directory, entry, {limit, signal});
		},
	});
	const {manifest, presets, settings} = documents;

	const sourceEntries = manifest.sources.map((source) => {
		const entry = directory.entries.get(source.path);
		if (!entry) {
			throw importError('missing-source', {path: source.path});
		}

		return {source, entry};
	});
	const thumbnailEntries = manifest.projects.map((project) =>
		project.thumbnailPath
			? directory.entries.get(project.thumbnailPath)
			: undefined,
	);

	let mediaBytes = 0;
	for (const entry of [
		...sourceEntries.map(({entry}) => entry),
		...thumbnailEntries,
	]) {
		mediaBytes += entry?.size ?? 0;
	}

	const report = progressReporter(mediaBytes, onProgress);
	const readMedia = async (entry: ZipEntry, limit: number) => {
		report(entry.name, 0);
		return readZipEntry(file, directory, entry, {
			limit,
			signal,
			onBytes(count) {
				report(entry.name, count);
			},
		});
	};

	const sources: BackupContents['sources'] = [];
	for (const {source, entry} of sourceEntries) {
		const bytes = await readMedia(entry, MAX_SOURCE_BYTES);
		if (
			bytes.length !== source.byteLength ||
			(await sha256Hex(bytes)) !== source.sha256
		) {
			throw importError('damaged-source', {path: source.path});
		}

		// A stored entry stays on disk as a slice of the file, so a large backup
		// does not have to fit in memory.
		const blob =
			entry.method === 0
				? (await zipEntryData(file, entry, directory.dataEnd)).slice(
						0,
						bytes.length,
						source.mimeType,
					)
				: new Blob([bytes], {type: source.mimeType});
		sources.push({...source, blob});
	}

	const projects: BackupProjectContents[] = [];
	for (const [index, read] of documents.projects.entries()) {
		const entry = thumbnailEntries[index];
		projects.push({
			...read,
			thumbnail: entry
				? new Blob([await readMedia(entry, MAX_THUMBNAIL_BYTES)], {
						type: THUMBNAIL_TYPES[thumbnailEntryName(entry.name)],
					})
				: null,
		});
	}

	signal?.throwIfAborted();
	return {manifest, projects, sources, presets, settings};
}

/**
 Reads and fully validates a backup; it writes nothing. Rejects with
 `BackupError` carrying the message to show, or with the signal's reason when
 cancelled.
 */
export async function readBackup(
	file: Blob,
	options: ArchiveOptions = {},
): Promise<BackupContents> {
	try {
		options.signal?.throwIfAborted();
		return await readContents(file, options);
	} catch (error) {
		if (error instanceof ZipFormatError) {
			throw importError('damaged', undefined, error);
		}

		if (error instanceof ZipLimitError) {
			throw importError('too-large', undefined, error);
		}

		if (error instanceof InvalidMetadata) {
			throw importError('invalid-manifest', undefined, error);
		}

		throw error;
	}
}
