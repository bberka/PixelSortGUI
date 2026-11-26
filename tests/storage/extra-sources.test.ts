// Reference-counted extra sources (persistence.md section 8.5, product.md F26).
import {strToU8} from 'fflate';
import {describe, expect, it, vi} from 'vite-plus/test';
import type {EffectInstance, EffectStack} from '../../src/engine/types.ts';
import {
	StorageQuotaError,
	StorageValidationError,
	backupNewBytes,
	hashBlobSha256,
	type NewSource,
	type StorageRepository,
} from '../../src/storage/index.ts';
import {
	adapters,
	editedBackup,
	indexedDbSetup,
	librarySnapshot,
	selectAll,
} from './backup-fixtures.ts';
import {
	entriesOf,
	instance,
	jsonOf,
	noise,
	stackOf,
	zipOf,
} from './project-fixtures.ts';
import {SOURCE_SIZE} from './project-transfer-fixtures.ts';
import {allRecords} from './idb-helpers.ts';

const LIMIT = 'A project can use at most 8 extra blend images.';
const FILE = 'blend.glproj';

function blend(image: string, id = `blend-${image.slice(0, 6)}`) {
	return instance({
		id,
		type: 'imageBlend',
		params: {image, blendMode: 'difference', opacity: 0.5, fit: 'tile'},
	});
}

function blends(...images: string[]): EffectStack {
	return stackOf(...images.map((image, index) => blend(image, `b${index}`)));
}

// A project whose primary source is the image numbered `seed`.
async function add(
	repository: StorageRepository,
	seed: number,
	size = 4000 + seed,
) {
	const {project} = await repository.createProject({
		name: `Image ${seed}.png`,
		blob: new Blob([noise(size, seed)], {type: 'image/png'}),
		...SOURCE_SIZE,
	});
	return project;
}

async function commit(
	repository: StorageRepository,
	projectId: string,
	stack: EffectStack,
	stackA?: EffectStack,
) {
	const {project} = await repository.commitStack({
		projectId,
		stack,
		stackA,
		selectedInstanceId: null,
		label: 'Change',
	});
	return project;
}

// An image picked from the device, not stored yet.
async function picked(seed: number, size = 4000 + seed): Promise<NewSource> {
	const blob = new Blob([noise(size, seed)], {type: 'image/png'});
	return {
		sha256: await hashBlobSha256(blob),
		blob,
		mimeType: 'image/png',
		...SOURCE_SIZE,
	};
}

async function commitPicked(
	repository: StorageRepository,
	projectId: string,
	stack: EffectStack,
	newSource: NewSource,
) {
	return repository.commitStack({
		projectId,
		stack,
		selectedInstanceId: null,
		label: 'Blend image chosen',
		newSource,
	});
}

async function everything(repository: StorageRepository, id: string) {
	return {
		sizes: await repository.getSourceSizes(),
		project: await repository.getProject(id),
		history: await repository.getHistory(id),
	};
}

function dropSource(manifest: Record<string, unknown>, sha256: string) {
	const sources = manifest.sources as Array<{sha256: string}>;
	manifest.sources = sources.filter((source) => source.sha256 !== sha256);
}

async function bytesOf(repository: StorageRepository, sha256: string) {
	const source = await repository.getSource(sha256);
	return source && new Uint8Array(await source.blob.arrayBuffer());
}

const sorted = (...hashes: string[]) => hashes.toSorted();

async function referencesOf(repository: StorageRepository, id: string) {
	return (await repository.getProject(id))!.referencedSourceHashes;
}

// `main` blends one image now (current stack), one on side A and one that only
// undo history still holds. The projects that first held them are deleted.
async function seedBlended(repository: StorageRepository) {
	const main = await add(repository, 1);
	const owners = [
		await add(repository, 2),
		await add(repository, 3),
		await add(repository, 4),
	];
	const [current, sideA, undoOnly] = owners.map((owner) => owner.sourceHash);
	await commit(repository, main.id, blends(undoOnly));
	await commit(repository, main.id, blends(current), blends(sideA));
	for (const owner of owners) {
		await repository.deleteProject(owner.id);
	}

	return {
		id: main.id,
		primary: main.sourceHash,
		current,
		sideA,
		undoOnly,
	};
}

for (const adapter of adapters) {
	describe(`extra sources: ${adapter.name}`, () => {
		it('reuses a stored image and frees it with its last project (AC-F26.3)', async () => {
			const {repository} = await adapter.create();
			const first = await add(repository, 1);
			const second = await add(repository, 2);
			const sizes = await repository.getSourceSizes();

			await commit(repository, second.id, blends(first.sourceHash));

			expect(await repository.getSourceSizes()).toStrictEqual(sizes);
			await expect(repository.deleteProject(first.id)).resolves.toStrictEqual({
				deleted: true,
				sourceDeleted: false,
			});
			expect(await repository.cleanupOrphanedSources()).toBe(0);
			expect(await bytesOf(repository, first.sourceHash)).toStrictEqual(
				noise(4001, 1),
			);

			await repository.deleteProject(second.id);
			expect(await repository.getSourceSizes()).toStrictEqual({});
		});

		it('counts an extra image shared by several projects', async () => {
			const {repository} = await adapter.create();
			const owner = await add(repository, 1);
			const left = await add(repository, 2);
			const right = await add(repository, 3);
			await commit(repository, left.id, blends(owner.sourceHash));
			await commit(repository, right.id, stackOf(), blends(owner.sourceHash));
			await repository.deleteProject(owner.id);

			await repository.deleteProject(left.id);
			expect(await repository.hasSource(owner.sourceHash)).toBe(true);
			expect(await repository.hasSource(left.sourceHash)).toBe(false);

			await repository.deleteProject(right.id);
			expect(await repository.getSourceSizes()).toStrictEqual({});
		});

		it('keeps a removed image while undo or redo can restore it (AC-F26.4)', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const owner = await add(repository, 2);
			const image = owner.sourceHash;
			await commit(repository, main.id, blends(image));
			await commit(repository, main.id, stackOf());
			await repository.deleteProject(owner.id);

			expect(await repository.cleanupOrphanedSources()).toBe(0);
			const undone = await repository.undo(main.id);
			expect(undone?.project.stack).toStrictEqual(blends(image));
			expect(await bytesOf(repository, image)).toStrictEqual(noise(4002, 2));

			// Now the image is only on the redo branch of the entry before.
			await repository.undo(main.id);
			expect(await repository.cleanupOrphanedSources()).toBe(0);
			await repository.redo(main.id);
			expect(await repository.hasSource(image)).toBe(true);
		});

		it('frees an image once a commit discards the last entry using it', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const owner = await add(repository, 2);
			await commit(repository, main.id, blends(owner.sourceHash));
			await repository.deleteProject(owner.id);
			await repository.undo(main.id);

			const project = await commit(repository, main.id, stackOf(instance()));

			expect(project.referencedSourceHashes).toStrictEqual([main.sourceHash]);
			expect(await repository.cleanupOrphanedSources()).toBe(1);
			expect(await repository.hasSource(owner.sourceHash)).toBe(false);
		});

		it('keeps an image for the 201 retained entries and no longer', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const owner = await add(repository, 2);
			await commit(repository, main.id, blends(owner.sourceHash));
			await repository.deleteProject(owner.id);
			// The entry with the image is the oldest retained after 201 commits.
			for (let step = 2; step <= 201; step++) {
				await commit(repository, main.id, stackOf());
			}

			expect(await repository.cleanupOrphanedSources()).toBe(0);

			await commit(repository, main.id, stackOf());
			expect(await referencesOf(repository, main.id)).toStrictEqual([
				main.sourceHash,
			]);
			expect(await repository.cleanupOrphanedSources()).toBe(1);
		});

		it('stores a picked image with the commit that first uses it', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const image = await picked(2);

			const {project} = await commitPicked(
				repository,
				main.id,
				blends(image.sha256),
				image,
			);

			expect(project.referencedSourceHashes).toStrictEqual(
				sorted(main.sourceHash, image.sha256),
			);
			expect(await repository.getSource(image.sha256)).toMatchObject({
				byteLength: 4002,
				mimeType: 'image/png',
				...SOURCE_SIZE,
			});
			expect(await bytesOf(repository, image.sha256)).toStrictEqual(
				noise(4002, 2),
			);
			// Referenced from the first moment, so a cleanup leaves it.
			expect(await repository.cleanupOrphanedSources()).toBe(0);
		});

		it('keeps a picked image through a cleanup running beside it', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const image = await picked(2);

			await Promise.all([
				repository.cleanupOrphanedSources(),
				commitPicked(repository, main.id, blends(image.sha256), image),
				repository.cleanupOrphanedSources(),
			]);

			expect(await repository.hasSource(image.sha256)).toBe(true);
		});

		it('keeps the stored record of a picked image that is already there', async () => {
			let now = 1000;
			const {repository} = await adapter.create({now: () => now++});
			const main = await add(repository, 1);
			const owner = await add(repository, 2);
			const stored = await repository.getSource(owner.sourceHash);
			const sizes = await repository.getSourceSizes();

			await commitPicked(
				repository,
				main.id,
				blends(owner.sourceHash),
				await picked(2),
			);

			expect(await repository.getSourceSizes()).toStrictEqual(sizes);
			expect(await repository.getSource(owner.sourceHash)).toMatchObject({
				createdAt: stored!.createdAt,
			});
		});

		it('stores nothing that neither stack refers to', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const image = await picked(2);

			await commitPicked(repository, main.id, stackOf(), image);

			expect(await repository.hasSource(image.sha256)).toBe(false);
		});

		it.each([
			{
				reason: 'the image cap',
				async stacks(repository: StorageRepository, id: string, image: string) {
					const owners: string[] = [];
					for (let seed = 10; seed < 18; seed++) {
						owners.push((await add(repository, seed)).sourceHash);
					}

					await commit(repository, id, blends(...owners));
					return {stack: blends(...owners, image)};
				},
				message: LIMIT,
			},
			{
				reason: 'another image that is not stored',
				async stacks(_: StorageRepository, __: string, image: string) {
					return {stack: blends(image, 'e'.repeat(64))};
				},
				message: 'is not stored',
			},
			{
				reason: 'an invalid transform',
				async stacks(_: StorageRepository, __: string, image: string) {
					return {
						stack: blends(image),
						transform: {
							rotation: 45 as 90,
							flipX: false,
							flipY: false,
							crop: null,
							resize: null,
						},
					};
				},
				message: /./,
			},
		])(
			'leaves no blob and no reference when $reason refuses the commit',
			async ({stacks, message}) => {
				const {repository} = await adapter.create();
				const main = await add(repository, 1);
				const image = await picked(2);
				const next = await stacks(repository, main.id, image.sha256);
				const before = await everything(repository, main.id);

				await expect(
					repository.commitStack({
						...next,
						projectId: main.id,
						selectedInstanceId: null,
						label: 'Blend image chosen',
						newSource: image,
					}),
				).rejects.toThrow(message);

				expect(await everything(repository, main.id)).toStrictEqual(before);
				expect(await repository.hasSource(image.sha256)).toBe(false);
			},
		);

		it('stores no image for a project that is gone', async () => {
			const {repository} = await adapter.create();
			const image = await picked(2);

			await expect(
				commitPicked(repository, 'missing', blends(image.sha256), image),
			).rejects.toThrow('not found');
			expect(await repository.getSourceSizes()).toStrictEqual({});
		});

		it('copies references to a duplicate', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);

			const copy = await repository.duplicateProject(seeded.id);
			await repository.deleteProject(seeded.id);

			expect(copy.referencedSourceHashes).toStrictEqual(
				sorted(seeded.primary, seeded.current, seeded.sideA, seeded.undoOnly),
			);
			expect(
				Object.keys(await repository.getSourceSizes()).toSorted(),
			).toStrictEqual(copy.referencedSourceHashes);
		});

		it('tracks a stack saved without a history entry', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const owner = await add(repository, 2);

			const saved = await repository.saveProjectStack(
				main.id,
				blends(owner.sourceHash),
			);
			await repository.deleteProject(owner.id);

			expect(saved.referencedSourceHashes).toStrictEqual(
				sorted(main.sourceHash, owner.sourceHash),
			);
			expect(await repository.cleanupOrphanedSources()).toBe(0);
		});

		it('keeps the images of an effect this build does not know', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const owner = await add(repository, 2);
			await commit(
				repository,
				main.id,
				stackOf(
					instance({
						type: 'futureBlend',
						version: 3,
						params: {overlay: owner.sourceHash},
					}),
				),
			);
			await repository.deleteProject(owner.id);

			expect(await repository.cleanupOrphanedSources()).toBe(0);
			expect(await repository.hasSource(owner.sourceHash)).toBe(true);
		});

		it('rejects a ninth distinct extra image and writes nothing (AC-F26.6)', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const images: string[] = [];
			for (let seed = 2; seed <= 10; seed++) {
				images.push((await add(repository, seed)).sourceHash);
			}

			const [ninth, ...eight] = images;
			// Split over both sides, with a repeat and the primary source.
			await commit(
				repository,
				main.id,
				blends(...eight.slice(0, 5), eight[0], main.sourceHash),
				blends(...eight.slice(4)),
			);
			const before = {
				project: await repository.getProject(main.id),
				history: await repository.getHistory(main.id),
			};

			for (const write of [
				async () =>
					commit(repository, main.id, blends(...eight.slice(0, 5), ninth)),
				async () => commit(repository, main.id, stackOf(), blends(...images)),
				async () =>
					repository.saveProjectStack(
						main.id,
						blends(...eight.slice(0, 5), ninth),
					),
			]) {
				const error: unknown = await write().catch((error: unknown) => error);
				expect(error).toBeInstanceOf(StorageValidationError);
				expect((error as Error).message).toBe(LIMIT);
			}

			expect({
				project: await repository.getProject(main.id),
				history: await repository.getHistory(main.id),
			}).toStrictEqual(before);

			// Swapping one image for the new one stays at eight.
			await commit(
				repository,
				main.id,
				blends(...eight.slice(1, 5), ninth),
				blends(...eight.slice(5)),
			);
		});

		it('refuses a stack naming an image that is not stored', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const before = await repository.getHistory(main.id);

			for (const write of [
				async () => commit(repository, main.id, blends('9'.repeat(64))),
				async () =>
					repository.saveProjectStack(main.id, blends('9'.repeat(64))),
			]) {
				await expect(write()).rejects.toThrow(StorageValidationError);
			}

			expect(await repository.getHistory(main.id)).toStrictEqual(before);
		});

		it('saves a preset without its images (AC-F26.7)', async () => {
			const {repository} = await adapter.create();
			const owner = await add(repository, 1);
			const sort = instance();
			const stack = stackOf(blend(owner.sourceHash, 'withImage'), sort);
			const input = structuredClone(stack);

			const preset = await repository.createPreset({name: 'Blend', stack});

			const stripped: EffectInstance[] = [
				{
					...stack.instances[0],
					params: {
						image: '',
						blendMode: 'difference',
						opacity: 0.5,
						fit: 'tile',
					},
				},
				sort,
			];
			expect(preset.stack.instances).toStrictEqual(stripped);
			expect((await repository.listPresets())[0].stack.instances).toStrictEqual(
				stripped,
			);
			expect(stack).toStrictEqual(input);
			await repository.deleteProject(owner.id);
			expect(await repository.getSourceSizes()).toStrictEqual({});
		});

		it('saves a project file with every image and opens it elsewhere', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);
			const history = await repository.getHistory(seeded.id);
			const {blob} = await repository.exportProjectFile(seeded.id);

			const entries = await entriesOf(blob);
			const {sources} = jsonOf<{sources: Array<{sha256: string}>}>(
				entries['manifest.json'],
			);
			expect(sources.map((source) => source.sha256)).toStrictEqual([
				seeded.primary,
				...sorted(seeded.current, seeded.sideA, seeded.undoOnly),
			]);

			const fresh = (await adapter.create()).repository;
			const {project, source} = await fresh.importProjectFile(blob, FILE);

			expect(source.sha256).toBe(seeded.primary);
			expect(project.referencedSourceHashes).toStrictEqual(
				await referencesOf(repository, seeded.id),
			);
			for (const sha256 of project.referencedSourceHashes) {
				expect(await bytesOf(fresh, sha256)).toStrictEqual(
					await bytesOf(repository, sha256),
				);
			}

			expect(await fresh.getHistory(project.id)).toStrictEqual(
				history.map((entry) => ({...entry, projectId: project.id})),
			);
			expect(await fresh.cleanupOrphanedSources()).toBe(0);
			await fresh.deleteProject(project.id);
			expect(await fresh.getSourceSizes()).toStrictEqual({});
		});

		it('leaves images only history uses out of a file without history', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);

			const {blob} = await repository.exportProjectFile(seeded.id, {
				includeHistory: false,
			});
			const fresh = (await adapter.create()).repository;
			const {project} = await fresh.importProjectFile(blob, FILE);

			const kept = sorted(seeded.primary, seeded.current, seeded.sideA);
			expect(project.referencedSourceHashes).toStrictEqual(kept);
			expect(
				Object.keys(await fresh.getSourceSizes()).toSorted(),
			).toStrictEqual(kept);
		});

		it('refuses a project file that lacks an image it uses', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);
			const {blob} = await repository.exportProjectFile(seeded.id);
			const files = await entriesOf(blob);
			const manifest = jsonOf(files['manifest.json']);
			dropSource(manifest, seeded.undoOnly);
			files['manifest.json'] = strToU8(JSON.stringify(manifest));
			Reflect.deleteProperty(files, `sources/${seeded.undoOnly}.png`);
			const fresh = (await adapter.create()).repository;

			await expect(fresh.importProjectFile(zipOf(files), FILE)).rejects.toThrow(
				`Can't open ${FILE}: missing image data (sources/${seeded.undoOnly}).`,
			);
			expect(await fresh.getSourceSizes()).toStrictEqual({});
		});

		it('refuses a project file with nine extra images', async () => {
			const {repository} = await adapter.create();
			const main = await add(repository, 1);
			const {blob} = await repository.exportProjectFile(main.id);
			const files = await entriesOf(blob);
			const nine = Array.from({length: 9}, (_, index) =>
				String(index).repeat(64).slice(0, 64),
			);
			const payload = jsonOf(files['project.json']);
			payload.stack = blends(...nine);
			files['project.json'] = strToU8(JSON.stringify(payload));
			const fresh = (await adapter.create()).repository;

			await expect(fresh.importProjectFile(zipOf(files), FILE)).rejects.toThrow(
				'missing or invalid project metadata.',
			);
		});

		it('backs up every image once and restores it on a fresh profile', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);
			const copy = await repository.duplicateProject(seeded.id);
			const before = await librarySnapshot(repository);

			const {blob} = await repository.exportBackup();

			const entries = await entriesOf(blob);
			expect(
				Object.keys(entries).filter((path) => path.startsWith('sources/')),
			).toHaveLength(4);
			const sizes = await repository.getSourceSizes();
			const total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
			expect(jsonOf(entries['manifest.json'])).toMatchObject({
				projects: [{totalSourceBytes: total}, {totalSourceBytes: total}],
			});

			const fresh = (await adapter.create()).repository;
			const inspection = await fresh.inspectBackup(blob);
			expect(inspection.preview.projects[0].sourceBytes).toBe(total);
			expect(backupNewBytes(inspection.preview, [copy.id])).toBe(total);
			await fresh.importBackup(inspection, selectAll(inspection));

			const after = await librarySnapshot(fresh);
			expect(after.sources).toStrictEqual(sizes);
			expect(after.records.map((record) => record.history)).toStrictEqual(
				before.records.map((record) => record.history),
			);
			expect(
				after.records.map((record) => record.project.referencedSourceHashes),
			).toStrictEqual(
				before.records.map((record) => record.project.referencedSourceHashes),
			);
			for (const sha256 of Object.keys(sizes)) {
				expect(await bytesOf(fresh, sha256)).toStrictEqual(
					await bytesOf(repository, sha256),
				);
			}

			expect(await fresh.cleanupOrphanedSources()).toBe(0);
		});

		it('imports the images of the chosen project only', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);
			const other = await add(repository, 9);
			const {blob} = await repository.exportBackup();
			const fresh = (await adapter.create()).repository;
			const inspection = await fresh.inspectBackup(blob);

			await fresh.importBackup(
				inspection,
				selectAll(inspection, {projectIds: [seeded.id]}),
			);

			const sizes = await fresh.getSourceSizes();
			expect(Object.keys(sizes).toSorted()).toStrictEqual(
				await referencesOf(repository, seeded.id),
			);
			expect(sizes[other.sourceHash]).toBeUndefined();
		});

		it('leaves images only history uses out of a backup without history', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);

			const {blob} = await repository.exportBackup({includeHistory: false});
			const fresh = (await adapter.create()).repository;
			const inspection = await fresh.inspectBackup(blob);
			await fresh.importBackup(inspection, selectAll(inspection));

			const kept = sorted(seeded.primary, seeded.current, seeded.sideA);
			expect(await referencesOf(fresh, seeded.id)).toStrictEqual(kept);
			expect(
				Object.keys(await fresh.getSourceSizes()).toSorted(),
			).toStrictEqual(kept);
		});

		it('frees replaced images and keeps the imported ones', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);
			const {blob} = await repository.exportBackup();
			const local = (await adapter.create()).repository;
			const gone = await add(local, 7);
			const owner = await add(local, 8);
			await commit(local, gone.id, blends(owner.sourceHash));

			const inspection = await local.inspectBackup(blob);
			await local.importBackup(
				inspection,
				selectAll(inspection, {mode: 'replace'}),
			);

			expect(
				Object.keys(await local.getSourceSizes()).toSorted(),
			).toStrictEqual(await referencesOf(repository, seeded.id));
		});

		it('keeps local images on a Merge and gives the copy its references', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);
			const {blob} = await repository.exportBackup();
			await repository.renameProject(seeded.id, 'Edited since');
			const sizes = await repository.getSourceSizes();

			const inspection = await repository.inspectBackup(blob);
			const result = await repository.importBackup(
				inspection,
				selectAll(inspection),
			);

			const copy = result.projects[0];
			expect(copy.id).not.toBe(seeded.id);
			expect(copy.referencedSourceHashes).toStrictEqual(
				await referencesOf(repository, seeded.id),
			);
			expect(await repository.getSourceSizes()).toStrictEqual(sizes);
		});

		it('refuses a backup whose history uses an unlisted image', async () => {
			const {repository} = await adapter.create();
			const seeded = await seedBlended(repository);
			const {blob} = await repository.exportBackup();
			const edited = await editedBackup(blob, (files, json) => {
				json('manifest.json', (value) => {
					dropSource(value, seeded.undoOnly);
				});
				Reflect.deleteProperty(files, `sources/${seeded.undoOnly}.png`);
			});
			const fresh = (await adapter.create()).repository;

			await expect(fresh.inspectBackup(edited)).rejects.toThrow(
				`Can't import backup: missing image data (sources/${seeded.undoOnly}).`,
			);
		});

		it('empties images in the presets of a backup', async () => {
			const {repository} = await adapter.create();
			await repository.createPreset({name: 'Blend', stack: blends('')});
			const {blob} = await repository.exportBackup();
			const edited = await editedBackup(blob, (_, json) => {
				json('presets.json', (value) => {
					const {presets} = value as {
						presets: Array<{stack: EffectStack}>;
					};
					presets[0].stack = blends('9'.repeat(64));
				});
			});
			const fresh = (await adapter.create()).repository;

			const inspection = await fresh.inspectBackup(edited);
			await fresh.importBackup(inspection, selectAll(inspection));

			expect((await fresh.listPresets())[0].stack).toStrictEqual(blends(''));
		});
	});
}

describe('IndexedDbRepository extra sources', () => {
	it.each(['history', 'projects'])(
		'rolls the picked blob back when writing %s fails after it',
		async (failing) => {
			const {repository, database} = await indexedDbSetup();
			const main = await add(repository, 1);
			const image = await picked(2);
			const before = await everything(repository, main.id);
			const prototype = Object.getPrototypeOf(
				database.transaction('projects').objectStore('projects'),
			) as IDBObjectStore;
			const {put} = prototype;
			const written: string[] = [];
			const spy = vi.spyOn(prototype, 'put').mockImplementation(function (
				this: IDBObjectStore,
				...args
			) {
				if (this.name === failing) {
					throw new DOMException('Disk full', 'QuotaExceededError');
				}

				written.push(this.name);
				return put.apply(this, args);
			});

			try {
				await expect(
					commitPicked(repository, main.id, blends(image.sha256), image),
				).rejects.toThrow(StorageQuotaError);
			} finally {
				spy.mockRestore();
			}

			// The blob had been written inside the transaction that failed.
			expect(written).toContain('sources');
			expect(await everything(repository, main.id)).toStrictEqual(before);
			expect(await repository.cleanupOrphanedSources()).toBe(0);
		},
	);

	it('checks the quota before storing a picked image, but not a stored one', async () => {
		let quota = 1_000_000;
		const {repository} = await indexedDbSetup({
			storageManager: {estimate: async () => ({usage: 0, quota})},
		});
		const main = await add(repository, 1);
		const owner = await add(repository, 2);
		const image = await picked(3);
		quota = 100;

		await expect(
			commitPicked(repository, main.id, blends(image.sha256), image),
		).rejects.toThrow(StorageQuotaError);
		expect(await repository.hasSource(image.sha256)).toBe(false);
		await commitPicked(
			repository,
			main.id,
			blends(owner.sourceHash),
			await picked(2),
		);
	});

	it('restores a missing image that is picked again', async () => {
		const {repository, database} = await indexedDbSetup();
		const main = await add(repository, 1);
		const image = await picked(2);
		await commitPicked(repository, main.id, blends(image.sha256), image);
		database
			.transaction('sources', 'readwrite')
			.objectStore('sources')
			.delete(image.sha256);
		await vi.waitFor(async () => {
			expect(await repository.hasSource(image.sha256)).toBe(false);
		});

		await commitPicked(repository, main.id, blends(image.sha256), image);

		expect(await repository.hasSource(image.sha256)).toBe(true);
	});

	it('stores none of the extra images when an import runs out of quota', async () => {
		const {repository} = await indexedDbSetup();
		await seedBlended(repository);
		const {blob} = await repository.exportBackup();
		const {repository: full, database} = await indexedDbSetup({
			// Room for the primary source, not for every image.
			storageManager: {estimate: async () => ({usage: 0, quota: 6000})},
		});
		const inspection = await full.inspectBackup(blob);

		await expect(
			full.importBackup(inspection, selectAll(inspection)),
		).rejects.toThrow(StorageQuotaError);
		expect(await allRecords(database, 'sources')).toStrictEqual([]);
	});

	it('reports a missing extra image on export', async () => {
		const {repository, database} = await indexedDbSetup();
		const seeded = await seedBlended(repository);
		database
			.transaction('sources', 'readwrite')
			.objectStore('sources')
			.delete(seeded.undoOnly);

		await expect(repository.exportProjectFile(seeded.id)).rejects.toThrow(
			"Can't save Image 1: its image data is missing.",
		);
		await expect(repository.exportBackup()).rejects.toThrow(
			"Can't export backup: the image data of Image 1 is missing.",
		);
		// The damaged project stays editable.
		await commit(repository, seeded.id, blends(seeded.current));
	});
});
