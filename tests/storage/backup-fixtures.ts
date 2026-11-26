// Libraries to back up, and helpers to compare and edit what comes out.
import {IDBFactory, IDBKeyRange as FakeKeyRange} from 'fake-indexeddb';
import {strToU8} from 'fflate';
import {
	IndexedDbRepository,
	MemoryStorageAdapter,
	openDatabase,
	type BackupSelection,
	type BackupInspection,
	type StorageManagerLike,
	type StorageRepository,
} from '../../src/storage/index.ts';
import {
	CROPPED,
	entriesOf,
	instance,
	jsonOf,
	noise,
	stackOf,
	zipOf,
} from './project-fixtures.ts';
import {
	SOURCE_SIZE,
	THUMBNAIL_SIZE,
	transferDependencies,
} from './project-transfer-fixtures.ts';

export const SHARED_BYTES = noise(200_000);
export const OTHER_BYTES = noise(150_000, 3);

export type Setup = {
	now?: () => number;
	storageManager?: StorageManagerLike;
};

export async function indexedDbSetup(options: Setup = {}) {
	const database = await openDatabase({indexedDB: new IDBFactory()});
	const dependencies = transferDependencies();
	const repository = new IndexedDbRepository(database, {
		...options,
		...dependencies,
		keyRange: FakeKeyRange,
	});
	return {database, repository, probeImage: dependencies.probeImage};
}

export async function memorySetup(options: Setup = {}) {
	const dependencies = transferDependencies();
	const repository: StorageRepository = new MemoryStorageAdapter({
		...options,
		...dependencies,
	});
	return {repository, probeImage: dependencies.probeImage};
}

export const adapters = [
	{name: 'IndexedDbRepository (fake-indexeddb)', create: indexedDbSetup},
	{name: 'MemoryStorageAdapter', create: memorySetup},
];

export async function addProject(
	repository: StorageRepository,
	name: string,
	bytes: Uint8Array<ArrayBuffer> = SHARED_BYTES,
) {
	const {project} = await repository.createProject({
		name: `${name}.png`,
		blob: new Blob([bytes], {type: 'image/png'}),
		...SOURCE_SIZE,
	});
	return project;
}

// Three projects, two sharing a source, one with side A, a transform and
// history; two presets and the dark theme (AC-F17.1).
export async function seedLibrary(repository: StorageRepository) {
	const edited = await addProject(repository, 'Night Drive');
	const stack = stackOf(
		instance(),
		instance({id: 'efgh5678', type: 'channelShift', mix: 0.5}),
	);
	for (let commit = 1; commit <= 3; commit++) {
		await repository.commitStack({
			projectId: edited.id,
			stack: commit === 1 ? stackOf(instance()) : stack,
			selectedInstanceId: 'abcd1234',
			stackA: stackOf(instance({id: 'side000a'})),
			selectedInstanceIdA: 'side000a',
			...(commit === 2 && {transform: CROPPED}),
			label: `Commit ${commit}`,
		});
	}

	await repository.undo(edited.id);
	await repository.updateViewState(edited.id, {
		fitMode: 'custom',
		zoom: 2,
		centerX: 20,
		centerY: 30,
		splitPosition: 0.25,
		splitOrientation: 'horizontal',
		editSide: 'a',
	});
	await repository.updateExportSettings(edited.id, {
		format: 'jpeg',
		quality: 77,
		sizeMode: 'full',
		customLongestSide: null,
		maxFileSizeKb: 500,
	});
	await repository.putThumbnail({
		projectId: edited.id,
		blob: new Blob([noise(900, 7)], {type: 'image/webp'}),
		...THUMBNAIL_SIZE,
		stackSignature: 'seed',
		updatedAt: 1,
	});
	const twin = await addProject(repository, 'Twin');
	const other = await addProject(repository, 'Other', OTHER_BYTES);
	const warm = await repository.createPreset({
		name: 'Warm',
		stack: stackOf(instance()),
	});
	const cold = await repository.createPreset({
		name: 'Cold',
		stack: stackOf(instance({mix: 0.25})),
	});
	await repository.updateAppState({theme: 'dark', compareMode: 'split'});
	return {
		ids: {edited: edited.id, twin: twin.id, other: other.id},
		presets: {warm, cold},
	};
}

export async function exportedBackup() {
	const {repository} = await memorySetup({now: () => 1000});
	const seeded = await seedLibrary(repository);
	const {blob, fileName} = await repository.exportBackup();
	return {repository, ...seeded, blob, fileName};
}

export function selectAll(
	{preview}: BackupInspection,
	overrides: Partial<BackupSelection> = {},
): BackupSelection {
	return {
		mode: 'merge',
		projectIds: preview.projects.map((project) => project.id),
		presets: true,
		settings: true,
		...overrides,
	};
}

async function bytesOf(blob: Blob) {
	return new Uint8Array(await blob.arrayBuffer());
}

// Everything the library holds, to compare before and after.
export async function librarySnapshot(repository: StorageRepository) {
	const {projects, presets, appState} = await repository.getStartupSnapshot();
	const ordered = projects.toSorted((a, b) => a.id.localeCompare(b.id));
	const records = [];
	for (const project of ordered) {
		const thumbnail = await repository.getThumbnail(project.id);
		const source = await repository.getSource(project.sourceHash);
		records.push({
			project,
			history: await repository.getHistory(project.id),
			thumbnail: thumbnail && (await bytesOf(thumbnail.blob)),
			source: source && (await bytesOf(source.blob)),
		});
	}

	return {
		records,
		presets,
		appState,
		sources: await repository.getSourceSizes(),
	};
}

export type BackupFiles = Record<string, Uint8Array>;

// The backup with its entries changed; JSON entries are edited in place.
export async function editedBackup(
	blob: Blob,
	edit: (
		files: BackupFiles,
		json: (
			path: string,
			change: (value: Record<string, unknown>) => void,
		) => void,
	) => void,
): Promise<Blob> {
	const files = await entriesOf(blob);
	edit(files, (path, change) => {
		const value = jsonOf(files[path]);
		change(value);
		files[path] = strToU8(JSON.stringify(value));
	});
	return zipOf(files);
}
