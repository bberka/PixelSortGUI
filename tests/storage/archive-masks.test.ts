// Painted masks in project files and backups (persistence.md section 8.6,
// product.md AC-F29.16), against both adapters.
import {deflateSync} from 'fflate';
import {describe, expect, it} from 'vite-plus/test';
import {encodeMaskAsset, maskBytes} from '../../src/engine/mask/asset.ts';
import type {InstanceMask} from '../../src/engine/mask/types.ts';
import type {EffectStack} from '../../src/engine/types.ts';
import {
	backupNewBytes,
	StorageQuotaError,
	type NewMask,
	type StorageRepository,
} from '../../src/storage/index.ts';
import {
	adapters,
	addProject,
	editedBackup,
	indexedDbSetup,
	memorySetup,
	selectAll,
	type BackupFiles,
} from './backup-fixtures.ts';
import {entriesOf, instance, jsonOf} from './project-fixtures.ts';
import {SOURCE_SIZE} from './project-transfer-fixtures.ts';
import {settle} from './idb-helpers.ts';

type Json = Record<string, unknown>;

async function asset(value: number, size = SOURCE_SIZE): Promise<NewMask> {
	const {sha256, width, height, compressed} = await encodeMaskAsset({
		...size,
		data: new Uint8Array(size.width * size.height).fill(value),
	});
	return {sha256, width, height, blob: new Blob([compressed])};
}

function maskedStack(mask: InstanceMask): EffectStack {
	return {schemaVersion: 2, instances: [instance({mask})]};
}

const painted = ({sha256}: {sha256: string}) =>
	maskedStack({kind: 'paint', asset: sha256, invert: false, feather: 0});

const luma: InstanceMask = {
	kind: 'luma',
	range: [0.5, 1],
	softness: 0.1,
	invert: false,
	feather: 0,
};

const pathOf = ({sha256}: {sha256: string}) => `masks/${sha256}.mask`;

async function bytesOf(blob: Blob) {
	return new Uint8Array(await blob.arrayBuffer());
}

// A project whose history uses `old` and whose current stack uses `current`.
async function seed(repository: StorageRepository) {
	const old = await asset(10);
	const current = await asset(200);
	const project = await addProject(repository, 'Masked');
	for (const mask of [old, current]) {
		await repository.commitStack({
			projectId: project.id,
			stack: painted(mask),
			selectedInstanceId: null,
			newMasks: [mask],
			label: 'Paint',
		});
	}

	return {project, old, current};
}

async function expectMask(repository: StorageRepository, mask: NewMask) {
	const stored = await repository.getMask(mask.sha256);
	expect(stored).toMatchObject({
		width: mask.width,
		height: mask.height,
		byteLength: mask.blob.size,
	});
	expect(await bytesOf(stored!.blob)).toStrictEqual(await bytesOf(mask.blob));
}

async function nothingWritten(repository: StorageRepository, mask: NewMask) {
	expect((await repository.getStartupSnapshot()).projects).toStrictEqual([]);
	expect(await repository.getSourceSizes()).toStrictEqual({});
	expect(await repository.getMask(mask.sha256)).toBeUndefined();
}

type Damage = (
	files: BackupFiles,
	manifest: (change: (value: Json) => void) => void,
	mask: NewMask,
) => void;

const firstEntry = (value: Json, sha256: string) =>
	(value.masks as Json[]).find((entry) => entry.sha256 === sha256)!;

// Replaces the data of a mask entry and keeps its byte length truthful.
function replaceData(bytes: Uint8Array): Damage {
	return (files, manifest, mask) => {
		files[pathOf(mask)] = bytes;
		manifest((value) => {
			firstEntry(value, mask.sha256).byteLength = bytes.length;
		});
	};
}

const otherPixels = deflateSync(
	maskBytes({...SOURCE_SIZE, data: new Uint8Array(120_000).fill(1)}),
);

// `expected` is the message after the prefix, or one of the two metadata cases.
const damages: Array<
	[string, Damage, 'damaged' | 'missing' | 'invalid' | 'large']
> = [
	['other pixels', replaceData(otherPixels), 'damaged'],
	[
		'bytes that do not inflate',
		replaceData(new Uint8Array(40).fill(7)),
		'damaged',
	],
	[
		'a stream longer than its grid',
		replaceData(deflateSync(new Uint8Array(1_000_000))),
		'damaged',
	],
	[
		'a wrong byte length',
		(_, manifest, mask) => {
			manifest((value) => {
				firstEntry(value, mask.sha256).byteLength = 1;
			});
		},
		'damaged',
	],
	[
		'a missing entry',
		(files, _, mask) => {
			Reflect.deleteProperty(files, pathOf(mask));
		},
		'missing',
	],
	[
		'an unlisted mask',
		(_, manifest, mask) => {
			manifest((value) => {
				value.masks = (value.masks as Json[]).filter(
					(entry) => entry.sha256 !== mask.sha256,
				);
			});
		},
		'missing',
	],
	[
		'a grid that is not the one of the source',
		(_, manifest, mask) => {
			manifest((value) => {
				firstEntry(value, mask.sha256).width = 300;
			});
		},
		'invalid',
	],
	[
		'a grid over the cap',
		(_, manifest, mask) => {
			manifest((value) => {
				firstEntry(value, mask.sha256).width = 4_194_304;
			});
		},
		'invalid',
	],
	[
		'no mask list',
		(_, manifest) => {
			manifest((value) => {
				delete value.masks;
			});
		},
		'invalid',
	],
	[
		'an entry over 8 MiB',
		replaceData(new Uint8Array(8 * 1024 * 1024 + 1)),
		'large',
	],
];

for (const adapter of adapters) {
	describe(`project files with masks: ${adapter.name}`, () => {
		it.each([true, false])(
			'round trips with history %s',
			async (includeHistory) => {
				const original = await adapter.create();
				const {project, old, current} = await seed(original.repository);
				const {blob, fileName} = await original.repository.exportProjectFile(
					project.id,
					{includeHistory},
				);

				const entries = await entriesOf(blob);
				const expected = includeHistory ? [old, current] : [current];
				expect(
					Object.keys(entries)
						.filter((name) => name.startsWith('masks/'))
						.toSorted(),
				).toStrictEqual(expected.map((mask) => pathOf(mask)).toSorted());
				expect(entries[pathOf(current)]).toStrictEqual(
					await bytesOf(current.blob),
				);
				expect(jsonOf(entries['manifest.json'])).toMatchObject({
					formatVersion: 2,
				});

				const {repository} = await adapter.create();
				const imported = await repository.importProjectFile(blob, fileName);

				expect(imported.project.stack).toStrictEqual(painted(current));
				expect(imported.project.referencedMaskHashes).toStrictEqual(
					expected.map((mask) => mask.sha256).toSorted(),
				);
				for (const mask of expected) {
					await expectMask(repository, mask);
				}

				const undone = await repository.undo(imported.project.id);
				expect(undone?.project.stack).toStrictEqual(
					includeHistory ? painted(old) : undefined,
				);
			},
		);

		it('writes version 2 with an empty list for a brightness mask only', async () => {
			const {repository} = await adapter.create();
			const project = await addProject(repository, 'Luma');
			await repository.saveProjectStack(project.id, maskedStack(luma));

			const {blob} = await repository.exportProjectFile(project.id);

			expect(jsonOf((await entriesOf(blob))['manifest.json'])).toMatchObject({
				formatVersion: 2,
				masks: [],
			});
		});

		it('writes version 1 without a mask list when nothing is masked', async () => {
			const {repository} = await adapter.create();
			const project = await addProject(repository, 'Plain');
			await repository.createPreset({
				name: 'Plain',
				stack: painted(await asset(1)),
			});

			const file = await repository.exportProjectFile(project.id);
			const backup = await repository.exportBackup();

			const manifest = jsonOf((await entriesOf(file.blob))['manifest.json']);
			expect(manifest).toMatchObject({formatVersion: 1});
			expect(manifest).not.toHaveProperty('masks');
			const archived = jsonOf((await entriesOf(backup.blob))['manifest.json']);
			expect(archived).toMatchObject({
				backupVersion: 1,
				projectFormatVersion: 1,
			});
			expect(archived).not.toHaveProperty('masks');
		});

		it('writes a backup as version 2 for a masked preset alone', async () => {
			const {repository} = await adapter.create();
			await repository.createPreset({name: 'Luma', stack: maskedStack(luma)});

			const {blob} = await repository.exportBackup();

			expect(jsonOf((await entriesOf(blob))['manifest.json'])).toMatchObject({
				backupVersion: 2,
				projectFormatVersion: 2,
				masks: [],
			});
			const target = await adapter.create();
			const inspection = await target.repository.inspectBackup(blob);
			const result = await target.repository.importBackup(
				inspection,
				selectAll(inspection),
			);
			expect(result.presets[0].stack).toStrictEqual(maskedStack(luma));
		});

		it.each(damages)(
			'writes nothing for a project file with %s (AC-F29.16)',
			async (_, damage, kind) => {
				const original = await adapter.create();
				const {project, current} = await seed(original.repository);
				const {blob} = await original.repository.exportProjectFile(project.id);
				const edited = await editedBackup(blob, (files, json) => {
					damage(
						files,
						(change) => {
							json('manifest.json', change);
						},
						current,
					);
				});
				const {repository} = await adapter.create();

				await expect(
					repository.importProjectFile(edited, 'x.glproj'),
				).rejects.toThrow(
					`Can't open x.glproj: ${
						{
							damaged: `mask data is damaged (${pathOf(current)}).`,
							missing: `missing mask data (${pathOf(current)}).`,
							invalid: 'missing or invalid project metadata.',
							large: 'the project file is too large',
						}[kind]
					}`,
				);
				await nothingWritten(repository, current);
			},
		);

		it.each(damages)(
			'writes nothing for a backup with %s (AC-F29.16)',
			async (_, damage, kind) => {
				const original = await adapter.create();
				const {current} = await seed(original.repository);
				const {blob} = await original.repository.exportBackup();
				const edited = await editedBackup(blob, (files, json) => {
					damage(
						files,
						(change) => {
							json('manifest.json', change);
						},
						current,
					);
				});
				const {repository} = await adapter.create();

				await expect(repository.inspectBackup(edited)).rejects.toThrow(
					`Can't import backup: ${
						{
							damaged: `mask data is damaged (${pathOf(current)}).`,
							missing: `missing mask data (${pathOf(current)}).`,
							invalid: 'missing or invalid manifest.',
							large: 'the archive is too large',
						}[kind]
					}`,
				);
				await nothingWritten(repository, current);
			},
		);

		it('refuses to save a mask stored on another grid', async () => {
			const {repository} = await adapter.create();
			const project = await addProject(repository, 'Broken');
			const mask = await asset(5, {width: 4, height: 3});
			await repository.commitStack({
				projectId: project.id,
				stack: painted(mask),
				selectedInstanceId: null,
				newMasks: [mask],
				label: 'Paint',
			});

			await expect(repository.exportProjectFile(project.id)).rejects.toThrow(
				"Can't save Broken: its mask data is missing.",
			);
			await expect(repository.exportBackup()).rejects.toThrow(
				"Can't export backup: the mask data of Broken is missing.",
			);
		});

		it('stores each mask of a backup once and restores undo (AC-F29.16)', async () => {
			const original = await adapter.create();
			const {project, old, current} = await seed(original.repository);
			await original.repository.duplicateProject(project.id);
			const {blob} = await original.repository.exportBackup();
			const names = Object.keys(await entriesOf(blob));
			expect(names.filter((name) => name.startsWith('masks/'))).toHaveLength(2);

			const {repository} = await adapter.create();
			const inspection = await repository.inspectBackup(blob);
			const ids = inspection.preview.projects.map((item) => item.id);
			expect(backupNewBytes(inspection.preview, ids)).toBe(
				200_000 + old.blob.size + current.blob.size,
			);
			await repository.importBackup(inspection, selectAll(inspection));

			await expectMask(repository, old);
			await expectMask(repository, current);
			const undone = await repository.undo(project.id);
			expect(undone?.project.stack).toStrictEqual(painted(old));
		});

		it('holds only current masks in a backup without history', async () => {
			const original = await adapter.create();
			const {current, old} = await seed(original.repository);
			const {blob} = await original.repository.exportBackup({
				includeHistory: false,
			});
			const {repository} = await adapter.create();
			const inspection = await repository.inspectBackup(blob);
			await repository.importBackup(inspection, selectAll(inspection));

			await expectMask(repository, current);
			expect(await repository.getMask(old.sha256)).toBeUndefined();
		});

		it('removes staged masks when the commit fails', async () => {
			const original = await adapter.create();
			const {current} = await seed(original.repository);
			const {blob} = await original.repository.exportBackup();
			const {repository} = await adapter.create();
			const inspection = await repository.inspectBackup(blob);
			const controller = new AbortController();

			await expect(
				repository.importBackup(inspection, selectAll(inspection), {
					signal: controller.signal,
					onProgress({path}) {
						if (path?.startsWith('masks/')) {
							controller.abort();
						}
					},
				}),
			).rejects.toThrow(/abort/i);

			await nothingWritten(repository, current);
		});

		it('frees the masks of replaced projects', async () => {
			const incoming = await adapter.create();
			await addProject(incoming.repository, 'Plain');
			const {blob} = await incoming.repository.exportBackup();
			const {repository} = await adapter.create();
			const {current, old} = await seed(repository);
			const inspection = await repository.inspectBackup(blob);

			await repository.importBackup(
				inspection,
				selectAll(inspection, {mode: 'replace'}),
			);

			expect(await repository.getMask(current.sha256)).toBeUndefined();
			expect(await repository.getMask(old.sha256)).toBeUndefined();
		});

		it('inserts again a mask that went missing after staging', async () => {
			const original = await adapter.create();
			const {current} = await seed(original.repository);
			const {blob} = await original.repository.exportBackup();
			const {repository} = await adapter.create();
			const inspection = await repository.inspectBackup(blob);
			let cleanup: Promise<number> | undefined;

			await repository.importBackup(inspection, selectAll(inspection), {
				onProgress({path}) {
					// Nothing refers to the staged masks yet.
					if (path?.startsWith('masks/')) {
						cleanup = repository.cleanupOrphanedMasks();
					}
				},
			});

			expect(await cleanup).toBeGreaterThan(0);
			await expectMask(repository, current);
		});
	});
}

describe('a mask that is not stored', () => {
	it('stops a save and an export with the exact messages', async () => {
		const {repository, database} = await indexedDbSetup();
		const {current} = await seed(repository);
		const [project] = (await repository.getStartupSnapshot()).projects;
		await settle(
			database
				.transaction('masks', 'readwrite')
				.objectStore('masks')
				.delete(current.sha256),
		);

		await expect(repository.exportProjectFile(project.id)).rejects.toThrow(
			"Can't save Masked: its mask data is missing.",
		);
		await expect(repository.exportBackup()).rejects.toThrow(
			"Can't export backup: the mask data of Masked is missing.",
		);
	});
});

describe('mask quota', () => {
	it('counts mask bytes in both import quota checks', async () => {
		const original = await memorySetup();
		const {project, current, old} = await seed(original.repository);
		const file = await original.repository.exportProjectFile(project.id);
		const backup = await original.repository.exportBackup();
		const imageBytes = 200_000;
		// Room for the image and its headroom, but not for the masks too.
		const quota = Math.ceil(imageBytes * 1.15) + 1;
		expect(old.blob.size + current.blob.size).toBeGreaterThan(1);
		const {repository} = await indexedDbSetup({
			storageManager: {estimate: async () => ({usage: 0, quota})},
		});

		await expect(
			repository.importProjectFile(file.blob, file.fileName),
		).rejects.toThrow(StorageQuotaError);
		const inspection = await repository.inspectBackup(backup.blob);
		await expect(
			repository.importBackup(inspection, selectAll(inspection)),
		).rejects.toThrow(StorageQuotaError);
		await nothingWritten(repository, current);
	});
});
