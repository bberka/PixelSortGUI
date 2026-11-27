// Project file save and import, shared by both storage adapters
// (persistence.md section 8.3.5).
import {probeImageDimensions} from '../codec/decode.ts';
import {getAppVersionLabel} from '../lib/app-version.ts';
import {MAX_THUMBNAIL_SIDE} from '../state/thumbnail.ts';
import type {openProjectFile, saveProjectFile} from './archive-client.ts';
import {referencedSourceHashes} from './extra-sources.ts';
import {resolveStoredGeometry} from './geometry.ts';
import {withSideA} from './helpers.ts';
import {referencedMaskHashes} from './masks.ts';
import {ProjectFileError, projectOpenMessage} from './project-file-error.ts';
import type {
	ProjectFileContents,
	ProjectFileOutput,
	ProjectFilePayload,
} from './project-format.ts';
import {
	MAX_PROJECT_NAME_LENGTH,
	type ExportProjectOptions,
	type HistoryEntryRecord,
	type ImportProjectOptions,
	type MaskRecord,
	type ProjectRecord,
	type SourceRecord,
	type ThumbnailRecord,
} from './types.ts';

// Loaded on first use, so the app starts without it.
const loadArchive = async () => import('./archive-client.ts');

// Replaced by tests: Node has no workers and no image decoder.
export type ProjectTransferDependencies = {
	projectArchive?: {
		save: typeof saveProjectFile;
		open: typeof openProjectFile;
	};
	probeImage?: typeof probeImageDimensions;
};

export type ProjectSnapshot = {
	project: ProjectRecord;
	// The stored ones among those the file needs.
	sources: SourceRecord[];
	// The stored ones among the painted masks the file needs.
	masks: MaskRecord[];
	// `undefined` leaves undo history out of the file.
	history: HistoryEntryRecord[] | undefined;
	thumbnail: ThumbnailRecord | undefined;
};

export type ImportedThumbnail = Pick<
	ThumbnailRecord,
	'blob' | 'width' | 'height'
>;

// A file that passed every check but the quota one.
export type PreparedImport = {
	contents: ProjectFileContents;
	// Bytes of the sources and masks that are not stored yet.
	newBytes: number;
	thumbnail: ImportedThumbnail | null;
};

export async function writeProjectArchive(
	{project, sources, masks, history, thumbnail}: ProjectSnapshot,
	{signal, onProgress}: ExportProjectOptions,
	{projectArchive}: ProjectTransferDependencies,
): Promise<ProjectFileOutput> {
	const save = projectArchive?.save ?? (await loadArchive()).saveProjectFile;
	return save(
		{
			project,
			sources,
			masks,
			history,
			thumbnail: thumbnail?.blob,
			appVersion: getAppVersionLabel(),
		},
		{signal, onProgress},
	);
}

/**
 Reads, validates and decodes a project file; it writes nothing.
 */
export async function prepareProjectImport(
	file: Blob,
	fileName: string,
	{signal, onProgress}: ImportProjectOptions,
	{
		projectArchive,
		probeImage = probeImageDimensions,
	}: ProjectTransferDependencies,
	{
		findSource,
		findMask,
	}: {
		findSource(sha256: string): Promise<SourceRecord | undefined>;
		findMask(sha256: string): Promise<MaskRecord | undefined>;
	},
): Promise<PreparedImport> {
	const open = projectArchive?.open ?? (await loadArchive()).openProjectFile;
	const contents = await open(file, fileName, {signal, onProgress});
	const openError = (code: 'invalid-metadata' | 'unreadable-image') =>
		new ProjectFileError(code, projectOpenMessage(code, fileName));

	let newBytes = 0;
	for (const source of contents.sources) {
		const stored = await findSource(source.sha256);
		let size: {width: number; height: number};
		if (stored) {
			size = stored;
		} else {
			signal?.throwIfAborted();
			const probed = await probeImage(source.blob);
			if (!probed.ok) {
				throw openError('unreadable-image');
			}

			size = probed.value;
			newBytes += source.byteLength;
		}

		if (size.width !== source.width || size.height !== source.height) {
			throw openError('invalid-metadata');
		}
	}

	for (const mask of contents.masks) {
		if (!(await findMask(mask.sha256))) {
			newBytes += mask.byteLength;
		}
	}

	let thumbnail: ImportedThumbnail | null = null;
	if (contents.thumbnail) {
		const probed = await probeImage(contents.thumbnail);
		if (
			probed.ok &&
			Math.max(probed.value.width, probed.value.height) <= MAX_THUMBNAIL_SIDE
		) {
			const {width, height} = probed.value;
			thumbnail = {blob: contents.thumbnail, width, height};
		}
	}

	return {contents, newBytes, thumbnail};
}

export function toSourceRecord(
	{
		sha256,
		blob,
		mimeType,
		byteLength,
		width,
		height,
	}: ProjectFileContents['sources'][number],
	now: number,
): SourceRecord {
	return {
		sha256,
		blob,
		mimeType,
		byteLength,
		width,
		height,
		createdAt: now,
	};
}

export function toMaskRecord(
	{sha256, width, height, blob}: ProjectFileContents['masks'][number],
	now: number,
): MaskRecord {
	return {
		sha256,
		width,
		height,
		blob,
		byteLength: blob.size,
		createdAt: now,
	};
}

// `name`, or the first free "(imported)" form of it. `always` adds the suffix
// even to a free name.
export function importedProjectName(
	name: string,
	existingNames: readonly string[],
	always = false,
): string {
	const key = (value: string) => value.trim().toLocaleLowerCase('en');
	const taken = new Set(existingNames.map((value) => key(value)));
	const suffixed = (number: number) => {
		const suffix = number === 1 ? ' (imported)' : ` (imported ${number})`;
		const base = name
			.slice(0, MAX_PROJECT_NAME_LENGTH - suffix.length)
			// A cut may split a surrogate pair.
			.replace(/[\uD800-\uDBFF]$/, '')
			.trimEnd();
		return `${base}${suffix}`;
	};

	let number = always ? 1 : 0;
	let candidate = always ? suffixed(number) : name;
	while (taken.has(key(candidate))) {
		number++;
		candidate = suffixed(number);
	}

	return candidate;
}

export type ImportedRecords = {
	project: ProjectRecord;
	history: HistoryEntryRecord[];
	thumbnail: ThumbnailRecord | null;
};

// The records one project of an archive adds, under the id and name given.
export function buildProjectRecords(
	{
		payload: {stackA, selectedInstanceIdA, ...payload},
		history: entries,
		thumbnail,
	}: {
		payload: ProjectFilePayload;
		history: HistoryEntryRecord[] | null;
		thumbnail: ImportedThumbnail | null;
	},
	{projectId, name, now}: {projectId: string; name: string; now: number},
): ImportedRecords {
	const {transform, effectiveWidth, effectiveHeight} = resolveStoredGeometry(
		payload.sourceWidth,
		payload.sourceHeight,
		payload.transform,
	);
	const project = withSideA<
		Omit<ProjectRecord, 'referencedSourceHashes' | 'referencedMaskHashes'>
	>(
		{
			...payload,
			id: projectId,
			name,
			transform,
			effectiveWidth,
			effectiveHeight,
		},
		stackA,
		selectedInstanceIdA,
	);
	const initial: HistoryEntryRecord = {
		projectId,
		seq: 0,
		label: 'Initial',
		stack: project.stack,
		selectedInstanceId: project.selectedInstanceId,
		transform,
		createdAt: now,
	};
	const history = (
		entries ?? [withSideA(initial, stackA, selectedInstanceIdA)]
	).map((entry) =>
		withSideA({...entry, projectId}, entry.stackA, entry.selectedInstanceIdA),
	);

	return {
		project: {
			...project,
			referencedSourceHashes: referencedSourceHashes(project, history),
			referencedMaskHashes: referencedMaskHashes(project, history),
		},
		history,
		// An empty signature matches no stack, so the next render replaces it.
		thumbnail: thumbnail && {
			...thumbnail,
			projectId,
			stackSignature: '',
			updatedAt: now,
		},
	};
}

// The records a prepared import adds under a new project id.
export function buildImportedProject(
	{contents, thumbnail}: PreparedImport,
	{
		projectId,
		existingNames,
		now,
	}: {projectId: string; existingNames: readonly string[]; now: number},
): ImportedRecords {
	return buildProjectRecords(
		{payload: contents.project, history: contents.history, thumbnail},
		{
			projectId,
			name: importedProjectName(contents.project.name, existingNames),
			now,
		},
	);
}
