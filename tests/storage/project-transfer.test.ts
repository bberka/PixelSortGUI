import {IDBFactory, IDBKeyRange as FakeKeyRange} from 'fake-indexeddb';
import {describe, expect, it} from 'vite-plus/test';
import {IDENTITY_TRANSFORM} from '../../src/engine/transform.ts';
import {
	IndexedDbRepository,
	MemoryStorageAdapter,
	StorageNotFoundError,
	StorageQuotaError,
	importedProjectName,
	openDatabase,
	type StorageManagerLike,
	type StorageRepository,
} from '../../src/storage/index.ts';
import {ProjectFileError} from '../../src/storage/project-file-error.ts';
import {putRecords} from './idb-helpers.ts';
import {
	CROPPED,
	editedArchive,
	entriesOf,
	instance,
	jsonOf,
	noise,
	stackOf,
	zipOf,
	type Edit,
} from './project-fixtures.ts';
import {
	SOURCE_SIZE,
	THUMBNAIL_SIZE,
	transferDependencies,
} from './project-transfer-fixtures.ts';

const NAME = 'drive.glproj';
const PREFIX = `Can't open ${NAME}:`;
const SOURCE_BYTES = noise(200_000);

type Setup = {
	now?: () => number;
	storageManager?: StorageManagerLike;
};

async function indexedDbSetup(options: Setup = {}) {
	const database = await openDatabase({indexedDB: new IDBFactory()});
	const dependencies = transferDependencies();
	const repository = new IndexedDbRepository(database, {
		...options,
		...dependencies,
		keyRange: FakeKeyRange,
	});
	return {database, repository, probeImage: dependencies.probeImage};
}

const adapters = [
	{name: 'IndexedDbRepository (fake-indexeddb)', create: indexedDbSetup},
	{
		name: 'MemoryStorageAdapter',
		async create(options: Setup = {}) {
			const dependencies = transferDependencies();
			const repository: StorageRepository = new MemoryStorageAdapter({
				...options,
				...dependencies,
			});
			return {repository, probeImage: dependencies.probeImage};
		},
	},
];

// Two effects, side A, a transform, custom export settings and five commits.
async function seedProject(repository: StorageRepository) {
	const {project} = await repository.createProject({
		name: 'Night Drive.png',
		blob: new Blob([SOURCE_BYTES], {type: 'image/png'}),
		...SOURCE_SIZE,
	});
	const stack = stackOf(
		instance(),
		instance({id: 'efgh5678', type: 'channelShift', mix: 0.5}),
	);
	for (let commit = 1; commit <= 5; commit++) {
		await repository.commitStack({
			projectId: project.id,
			stack: commit === 1 ? stackOf(instance()) : stack,
			selectedInstanceId: 'abcd1234',
			stackA: stackOf(instance({id: 'side000a'})),
			selectedInstanceIdA: 'side000a',
			...(commit === 3 && {transform: CROPPED}),
			label: `Commit ${commit}`,
		});
	}

	await repository.updateViewState(project.id, {
		fitMode: 'custom',
		zoom: 2,
		centerX: 20,
		centerY: 30,
		splitPosition: 0.25,
		splitOrientation: 'horizontal',
		editSide: 'a',
	});
	await repository.updateExportSettings(project.id, {
		format: 'jpeg',
		quality: 77,
		sizeMode: 'custom',
		customLongestSide: 150,
		maxFileSizeKb: 500,
	});
	await repository.putThumbnail({
		projectId: project.id,
		blob: new Blob([noise(900, 7)], {type: 'image/webp'}),
		...THUMBNAIL_SIZE,
		stackSignature: 'seed',
		updatedAt: 1,
	});
	return (await repository.getProject(project.id))!;
}

async function exportedFile(options?: {includeHistory?: boolean}) {
	const {repository} = await adapters[1].create({now: () => 1000});
	const project = await seedProject(repository);
	const {blob, fileName} = await repository.exportProjectFile(
		project.id,
		options,
	);
	return {repository, project, blob, fileName};
}

async function expectNothingStored(repository: StorageRepository) {
	expect(await repository.listProjects()).toStrictEqual([]);
	const entries = await entriesOf((await exportedFile()).blob);
	const path = Object.keys(entries).find((key) => key.startsWith('sources/'))!;
	expect(await repository.hasSource(path.slice(8, 72))).toBe(false);
	const state = await repository.getAppState();
	expect(state.activeProjectId).toBeNull();
}

for (const adapter of adapters) {
	describe(`project files: ${adapter.name}`, () => {
		it('exports the archive layout with the source bit for bit (AC-F25.1)', async () => {
			const {repository} = await adapter.create();
			const project = await seedProject(repository);

			const {blob, fileName} = await repository.exportProjectFile(project.id);

			expect(fileName).toMatch(/^night-drive-\d{8}-\d{6}\.glproj$/);
			const entries = await entriesOf(blob);
			const path = `sources/${project.sourceHash}.png`;
			expect(Object.keys(entries)).toStrictEqual([
				'manifest.json',
				'project.json',
				'history.json',
				'thumbnail.webp',
				path,
			]);
			expect(entries[path]).toStrictEqual(SOURCE_BYTES);
			expect(
				jsonOf<{entries: unknown[]}>(entries['history.json']).entries,
			).toHaveLength(6);
		});

		it('restores the whole project on a fresh profile and makes it active (AC-F25.2)', async () => {
			const original = await exportedFile();
			const history = await original.repository.getHistory(original.project.id);
			const {repository} = await adapter.create({now: () => 5000});

			const result = await repository.importProjectFile(original.blob, NAME);

			const {id} = result.project;
			expect(id).not.toBe(original.project.id);
			expect(result.deduplicated).toBe(false);
			expect(await repository.getProject(id)).toStrictEqual({
				...original.project,
				id,
			});
			expect(await repository.getHistory(id)).toStrictEqual(
				history.map((entry) => ({...entry, projectId: id})),
			);
			const source = (await repository.getSource(result.project.sourceHash))!;
			expect(new Uint8Array(await source.blob.arrayBuffer())).toStrictEqual(
				SOURCE_BYTES,
			);
			expect(source).toMatchObject({...SOURCE_SIZE, createdAt: 5000});
			expect(await repository.getThumbnail(id)).toMatchObject({
				...THUMBNAIL_SIZE,
				stackSignature: '',
			});
			const state = await repository.getAppState();
			expect(state.activeProjectId).toBe(id);

			let undone = 0;
			while (await repository.undo(id)) {
				undone++;
			}

			expect(undone).toBe(5);
		});

		it('writes one Initial entry for a file without history (AC-F25.3)', async () => {
			const original = await exportedFile({includeHistory: false});
			expect(await entriesOf(original.blob)).not.toHaveProperty([
				'history.json',
			]);
			const {repository} = await adapter.create({now: () => 5000});

			const {project} = await repository.importProjectFile(original.blob, NAME);

			expect(project).toMatchObject({
				historyHeadSeq: 0,
				historyMinSeq: 0,
				historyMaxSeq: 0,
				transform: CROPPED,
			});
			expect(await repository.getHistory(project.id)).toStrictEqual([
				{
					projectId: project.id,
					seq: 0,
					label: 'Initial',
					stack: original.project.stack,
					selectedInstanceId: 'abcd1234',
					stackA: original.project.stackA,
					selectedInstanceIdA: 'side000a',
					transform: CROPPED,
					createdAt: 5000,
				},
			]);
		});

		it('reuses a stored source and suffixes a clashing name (AC-F25.4)', async () => {
			const {repository, probeImage} = await adapter.create();
			const project = await seedProject(repository);
			const stored = await repository.getSource(project.sourceHash);
			await repository.renameProject(project.id, 'night drive');
			const {blob} = await repository.exportProjectFile(project.id);

			const first = await repository.importProjectFile(blob, NAME, {
				setActive: false,
			});
			const second = await repository.importProjectFile(blob, NAME, {
				setActive: false,
			});

			expect(first.deduplicated).toBe(true);
			expect(first.project.name).toBe('night drive (imported)');
			expect(second.project.name).toBe('night drive (imported 2)');
			expect(first.source.createdAt).toBe(stored!.createdAt);
			expect(await repository.cleanupOrphanedSources()).toBe(0);
			// Only the two thumbnails were decoded.
			expect(
				probeImage.mock.calls.map(([probed]) => probed.type),
			).toStrictEqual(['image/webp', 'image/webp']);
			const state = await repository.getAppState();
			expect(state.activeProjectId).toBe(project.id);
			expect(await repository.listProjects()).toHaveLength(3);
		});

		it.each([
			[
				'bytes that are not a ZIP',
				async () => new Blob([noise(500)]),
				`${PREFIX} the file is damaged or not a valid project archive.`,
			],
			[
				'a truncated archive (AC-F25.5)',
				async (blob: Blob) => blob.slice(0, blob.size / 2),
				`${PREFIX} the file is damaged or not a valid project archive.`,
			],
		])('writes nothing for %s', async (_, damage, message) => {
			const {blob} = await exportedFile();
			const {repository} = await adapter.create();

			await expect(
				repository.importProjectFile(await damage(blob), NAME),
			).rejects.toThrow(message);
			await expectNothingStored(repository);
		});

		it('writes nothing for missing or modified image data (AC-F25.6)', async () => {
			const {blob, project} = await exportedFile();
			const path = `sources/${project.sourceHash}.png`;
			const {repository} = await adapter.create();
			const files = await entriesOf(blob);
			const {[path]: bytes, ...without} = files;

			await expect(
				repository.importProjectFile(zipOf(without), NAME),
			).rejects.toThrow(`${PREFIX} missing image data (${path}).`);

			bytes[100] = (bytes[100] + 1) % 256;
			await expect(
				repository.importProjectFile(zipOf(files), NAME),
			).rejects.toThrow(`${PREFIX} image data is damaged (${path}).`);
			await expectNothingStored(repository);
		});

		it('writes nothing for a newer format version (AC-F25.7)', async () => {
			const {blob} = await exportedFile();
			const {repository} = await adapter.create();
			const newer = await editedArchive(blob, ({manifest}) => {
				manifest.formatVersion = 3;
			});

			await expect(repository.importProjectFile(newer, NAME)).rejects.toThrow(
				`${PREFIX} project format version 3 is newer than this app supports. Update the app and try again.`,
			);
			await expectNothingStored(repository);
		});

		it('keeps unknown effects and newer effect versions verbatim (AC-F25.8)', async () => {
			const {blob} = await exportedFile();
			const unknown = {
				...instance({id: 'future01', type: 'fromTheFuture', version: 9}),
				extra: {kept: true},
			};
			const newer = instance({id: 'future02', version: 99});
			const edited = await editedArchive(blob, ({project}) => {
				project.stack = stackOf(unknown, newer);
			});
			const {repository} = await adapter.create();

			const {project} = await repository.importProjectFile(edited, NAME);

			expect(project.stack.instances).toStrictEqual([unknown, newer]);
			const saved = await repository.exportProjectFile(project.id);
			const entries = await entriesOf(saved.blob);
			expect(
				jsonOf<{stack: unknown}>(entries['project.json']).stack,
			).toStrictEqual(stackOf(unknown, newer));
		});

		it.each<[string, Edit, string]>([
			[
				'a file whose declared size is not the decoded one',
				({manifest, project}) => {
					const [source] = manifest.sources as Array<{width: number}>;
					source.width = 500;
					project.sourceWidth = 500;
				},
				'missing or invalid project metadata.',
			],
			[
				'an invalid transform',
				({project}) => {
					project.transform = {rotation: 45};
				},
				'missing or invalid project metadata.',
			],
		])('refuses %s', async (_, edit, message) => {
			const {blob} = await exportedFile();
			const {repository} = await adapter.create();

			await expect(
				repository.importProjectFile(await editedArchive(blob, edit), NAME),
			).rejects.toThrow(`${PREFIX} ${message}`);
			await expectNothingStored(repository);
		});

		it('refuses a declared size that differs from the stored source', async () => {
			const {repository} = await adapter.create();
			const project = await seedProject(repository);
			const {blob} = await repository.exportProjectFile(project.id);
			const edited = await editedArchive(blob, (documents) => {
				const [source] = documents.manifest.sources as Array<{height: number}>;
				source.height = 301;
				documents.project.sourceHeight = 301;
			});

			await expect(repository.importProjectFile(edited, NAME)).rejects.toThrow(
				`${PREFIX} missing or invalid project metadata.`,
			);
			expect(await repository.listProjects()).toHaveLength(1);
		});

		it('refuses an image that does not decode', async () => {
			const {blob} = await exportedFile();
			const {repository, probeImage} = await adapter.create();
			probeImage.mockResolvedValueOnce({
				ok: false,
				error: {code: 'too-large', message: 'Image too large'},
			});

			const error: unknown = await repository
				.importProjectFile(blob, NAME)
				.catch((error: unknown) => error);

			expect(error).toBeInstanceOf(ProjectFileError);
			expect((error as ProjectFileError).message).toBe(
				`${PREFIX} embedded image is unreadable or exceeds 16,384 px.`,
			);
			await expectNothingStored(repository);
		});

		it('leaves out a thumbnail that does not decode', async () => {
			const {blob} = await exportedFile();
			const {repository, probeImage} = await adapter.create();
			const decode = probeImage.getMockImplementation()!;
			probeImage.mockImplementation(async (image) =>
				image.type === 'image/webp'
					? {ok: false, error: {code: 'decode-failed', message: 'bad'}}
					: decode(image),
			);

			const {project} = await repository.importProjectFile(blob, NAME);

			expect(await repository.getThumbnail(project.id)).toBeUndefined();
		});

		it('writes nothing when cancelled while decoding', async () => {
			const {blob} = await exportedFile();
			const {repository, probeImage} = await adapter.create();
			const controller = new AbortController();
			const decode = probeImage.getMockImplementation()!;
			probeImage.mockImplementation(async (image) => {
				controller.abort();
				return decode(image);
			});

			await expect(
				repository.importProjectFile(blob, NAME, {signal: controller.signal}),
			).rejects.toThrow('aborted');
			await expectNothingStored(repository);
		});

		it('rejects an export of an unknown project', async () => {
			const {repository} = await adapter.create();

			await expect(repository.exportProjectFile('nope')).rejects.toThrow(
				StorageNotFoundError,
			);
		});
	});
}

describe('IndexedDbRepository project files', () => {
	const full: StorageManagerLike = {
		estimate: async () => ({usage: 9_900_000, quota: 10_000_000}),
	};

	it('checks the quota before writing', async () => {
		const {blob} = await exportedFile();
		const {repository} = await indexedDbSetup({storageManager: full});

		await expect(repository.importProjectFile(blob, NAME)).rejects.toThrow(
			StorageQuotaError,
		);
		await expectNothingStored(repository);
	});

	it('needs no free quota for a source that is already stored', async () => {
		let usage = 0;
		const {repository} = await indexedDbSetup({
			storageManager: {estimate: async () => ({usage, quota: 10_000_000})},
		});
		const project = await seedProject(repository);
		const {blob} = await repository.exportProjectFile(project.id);
		usage = 10_000_000;

		const result = await repository.importProjectFile(blob, NAME);

		expect(result.deduplicated).toBe(true);
	});

	it('rolls everything back on a quota error part-way through the write', async () => {
		const {blob} = await exportedFile();
		const {database, repository} = await indexedDbSetup();
		const original = database.transaction.bind(database);
		database.transaction = (...args) => {
			const transaction = original(...args);
			const objectStore = transaction.objectStore.bind(transaction);
			transaction.objectStore = (name) => {
				const store = objectStore(name);
				// Sources, the project and its history are written by then.
				if (name === 'thumbnails') {
					store.put = () => {
						throw new DOMException('Simulated', 'QuotaExceededError');
					};
				}

				return store;
			};

			return transaction;
		};

		await expect(repository.importProjectFile(blob, NAME)).rejects.toThrow(
			StorageQuotaError,
		);
		database.transaction = original;
		await expectNothingStored(repository);
	});

	it('exports an invalid stored transform as the repaired one', async () => {
		const {database, repository} = await indexedDbSetup();
		const project = await seedProject(repository);
		await putRecords(database, 'projects', [
			{...project, transform: {rotation: 45}},
		]);

		const {blob} = await repository.exportProjectFile(project.id);

		const entries = await entriesOf(blob);
		expect(
			jsonOf<{transform: unknown}>(entries['project.json']).transform,
		).toStrictEqual(IDENTITY_TRANSFORM);
	});

	it('reports a missing source on export', async () => {
		const {database, repository} = await indexedDbSetup();
		const project = await seedProject(repository);
		await putRecords(database, 'projects', [
			{...project, sourceHash: '0'.repeat(64)},
		]);

		await expect(repository.exportProjectFile(project.id)).rejects.toThrow(
			"Can't save Night Drive: its image data is missing.",
		);
	});
});

describe('importedProjectName', () => {
	it('keeps a free name and counts past taken suffixes', () => {
		expect(importedProjectName('Drive', ['Other'])).toBe('Drive');
		expect(importedProjectName('Drive', [' DRIVE ', 'drive (Imported)'])).toBe(
			'Drive (imported 2)',
		);
	});

	it('shortens the base name to stay within 120 characters', () => {
		const name = 'a'.repeat(120);
		const renamed = importedProjectName(name, [name]);

		expect(renamed).toBe(`${'a'.repeat(109)} (imported)`);
		expect(renamed).toHaveLength(120);
	});

	it('does not cut a surrogate pair in half', () => {
		const name = `${'a'.repeat(108)}😀${'b'.repeat(10)}`;

		expect(importedProjectName(name, [name])).toBe(
			`${'a'.repeat(108)} (imported)`,
		);
	});
});
