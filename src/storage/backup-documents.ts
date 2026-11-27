// Reads and validates the JSON documents of a backup (persistence.md section
// 8.4.3). It takes entries from a reader, so a source other than a ZIP file
// shares it (section 11.1).
import {BackupError, backupImportMessage} from './backup-error.ts';
import {
	BACKUP_FORMAT_VERSION,
	backupManifestValue,
	backupSourceHashes,
	presetsValue,
	settingsValue,
	type BackupContents,
	type BackupProjectContents,
	type BackupProjectEntry,
} from './backup-format.ts';
import {
	InvalidMetadata,
	MAX_JSON_BYTES,
	PROJECT_FORMAT_VERSION,
	ensure,
	historyValue,
	matchMasks,
	migrateProjectDocuments,
	objectValue,
	payloadValue,
} from './project-format.ts';

export type BackupReader = {
	// The bytes of an entry, at most `limit` of them, or `undefined` when the
	// backup has no such entry.
	read(
		path: string,
		limit: number,
	): Promise<Uint8Array<ArrayBuffer> | undefined>;
};

type BackupProjectDocuments = Omit<BackupProjectContents, 'thumbnail'>;

type BackupDocuments = Pick<
	BackupContents,
	'manifest' | 'presets' | 'settings'
> & {
	// In the manifest's order.
	projects: BackupProjectDocuments[];
};

async function readJson(reader: BackupReader, path: string): Promise<unknown> {
	const bytes = await reader.read(path, MAX_JSON_BYTES);
	ensure(bytes !== undefined, path);
	try {
		return JSON.parse(
			new TextDecoder('utf-8', {fatal: true}).decode(bytes),
		) as unknown;
	} catch (error) {
		throw new InvalidMetadata(`Invalid JSON in ${path}`, {cause: error});
	}
}

// Throws unless `manifest[key]` is a version this app reads.
function checkVersion(
	manifest: Record<string, unknown>,
	key: string,
	supported: number,
): number {
	const version = manifest[key];
	ensure(version !== undefined, key);
	if (
		typeof version !== 'number' ||
		!Number.isSafeInteger(version) ||
		version > supported
	) {
		throw new BackupError(
			'newer-version',
			backupImportMessage('newer-version', {version}),
		);
	}

	ensure(version >= 1, key);
	return version;
}

async function readProject(
	reader: BackupReader,
	entry: BackupProjectEntry,
	formatVersion: number,
): Promise<BackupProjectDocuments> {
	// A backup has no manifest per project for a migrator to change.
	const documents = migrateProjectDocuments(
		{
			manifest: {},
			project: await readJson(reader, entry.path),
			history: entry.historyPath
				? await readJson(reader, entry.historyPath)
				: undefined,
		},
		formatVersion,
	);
	const project = payloadValue(documents.project);
	const history = entry.historyPath
		? historyValue(documents.history, project)
		: null;
	if (!history) {
		project.historyHeadSeq = 0;
		project.historyMinSeq = 0;
		project.historyMaxSeq = 0;
	}

	for (const key of [
		'id',
		'name',
		'sourceHash',
		'sourceWidth',
		'sourceHeight',
		'updatedAt',
	] as const) {
		ensure(project[key] === entry[key], key);
	}

	return {project, history};
}

/**
 Every document of a backup, checked against the manifest. Rejects with
 `BackupError` or `InvalidMetadata`, or as the reader does.
 */
export async function readBackupDocuments(
	reader: BackupReader,
): Promise<BackupDocuments> {
	const rawManifest = objectValue(
		await readJson(reader, 'manifest.json'),
		'manifest',
	);
	ensure(rawManifest.kind === 'backup', 'kind');
	checkVersion(rawManifest, 'backupVersion', BACKUP_FORMAT_VERSION);
	const formatVersion = checkVersion(
		rawManifest,
		'projectFormatVersion',
		PROJECT_FORMAT_VERSION,
	);
	const manifest = backupManifestValue(rawManifest);

	const presets = manifest.includesPresets
		? presetsValue(await readJson(reader, 'presets.json'))
		: null;
	ensure((presets?.length ?? 0) === manifest.presetCount, 'presetCount');
	const settings = manifest.includesSettings
		? settingsValue(await readJson(reader, 'settings.json'))
		: null;

	const listed = new Map(
		manifest.sources.map((source) => [source.sha256, source]),
	);
	const listedMasks = new Map(
		manifest.masks?.map((mask) => [mask.sha256, mask]),
	);
	const projects: BackupProjectDocuments[] = [];
	for (const entry of manifest.projects) {
		const read = await readProject(reader, entry, formatVersion);
		for (const hash of backupSourceHashes(read.project, read.history)) {
			if (!listed.has(hash)) {
				const path = `sources/${hash}`;
				throw new BackupError(
					'missing-source',
					backupImportMessage('missing-source', {path}),
				);
			}
		}

		const primary = listed.get(read.project.sourceHash)!;
		ensure(
			primary.width === read.project.sourceWidth &&
				primary.height === read.project.sourceHeight,
			'primary source',
		);
		matchMasks(
			listedMasks,
			read.project,
			read.history,
			(path) =>
				new BackupError(
					'missing-mask',
					backupImportMessage('missing-mask', {path}),
				),
		);
		projects.push(read);
	}

	return {manifest, presets, settings, projects};
}
