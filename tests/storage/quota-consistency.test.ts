// A full disk at any write of a project file import, a backup import or a
// picked blend image leaves the library as it was, and every project keeps
// exactly the images it uses (product.md F17, F25, F26; persistence.md
// sections 8.3 to 8.5).
import {describe, expect, it, vi} from 'vite-plus/test';
import type {EffectStack} from '../../src/engine/types.ts';
import {
	StorageQuotaError,
	hashBlobSha256,
	type HistoryEntryRecord,
	type NewSource,
	type ProjectRecord,
	type SourceRecord,
	type StorageManagerLike,
	type StorageRepository,
	type ThumbnailRecord,
} from '../../src/storage/index.ts';
import {indexedDbSetup, librarySnapshot, selectAll} from './backup-fixtures.ts';
import {allRecords} from './idb-helpers.ts';
import {instance, noise, stackOf} from './project-fixtures.ts';
import {SOURCE_SIZE, THUMBNAIL_SIZE} from './project-transfer-fixtures.ts';

const HEADROOM = 1.15;
// The projects `seed` creates hold these image sizes, so the total of any set of
// them is distinct.
const BASE_BYTES = 4000;

function blends(...images: string[]): EffectStack {
	return stackOf(
		...images.map((image, index) =>
			instance({
				id: `blend${index}00`,
				type: 'imageBlend',
				params: {image, blendMode: 'screen', opacity: 0.5, fit: 'cover'},
			}),
		),
	);
}

async function addProject(repository: StorageRepository, seed: number) {
	const {project} = await repository.createProject({
		name: `Image ${seed}.png`,
		blob: new Blob([noise(BASE_BYTES + seed, seed)], {type: 'image/png'}),
		...SOURCE_SIZE,
	});
	return project;
}

async function picked(seed: number): Promise<NewSource> {
	const blob = new Blob([noise(BASE_BYTES + seed, seed)], {type: 'image/png'});
	return {
		sha256: await hashBlobSha256(blob),
		blob,
		mimeType: 'image/png',
		...SOURCE_SIZE,
	};
}

async function commit(
	repository: StorageRepository,
	projectId: string,
	stack: EffectStack,
	{stackA, newSource}: {stackA?: EffectStack; newSource?: NewSource} = {},
) {
	await repository.commitStack({
		projectId,
		stack,
		stackA,
		newSource,
		selectedInstanceId: null,
		label: 'Change',
	});
}

// A project that blends one image now, one on side A and one that only undo
// history holds, a second project sharing one of them, a thumbnail and a preset.
async function seedBlended(repository: StorageRepository, offset: number) {
	const main = await addProject(repository, offset + 1);
	const [current, sideA, undoOnly] = [
		await picked(offset + 2),
		await picked(offset + 3),
		await picked(offset + 4),
	];
	await commit(repository, main.id, blends(undoOnly.sha256), {
		newSource: undoOnly,
	});
	await commit(repository, main.id, blends(current.sha256), {
		newSource: current,
	});
	await commit(repository, main.id, blends(current.sha256), {
		stackA: blends(sideA.sha256),
		newSource: sideA,
	});
	await repository.putThumbnail({
		projectId: main.id,
		blob: new Blob([noise(300, offset)], {type: 'image/webp'}),
		...THUMBNAIL_SIZE,
		stackSignature: 'seed',
		updatedAt: 1,
	});
	const second = await addProject(repository, offset + 5);
	await commit(repository, second.id, blends(current.sha256));
	await repository.createPreset({
		name: `Preset ${offset}`,
		stack: stackOf(instance()),
	});
	return {main: main.id, second: second.id};
}

type Library = Awaited<ReturnType<typeof indexedDbSetup>>;

// Every project lists exactly the images its stacks and history use, every one
// of them is stored, and nothing is stored or kept that no project uses.
async function expectConsistent({database}: Library) {
	const projects = await allRecords<ProjectRecord>(database, 'projects');
	const history = await allRecords<HistoryEntryRecord>(database, 'history');
	const sources = await allRecords<SourceRecord>(database, 'sources');
	const thumbnails = await allRecords<ThumbnailRecord>(database, 'thumbnails');
	const ids = new Set(projects.map((project) => project.id));
	const used = new Set<string>();
	for (const project of projects) {
		const stacks = [
			project,
			...history.filter((entry) => entry.projectId === project.id),
		];
		const references = new Set([project.sourceHash]);
		for (const {stack, stackA} of stacks) {
			for (const current of [stack, stackA]) {
				for (const {params} of current?.instances ?? []) {
					if (typeof params.image === 'string' && params.image !== '') {
						references.add(params.image);
					}
				}
			}
		}

		expect(project.referencedSourceHashes).toStrictEqual(
			[...references].toSorted(),
		);
		for (const reference of references) {
			used.add(reference);
		}
	}

	expect(sources.map((source) => source.sha256).toSorted()).toStrictEqual(
		[...used].toSorted(),
	);
	expect(history.filter((entry) => !ids.has(entry.projectId))).toStrictEqual(
		[],
	);
	expect(
		thumbnails.filter((thumbnail) => !ids.has(thumbnail.projectId)),
	).toStrictEqual([]);
}

// Fails the `failAt`th record written, in any store, as a full disk would.
function fullDiskAt({database}: Library, failAt: number) {
	const prototype = Object.getPrototypeOf(
		database.transaction('projects').objectStore('projects'),
	) as IDBObjectStore;
	const {put} = prototype;
	const written: string[] = [];
	const spy = vi.spyOn(prototype, 'put').mockImplementation(function (
		this: IDBObjectStore,
		...args
	) {
		written.push(this.name);
		if (written.length === failAt) {
			throw new DOMException('Disk full', 'QuotaExceededError');
		}

		return put.apply(this, args);
	});
	return {
		written,
		restore() {
			spy.mockRestore();
		},
	};
}

type Operation = {
	name: string;
	// Stores the library under test and returns the write to run against it.
	prepare(library: Library): Promise<() => Promise<unknown>>;
	// Stores the write has to reach, so the sweep cannot pass by writing nothing.
	reaches: string[];
};

// A library made elsewhere, with images the one under test does not hold.
async function elsewhere() {
	const other = await indexedDbSetup();
	const ids = await seedBlended(other.repository, 100);
	return {...other, ids};
}

function backupImport(mode: 'merge' | 'replace'): Operation {
	return {
		name: `a ${mode} backup import`,
		async prepare({repository}) {
			await seedBlended(repository, 0);
			const other = await elsewhere();
			await other.repository.updateAppState({theme: 'dark'});
			const {blob} = await other.repository.exportBackup();
			const inspection = await repository.inspectBackup(blob);
			return async () =>
				repository.importBackup(inspection, selectAll(inspection, {mode}));
		},
		reaches: [
			'sources',
			'projects',
			'history',
			'thumbnails',
			'presets',
			'meta',
		],
	};
}

const operations: Operation[] = [
	{
		name: 'a project file import',
		async prepare({repository}) {
			await seedBlended(repository, 0);
			const other = await elsewhere();
			const {blob} = await other.repository.exportProjectFile(other.ids.main);
			return async () => repository.importProjectFile(blob, 'blend.glproj');
		},
		reaches: ['sources', 'projects', 'history', 'thumbnails', 'meta'],
	},
	backupImport('merge'),
	backupImport('replace'),
	{
		name: 'a commit that stores a picked blend image',
		async prepare({repository}) {
			const {main} = await seedBlended(repository, 0);
			const image = await picked(50);
			return async () =>
				commit(repository, main, blends(image.sha256), {newSource: image});
		},
		reaches: ['sources', 'history', 'projects'],
	},
	{
		name: 'duplicating a project that blends images',
		async prepare({repository}) {
			const {main} = await seedBlended(repository, 0);
			return async () => repository.duplicateProject(main);
		},
		reaches: ['projects', 'history', 'thumbnails'],
	},
];

describe('quota consistency', () => {
	it.each(operations)(
		'a full disk at any write of $name changes nothing',
		async ({prepare, reaches}) => {
			const reached = new Set<string>();
			let failures = 0;
			for (let failAt = 1; ; failAt++) {
				const library = await indexedDbSetup();
				const write = await prepare(library);
				await expectConsistent(library);
				const before = await librarySnapshot(library.repository);
				const disk = fullDiskAt(library, failAt);
				let error: unknown;
				try {
					await write();
				} catch (error_) {
					error = error_;
				} finally {
					disk.restore();
				}

				for (const store of disk.written) {
					reached.add(store);
				}

				// Past the last write, the operation succeeds.
				if (disk.written.length < failAt) {
					expect(error).toBeUndefined();
					await expectConsistent(library);
					break;
				}

				failures++;
				expect(error, `write ${failAt}`).toBeInstanceOf(StorageQuotaError);
				expect(
					await librarySnapshot(library.repository),
					`write ${failAt} (${disk.written.at(-1)})`,
				).toStrictEqual(before);
				await expectConsistent(library);
				expect(await library.repository.cleanupOrphanedSources()).toBe(0);
				// The same write succeeds once there is room.
				await write();
				await expectConsistent(library);
			}

			expect(failures).toBeGreaterThan(0);
			expect([...reached]).toEqual(expect.arrayContaining(reaches));
		},
	);

	// Every path asks for 1.15 times the bytes of the images it does not hold.
	it.each<[string, (library: Library) => Promise<Preflight>]>([
		[
			'a project file import',
			async ({repository}) => {
				const other = await elsewhere();
				const {blob} = await other.repository.exportProjectFile(other.ids.main);
				return {
					newBytes: 4 * BASE_BYTES + 101 + 102 + 103 + 104,
					write: async () => repository.importProjectFile(blob, 'blend.glproj'),
				};
			},
		],
		[
			'a backup import',
			async ({repository}) => {
				const other = await elsewhere();
				const {blob} = await other.repository.exportBackup();
				const inspection = await repository.inspectBackup(blob);
				return {
					newBytes: 5 * BASE_BYTES + 101 + 102 + 103 + 104 + 105,
					write: async () =>
						repository.importBackup(inspection, selectAll(inspection)),
				};
			},
		],
		[
			'a picked blend image',
			async ({repository}) => {
				const {id} = await addProject(repository, 1);
				const image = await picked(50);
				return {
					newBytes: BASE_BYTES + 50,
					write: async () =>
						commit(repository, id, blends(image.sha256), {newSource: image}),
				};
			},
		],
	])(
		'%s needs the same headroom for its new image bytes',
		async (_, prepare) => {
			let free = Number.MAX_SAFE_INTEGER;
			const storageManager: StorageManagerLike = {
				estimate: async () => ({usage: 0, quota: free}),
			};
			const library = await indexedDbSetup({storageManager});
			const {newBytes, write} = await prepare(library);
			const before = await librarySnapshot(library.repository);

			free = Math.ceil(newBytes * HEADROOM) - 1;
			await expect(write()).rejects.toThrow(StorageQuotaError);
			expect(await librarySnapshot(library.repository)).toStrictEqual(before);
			await expectConsistent(library);

			free = Math.ceil(newBytes * HEADROOM);
			await write();
			await expectConsistent(library);
		},
	);
});

type Preflight = {newBytes: number; write: () => Promise<unknown>};
