// Backup export, inspection and the four-phase import, shared by both storage
// adapters (persistence.md section 8.4).
import {probeImageDimensions} from '../codec/decode.ts';
import {canonicalJson, canonicalStackJson} from '../engine/types.ts';
import {getAppVersionLabel} from '../lib/app-version.ts';
import {MAX_THUMBNAIL_SIDE} from '../state/thumbnail.ts';
import type {openBackup, saveBackup} from './archive-client.ts';
import {BackupError, backupImportMessage} from './backup-error.ts';
import {
	backupSourceHashes,
	type BackupContents,
	type BackupInput,
	type BackupOptions,
	type BackupOutput,
	type BackupProjectContents,
	type BackupSettingsPayload,
} from './backup-format.ts';
import {repairProjectGeometry, resolveStoredGeometry} from './geometry.ts';
import {
	buildProjectRecords,
	importedProjectName,
	toSourceRecord,
	type ImportedRecords,
	type ImportedThumbnail,
	type ProjectTransferDependencies,
} from './project-transfer.ts';
import {
	StorageNotFoundError,
	StorageValidationError,
	type ProjectRecord,
	type SourceRecord,
	type UserPresetRecord,
} from './types.ts';

// Loaded on first use, so the app starts without it.
const loadArchive = async () => import('./archive-client.ts');

// Replaced by tests: Node has no workers and no image decoder.
export type BackupTransferDependencies = Pick<
	ProjectTransferDependencies,
	'probeImage'
> & {
	backupArchive?: {
		save: typeof saveBackup;
		open: typeof openBackup;
	};
};

export type BackupProjectStatus = 'New' | 'Unchanged' | 'Modified locally';

export type BackupPreviewProject = {
	id: string;
	name: string;
	// The size after the geometry transform, as library cards show it.
	width: number;
	height: number;
	sourceHashes: string[];
	sourceBytes: number;
	status: BackupProjectStatus;
};

export type BackupPreview = {
	projects: BackupPreviewProject[];
	// `null` when the backup leaves presets out.
	presetCount: number | null;
	hasSettings: boolean;
	// What Replace would delete.
	localProjectCount: number;
	localPresetCount: number;
	// Bytes of each source of the backup that is not stored yet.
	newSources: Record<string, number>;
};

// A backup that passed every check, ready to import.
export type BackupInspection = {
	contents: BackupContents;
	// The thumbnails that decode, by the project id in the backup.
	thumbnails: ReadonlyMap<string, ImportedThumbnail>;
	preview: BackupPreview;
};

export type BackupSelection = {
	mode: 'merge' | 'replace';
	projectIds: readonly string[];
	presets: boolean;
	settings: boolean;
};

export type BackupImportResult = {
	mode: BackupSelection['mode'];
	// The records written, in the backup's order.
	projects: ProjectRecord[];
	skippedProjectCount: number;
	presets: UserPresetRecord[];
	skippedPresetCount: number;
	// The settings applied, or `null`.
	settings: BackupSettingsPayload | null;
};

export type BackupLibrary = {
	projects: readonly ProjectRecord[];
	presets: readonly UserPresetRecord[];
};

export type BackupPlan = BackupImportResult & {
	// Every source the written projects need.
	sources: BackupContents['sources'];
	records: ImportedRecords[];
};

// What the four phases need from a storage adapter.
export type BackupImportStore = {
	// Rejects with `StorageQuotaError` when `bytes` of new images do not fit.
	checkQuota(bytes: number): Promise<void>;
	hasSource(sha256: string): Promise<boolean>;
	// Stores `source` unless it is there; `true` when this call inserted it.
	stageSource(source: SourceRecord, signal?: AbortSignal): Promise<boolean>;
	// Reads the library, plans from it and writes the plan, all or nothing.
	commit(
		plan: (library: BackupLibrary) => BackupPlan,
		signal?: AbortSignal,
	): Promise<BackupPlan>;
	// Deletes those of the sources that no project refers to.
	discardSources(hashes: readonly string[]): Promise<void>;
	cleanupOrphanedSources(): Promise<number>;
	cleanupOrphanedMasks(): Promise<number>;
};

// The projects an export covers, in the order given.
export function chooseBackupProjects(
	all: readonly ProjectRecord[],
	ids: readonly string[] | undefined,
): {projects: ProjectRecord[]; scope: BackupInput['scope']} {
	if (!ids) {
		return {projects: [...all], scope: 'library'};
	}

	const wanted = new Set(ids);
	const projects = all.filter((project) => wanted.has(project.id));
	if (projects.length !== wanted.size) {
		const found = new Set(projects.map((project) => project.id));
		const missing = [...wanted].find((id) => !found.has(id));
		throw new StorageNotFoundError(`Project "${missing}" not found`);
	}

	return {
		projects,
		scope: projects.length === all.length ? 'library' : 'selection',
	};
}

export async function writeBackupArchive(
	input: Omit<BackupInput, 'appVersion'>,
	{signal, onProgress}: BackupOptions,
	{backupArchive}: BackupTransferDependencies,
): Promise<BackupOutput> {
	const save = backupArchive?.save ?? (await loadArchive()).saveBackup;
	onProgress?.({stage: 'packing', fraction: 0});
	return save(
		{...input, appVersion: getAppVersionLabel()},
		{
			signal,
			onProgress({path, fraction}) {
				onProgress?.({stage: 'packing', path, fraction});
			},
		},
	);
}

// What decides whether a stored project is the one in the backup.
function comparisonKey(
	project: Pick<
		ProjectRecord,
		'sourceHash' | 'name' | 'updatedAt' | 'transform' | 'stack' | 'stackA'
	>,
): string {
	const {sourceHash, name, updatedAt, transform, stack, stackA} = project;
	return canonicalJson({
		sourceHash,
		name,
		updatedAt,
		transform,
		stack,
		stackA: stackA?.instances.length ? stackA : undefined,
	});
}

function backupProjectStatus(
	project: BackupProjectContents['project'],
	local: ProjectRecord | undefined,
): BackupProjectStatus {
	if (!local) {
		return 'New';
	}

	return comparisonKey(repairProjectGeometry(local)) === comparisonKey(project)
		? 'Unchanged'
		: 'Modified locally';
}

function buildPreview(
	contents: BackupContents,
	library: BackupLibrary,
	storedHashes: ReadonlySet<string>,
): BackupPreview {
	const local = new Map(library.projects.map((item) => [item.id, item]));
	const sizes = new Map(
		contents.sources.map((source) => [source.sha256, source.byteLength]),
	);
	return {
		projects: contents.projects.map(({project, history}) => {
			const {effectiveWidth, effectiveHeight} = resolveStoredGeometry(
				project.sourceWidth,
				project.sourceHeight,
				project.transform,
			);
			const sourceHashes = backupSourceHashes(project, history);
			return {
				id: project.id,
				name: project.name,
				width: effectiveWidth,
				height: effectiveHeight,
				sourceHashes,
				sourceBytes: sourceHashes.reduce(
					(sum, hash) => sum + (sizes.get(hash) ?? 0),
					0,
				),
				status: backupProjectStatus(project, local.get(project.id)),
			};
		}),
		presetCount: contents.presets?.length ?? null,
		hasSettings: contents.settings !== null,
		localProjectCount: library.projects.length,
		localPresetCount: library.presets.length,
		newSources: Object.fromEntries(
			[...sizes].filter(([hash]) => !storedHashes.has(hash)),
		),
	};
}

// Bytes of new images that importing these projects stores.
export function backupNewBytes(
	preview: BackupPreview,
	projectIds: readonly string[],
): number {
	const chosen = new Set(projectIds);
	const hashes = new Set(
		preview.projects
			.filter((project) => chosen.has(project.id))
			.flatMap((project) => project.sourceHashes),
	);
	let bytes = 0;
	for (const hash of hashes) {
		bytes += preview.newSources[hash] ?? 0;
	}

	return bytes;
}

// Rejects as soon as `signal` aborts, without waiting for `work`.
async function untilAborted<Value>(
	work: Promise<Value>,
	signal: AbortSignal | undefined,
): Promise<Value> {
	if (!signal) {
		return work;
	}

	signal.throwIfAborted();
	let abort: (() => void) | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_resolve, reject) => {
				abort = () => {
					reject(signal.reason as Error);
				};

				signal.addEventListener('abort', abort);
			}),
		]);
	} finally {
		signal.removeEventListener('abort', abort!);
	}
}

/**
 Reads, validates and decodes a backup, and compares it with the library; it
 writes nothing.
 */
export async function inspectBackupArchive(
	file: Blob,
	{signal, onProgress}: BackupOptions,
	{
		backupArchive,
		probeImage = probeImageDimensions,
	}: BackupTransferDependencies,
	library: {
		findSource(sha256: string): Promise<SourceRecord | undefined>;
		read(): Promise<BackupLibrary>;
	},
): Promise<BackupInspection> {
	const open = backupArchive?.open ?? (await loadArchive()).openBackup;
	// Reading and hashing fill the first half of the stage, decoding the second.
	const report = (fraction: number, path?: string) => {
		onProgress?.({stage: 'validating', fraction, path});
	};

	report(0);
	const contents = await open(file, {
		signal,
		onProgress({path, fraction}) {
			report(fraction / 2, path);
		},
	});
	const importError = (code: 'invalid-manifest' | 'unreadable-image') =>
		new BackupError(code, backupImportMessage(code));

	const images =
		contents.sources.length +
		contents.projects.filter((item) => item.thumbnail).length;
	let checkedImages = 0;
	const step = () => {
		checkedImages++;
		report(0.5 + checkedImages / images / 2);
	};

	const storedHashes = new Set<string>();
	for (const source of contents.sources) {
		signal?.throwIfAborted();
		const stored = await library.findSource(source.sha256);
		let size: {width: number; height: number};
		if (stored) {
			storedHashes.add(source.sha256);
			size = stored;
		} else {
			const probed = await untilAborted(probeImage(source.blob), signal);
			if (!probed.ok) {
				throw importError('unreadable-image');
			}

			size = probed.value;
		}

		if (size.width !== source.width || size.height !== source.height) {
			throw importError('invalid-manifest');
		}

		step();
	}

	const thumbnails = new Map<string, ImportedThumbnail>();
	for (const {project, thumbnail} of contents.projects) {
		if (!thumbnail) {
			continue;
		}

		const probed = await untilAborted(probeImage(thumbnail), signal);
		if (
			probed.ok &&
			Math.max(probed.value.width, probed.value.height) <= MAX_THUMBNAIL_SIDE
		) {
			const {width, height} = probed.value;
			thumbnails.set(project.id, {blob: thumbnail, width, height});
		}

		step();
	}

	const preview = buildPreview(contents, await library.read(), storedHashes);
	signal?.throwIfAborted();
	report(1);
	return {contents, thumbnails, preview};
}

function chosenProjects(
	contents: BackupContents,
	{projectIds}: BackupSelection,
): BackupProjectContents[] {
	const wanted = new Set(projectIds);
	const chosen = contents.projects.filter(({project}) =>
		wanted.has(project.id),
	);
	if (chosen.length !== wanted.size) {
		throw new StorageValidationError(
			'The selection names a project that is not in the backup',
		);
	}

	return chosen;
}

function sourcesOf(
	contents: BackupContents,
	projects: readonly BackupProjectContents[],
): BackupContents['sources'] {
	const hashes = new Set(
		projects.flatMap(({project, history}) =>
			backupSourceHashes(project, history),
		),
	);
	return contents.sources.filter((source) => hashes.has(source.sha256));
}

// Merge: the presets to add to `local`, skipping those it already holds.
function mergePresets(
	incoming: readonly UserPresetRecord[],
	local: readonly UserPresetRecord[],
	createId: () => string,
): UserPresetRecord[] {
	const known = [...local];
	const added: UserPresetRecord[] = [];
	for (const preset of incoming) {
		const stack = canonicalStackJson(preset.stack);
		const duplicate = known.some(
			(other) =>
				(other.id === preset.id || other.nameLower === preset.nameLower) &&
				canonicalStackJson(other.stack) === stack,
		);
		if (duplicate) {
			continue;
		}

		const next = known.some((other) => other.id === preset.id)
			? {...preset, id: `user:${createId()}`}
			: preset;
		known.push(next);
		added.push(next);
	}

	return added;
}

// What an import writes, given what the library holds now.
export function planBackupImport(
	{contents, thumbnails}: BackupInspection,
	selection: BackupSelection,
	library: BackupLibrary,
	{now, createId}: {now: number; createId: () => string},
): BackupPlan {
	const replace = selection.mode === 'replace';
	const chosen = chosenProjects(contents, selection);
	const local = new Map(
		replace ? [] : library.projects.map((item) => [item.id, item]),
	);
	const names = replace ? [] : library.projects.map((item) => item.name);
	const written: BackupProjectContents[] = [];
	const records: ImportedRecords[] = [];
	for (const item of chosen) {
		const {project, history} = item;
		const status = backupProjectStatus(project, local.get(project.id));
		if (status === 'Unchanged') {
			continue;
		}

		const copy = status === 'Modified locally';
		const name = copy
			? importedProjectName(project.name, names, true)
			: project.name;
		names.push(name);
		written.push(item);
		records.push(
			buildProjectRecords(
				{
					payload: project,
					history,
					thumbnail: thumbnails.get(project.id) ?? null,
				},
				{projectId: copy ? createId() : project.id, name, now},
			),
		);
	}

	const incoming = (selection.presets ? contents.presets : null) ?? [];
	const presets = replace
		? incoming
		: mergePresets(incoming, library.presets, createId);

	return {
		mode: selection.mode,
		sources: sourcesOf(contents, written),
		records,
		projects: records.map((record) => record.project),
		skippedProjectCount: chosen.length - written.length,
		presets,
		skippedPresetCount: incoming.length - presets.length,
		settings: selection.settings ? contents.settings : null,
	};
}

/**
 Imports the selection in four phases: check the quota, store the new images,
 write everything else in one transaction, then free images nothing uses. A
 failure or a cancel before the third phase commits leaves the library as it was.
 */
export async function runBackupImport(
	store: BackupImportStore,
	inspection: BackupInspection,
	selection: BackupSelection,
	{signal, onProgress}: BackupOptions,
	{now, createId}: {now: () => number; createId: () => string},
): Promise<BackupImportResult> {
	signal?.throwIfAborted();
	const {contents} = inspection;
	const chosen = chosenProjects(contents, selection);
	const missing: BackupContents['sources'] = [];
	for (const source of sourcesOf(contents, chosen)) {
		if (!(await store.hasSource(source.sha256))) {
			missing.push(source);
		}
	}

	const totalBytes = missing.reduce((sum, item) => sum + item.byteLength, 0);
	if (totalBytes > 0) {
		await store.checkQuota(totalBytes);
	}

	signal?.throwIfAborted();
	const inserted: string[] = [];
	let plan: BackupPlan;
	try {
		let doneBytes = 0;
		onProgress?.({stage: 'importing', fraction: 0});
		for (const source of missing) {
			signal?.throwIfAborted();
			if (await store.stageSource(toSourceRecord(source, now()), signal)) {
				inserted.push(source.sha256);
			}

			doneBytes += source.byteLength;
			// The last tenth is the commit.
			onProgress?.({
				stage: 'importing',
				path: source.path,
				fraction: (doneBytes / totalBytes) * 0.9,
			});
		}

		signal?.throwIfAborted();
		plan = await store.commit(
			(library) =>
				planBackupImport(inspection, selection, library, {
					now: now(),
					createId,
				}),
			signal,
		);
	} catch (error) {
		// A failed cleanup leaves orphans, which the next startup deletes.
		await store.discardSources(inserted).catch(() => undefined);
		throw error;
	}

	// The import is committed: nothing below may fail it.
	const cleanup =
		plan.mode === 'replace'
			? [store.cleanupOrphanedSources(), store.cleanupOrphanedMasks()]
			: [store.discardSources(inserted)];
	await Promise.allSettled(cleanup);
	onProgress?.({stage: 'importing', fraction: 1});
	const {sources, records, ...result} = plan;
	return result;
}

function count(value: number, noun: string): string {
	return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

// The notice after an import.
export function backupImportSummary({
	projects,
	presets,
	settings,
	skippedProjectCount,
}: BackupImportResult): string {
	const sentences: string[] = [];
	if (projects.length > 0 || presets.length > 0) {
		const presetPart =
			presets.length > 0 ? ` and ${count(presets.length, 'preset')}` : '';
		sentences.push(
			`Imported ${count(projects.length, 'project')}${presetPart}.`,
		);
	}

	if (settings) {
		sentences.push('Applied settings.');
	}

	if (sentences.length === 0) {
		sentences.push('Nothing new to import.');
	}

	if (skippedProjectCount > 0) {
		sentences.push(`Skipped ${skippedProjectCount} unchanged.`);
	}

	return sentences.join(' ');
}
