// The `.glproj` codec (persistence.md section 8.3) and the ZIP helpers the
// backup codec shares. It runs in the archive worker: the main thread must
// import only its types.
import {Zip, ZipDeflate, ZipPassThrough} from 'fflate';
import {repairProjectGeometry, resolveStoredGeometry} from './geometry.ts';
import {
	ProjectFileError,
	projectOpenMessage,
	projectSaveMessage,
	type ProjectFileErrorCode,
	type ProjectFileErrorDetail,
	type ProjectSaveErrorCode,
} from './project-file-error.ts';
import type {HistoryEntryRecord, ProjectRecord, SourceRecord} from './types.ts';
import {
	inSteps,
	readZipDirectory,
	readZipEntry,
	ZipFormatError,
	ZipLimitError,
	type ZipDirectory,
	type ZipEntry,
} from './zip-reader.ts';
import {
	PROJECT_FORMAT_VERSION,
	MAX_PROJECT_FILE_BYTES,
	MAX_JSON_BYTES,
	MAX_THUMBNAIL_BYTES,
	MAX_SOURCE_BYTES,
	JSON_PATHS,
	THUMBNAIL_TYPES,
	InvalidMetadata,
	migrateProjectDocuments,
	projectFileName,
	ensure,
	objectValue,
	sourceExtension,
	manifestValue,
	payloadValue,
	historyValue,
	matchPrimarySource,
	type ArchiveSourceEntry,
	type ThumbnailPath,
	type ProjectFileManifest,
	type ProjectFilePayload,
	type ProjectFileInput,
	type ProjectFileOutput,
	type ProjectFileContents,
	type ArchiveOptions,
} from './project-format.ts';

export {ProjectFileError} from './project-file-error.ts';
export * from './project-format.ts';

// Written chunks are folded into a blob at this size, so the browser can move
// them out of the JavaScript heap.
const WRITE_PART_BYTES = 8 * 1024 * 1024;

export async function sha256Hex(
	bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}

// Reports at most once per entry and whole percent.
export function progressReporter(
	total: number,
	onProgress: ArchiveOptions['onProgress'],
) {
	let done = 0;
	let reported = '';
	return (path: string, bytes: number) => {
		done += bytes;
		const fraction = total > 0 ? Math.min(1, done / total) : 1;
		const key = `${path} ${Math.floor(fraction * 100)}`;
		if (key === reported) {
			return;
		}

		reported = key;
		onProgress?.({path, fraction});
	};
}

type ZipWriter = {
	addJson(path: string, bytes: Uint8Array): void;
	addMedia(
		path: string,
		blob: Blob,
		onBytes: (count: number) => void,
	): Promise<void>;
	finish(): Blob;
};

export function createZipWriter(mtime: Date, signal?: AbortSignal): ZipWriter {
	const parts: Blob[] = [];
	let pending: Array<Uint8Array<ArrayBuffer>> = [];
	let pendingBytes = 0;
	let failure: Error | undefined;
	const zip = new Zip((error, chunk) => {
		if (error) {
			failure = error;
			return;
		}

		pending.push(chunk);
		pendingBytes += chunk.length;
	});
	const fold = () => {
		if (failure) {
			throw failure;
		}

		parts.push(new Blob(pending));
		pending = [];
		pendingBytes = 0;
	};

	const add = (file: ZipPassThrough | ZipDeflate) => {
		file.mtime = mtime;
		zip.add(file);
	};

	return {
		addJson(path, bytes) {
			const file = new ZipDeflate(path, {level: 6});
			add(file);
			file.push(bytes, true);
		},
		async addMedia(path, blob, onBytes) {
			const file = new ZipPassThrough(path);
			add(file);
			const reader = blob.stream().getReader();
			try {
				for (;;) {
					signal?.throwIfAborted();
					const {done, value} = await reader.read();
					if (done) {
						break;
					}

					for (const step of inSteps(value)) {
						signal?.throwIfAborted();
						file.push(step);
						onBytes(step.length);
						if (pendingBytes >= WRITE_PART_BYTES) {
							fold();
						}
					}
				}
			} finally {
				void reader.cancel().catch(() => undefined);
			}

			file.push(new Uint8Array(), true);
		},
		finish() {
			zip.end();
			fold();
			return new Blob(parts, {type: 'application/zip'});
		},
	};
}

function saveError(
	code: ProjectSaveErrorCode,
	projectName: string,
	cause?: unknown,
): ProjectFileError {
	return new ProjectFileError(code, projectSaveMessage(code, projectName), {
		cause,
	});
}

// A stored project as `project.json` holds it.
export function savedPayload(
	record: ProjectRecord,
	history: boolean,
): ProjectFilePayload {
	const project = repairProjectGeometry(record);
	return payloadValue({
		id: project.id,
		name: project.name,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
		openedAt: project.openedAt,
		sourceHash: project.sourceHash,
		sourceWidth: project.sourceWidth,
		sourceHeight: project.sourceHeight,
		transform: project.transform,
		stack: project.stack,
		selectedInstanceId: project.selectedInstanceId,
		...(project.stackA &&
			project.stackA.instances.length > 0 && {
				stackA: project.stackA,
				selectedInstanceIdA: project.selectedInstanceIdA ?? null,
			}),
		viewState: project.viewState,
		exportSettings: project.exportSettings,
		historyHeadSeq: history ? project.historyHeadSeq : 0,
		historyMinSeq: history ? project.historyMinSeq : 0,
		historyMaxSeq: history ? project.historyMaxSeq : 0,
	});
}

export function savedHistory(
	entries: readonly HistoryEntryRecord[],
	project: ProjectFilePayload,
): HistoryEntryRecord[] {
	return historyValue(
		{
			entries: entries
				.toSorted((a, b) => a.seq - b.seq)
				.map((entry) => ({
					...entry,
					transform: resolveStoredGeometry(
						project.sourceWidth,
						project.sourceHeight,
						entry.transform,
					).transform,
				})),
		},
		project,
	);
}

// The entry name for a thumbnail, or `null` when it is left out of archives.
export function thumbnailPathFor(thumbnail: Blob): ThumbnailPath | null {
	if (thumbnail.size > MAX_THUMBNAIL_BYTES) {
		return null;
	}

	return (
		(Object.keys(THUMBNAIL_TYPES) as ThumbnailPath[]).find(
			(path) => THUMBNAIL_TYPES[path] === thumbnail.type,
		) ?? null
	);
}

// The manifest entry of a stored source.
export function archiveSource(source: SourceRecord): ArchiveSourceEntry {
	return {
		sha256: source.sha256,
		path: `sources/${source.sha256}.${sourceExtension(source.mimeType)}`,
		mimeType: source.mimeType,
		byteLength: source.blob.size,
		width: source.width,
		height: source.height,
	};
}

/**
 Builds a `.glproj` archive without decoding any pixels. Rejects with
 `ProjectFileError`, or with the signal's reason when cancelled.
 */
export async function writeProjectFile(
	input: ProjectFileInput,
	{signal, onProgress}: ArchiveOptions = {},
): Promise<ProjectFileOutput> {
	signal?.throwIfAborted();
	const {name} = input.project;
	const exportedAt = input.exportedAt ?? new Date();
	let project: ProjectFilePayload;
	let history: HistoryEntryRecord[] | null;
	let manifest: ProjectFileManifest;
	const media: Array<{path: string; blob: Blob}> = [];
	try {
		project = savedPayload(input.project, input.history !== undefined);
		history = input.history ? savedHistory(input.history, project) : null;

		const bySha = new Map(
			input.sources.map((source) => [source.sha256, source]),
		);
		const primary = bySha.get(project.sourceHash);
		if (!primary) {
			throw saveError('missing-source', name);
		}

		bySha.delete(project.sourceHash);

		const {thumbnail} = input;
		const thumbnailPath = thumbnail ? thumbnailPathFor(thumbnail) : null;
		if (thumbnailPath) {
			media.push({path: thumbnailPath, blob: thumbnail!});
		}

		const sources = [primary, ...bySha.values()].map((source) => {
			if (source.blob.size > MAX_SOURCE_BYTES) {
				throw saveError('too-large', name);
			}

			const entry = archiveSource(source);
			media.push({path: entry.path, blob: source.blob});
			return entry;
		});
		manifest = manifestValue({
			kind: 'project',
			formatVersion: PROJECT_FORMAT_VERSION,
			appVersion: input.appVersion,
			exportedAt: exportedAt.toISOString(),
			includesHistory: history !== null,
			primarySourceHash: project.sourceHash,
			sources,
			thumbnailPath,
		});
		matchPrimarySource(manifest, project);
	} catch (error) {
		if (error instanceof InvalidMetadata) {
			throw saveError('invalid-metadata', name, error);
		}

		throw error;
	}

	const encoder = new TextEncoder();
	const documents: Array<[string, unknown]> = [
		['manifest.json', manifest],
		['project.json', project],
		...(history
			? [['history.json', {entries: history}] as [string, unknown]]
			: []),
	];
	const json = documents.map(
		([path, value]) => [path, encoder.encode(JSON.stringify(value))] as const,
	);
	const mediaBytes = media.reduce((sum, item) => sum + item.blob.size, 0);
	const totalBytes = json.reduce(
		(sum, [, bytes]) => sum + bytes.length,
		mediaBytes,
	);
	if (
		json.some(([, bytes]) => bytes.length > MAX_JSON_BYTES) ||
		totalBytes > MAX_PROJECT_FILE_BYTES
	) {
		throw saveError('too-large', name);
	}

	const zip = createZipWriter(exportedAt, signal);
	for (const [path, bytes] of json) {
		zip.addJson(path, bytes);
	}

	const report = progressReporter(mediaBytes, onProgress);
	for (const {path, blob} of media) {
		report(path, 0);
		await zip.addMedia(path, blob, (count) => {
			report(path, count);
		});
	}

	const blob = zip.finish();
	if (blob.size > MAX_PROJECT_FILE_BYTES) {
		throw saveError('too-large', name);
	}

	signal?.throwIfAborted();
	return {blob, fileName: projectFileName(project.name, exportedAt)};
}

function entryLimit(path: string): number | undefined {
	if (JSON_PATHS.includes(path)) {
		return MAX_JSON_BYTES;
	}

	if (Object.hasOwn(THUMBNAIL_TYPES, path)) {
		return MAX_THUMBNAIL_BYTES;
	}

	return path.startsWith('sources/') ? MAX_SOURCE_BYTES : undefined;
}

async function readJson(
	file: Blob,
	directory: ZipDirectory,
	path: string,
	signal?: AbortSignal,
): Promise<unknown> {
	const entry = directory.entries.get(path);
	ensure(entry !== undefined, path);
	const bytes = await readZipEntry(file, directory, entry, {
		limit: MAX_JSON_BYTES,
		signal,
	});
	try {
		return JSON.parse(
			new TextDecoder('utf-8', {fatal: true}).decode(bytes),
		) as unknown;
	} catch (error) {
		throw new InvalidMetadata(`Invalid JSON in ${path}`, {cause: error});
	}
}

async function readContents(
	file: Blob,
	openError: (
		code: ProjectFileErrorCode,
		detail?: ProjectFileErrorDetail,
	) => ProjectFileError,
	{signal, onProgress}: ArchiveOptions,
): Promise<ProjectFileContents> {
	if (file.size > MAX_PROJECT_FILE_BYTES) {
		throw openError('too-large');
	}

	const directory = await readZipDirectory(file);
	for (const entry of directory.entries.values()) {
		if (entry.size > (entryLimit(entry.name) ?? entry.size)) {
			throw openError('too-large');
		}
	}

	const rawManifest = objectValue(
		await readJson(file, directory, 'manifest.json', signal),
		'manifest',
	);
	ensure(rawManifest.kind === 'project', 'kind');
	const {formatVersion} = rawManifest;
	ensure(formatVersion !== undefined, 'formatVersion');
	if (
		typeof formatVersion !== 'number' ||
		!Number.isSafeInteger(formatVersion) ||
		formatVersion > PROJECT_FORMAT_VERSION
	) {
		throw openError('newer-version', {version: formatVersion});
	}

	ensure(formatVersion >= 1, 'formatVersion');
	const documents = migrateProjectDocuments(
		{
			manifest: rawManifest,
			project: await readJson(file, directory, 'project.json', signal),
			history:
				rawManifest.includesHistory === true
					? await readJson(file, directory, 'history.json', signal)
					: undefined,
		},
		formatVersion,
	);
	const manifest = manifestValue(documents.manifest);
	const project = payloadValue(documents.project);
	const history = manifest.includesHistory
		? historyValue(documents.history, project)
		: null;
	if (!history) {
		project.historyHeadSeq = 0;
		project.historyMinSeq = 0;
		project.historyMaxSeq = 0;
	}

	if (!matchPrimarySource(manifest, project)) {
		throw openError('missing-source', {
			path: `sources/${manifest.primarySourceHash}`,
		});
	}

	const sourceEntries = manifest.sources.map((source) => {
		const entry = directory.entries.get(source.path);
		if (!entry) {
			throw openError('missing-source', {path: source.path});
		}

		return {source, entry};
	});
	const thumbnailEntry = manifest.thumbnailPath
		? directory.entries.get(manifest.thumbnailPath)
		: undefined;
	const media: ZipEntry[] = [
		...sourceEntries.map(({entry}) => entry),
		...(thumbnailEntry ? [thumbnailEntry] : []),
	];
	const mediaBytes = media.reduce((sum, entry) => sum + entry.size, 0);
	const metadataBytes = JSON_PATHS.map(
		(path) => directory.entries.get(path)?.size ?? 0,
	).reduce((sum, size) => sum + size, 0);
	if (mediaBytes + metadataBytes > MAX_PROJECT_FILE_BYTES) {
		throw openError('too-large');
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

	const sources: ProjectFileContents['sources'] = [];
	for (const {source, entry} of sourceEntries) {
		const bytes = await readMedia(entry, MAX_SOURCE_BYTES);
		if (
			bytes.length !== source.byteLength ||
			(await sha256Hex(bytes)) !== source.sha256
		) {
			throw openError('damaged-source', {path: source.path});
		}

		sources.push({
			...source,
			blob: new Blob([bytes], {type: source.mimeType}),
		});
	}

	let thumbnail: Blob | null = null;
	if (thumbnailEntry) {
		thumbnail = new Blob(
			[await readMedia(thumbnailEntry, MAX_THUMBNAIL_BYTES)],
			{type: THUMBNAIL_TYPES[manifest.thumbnailPath!]},
		);
	}

	signal?.throwIfAborted();
	return {manifest, project, history, sources, thumbnail};
}

/**
 Reads and fully validates a `.glproj` file; it writes nothing. Rejects with
 `ProjectFileError` carrying the message to show, or with the signal's reason
 when cancelled.
 */
export async function readProjectFile(
	file: Blob,
	fileName: string,
	options: ArchiveOptions = {},
): Promise<ProjectFileContents> {
	const openError = (
		code: ProjectFileErrorCode,
		detail?: ProjectFileErrorDetail,
		cause?: unknown,
	) =>
		new ProjectFileError(code, projectOpenMessage(code, fileName, detail), {
			cause,
		});
	try {
		options.signal?.throwIfAborted();
		return await readContents(file, openError, options);
	} catch (error) {
		if (error instanceof ZipFormatError) {
			throw openError('damaged', undefined, error);
		}

		if (error instanceof ZipLimitError) {
			throw openError('too-large', undefined, error);
		}

		if (error instanceof InvalidMetadata) {
			throw openError('invalid-metadata', undefined, error);
		}

		throw error;
	}
}
