import {describe, expect, it} from 'vite-plus/test';
import {BackupError} from '../../src/storage/backup-error.ts';
import {
	backupImportSummary,
	backupNewBytes,
	StorageNotFoundError,
	StorageQuotaError,
	StorageValidationError,
	type BackupProgress,
	type StorageRepository,
} from '../../src/storage/index.ts';
import {
	adapters,
	addProject,
	editedBackup,
	exportedBackup,
	indexedDbSetup,
	librarySnapshot,
	OTHER_BYTES,
	seedLibrary,
	selectAll,
	SHARED_BYTES,
} from './backup-fixtures.ts';
import {
	entriesOf,
	instance,
	jsonOf,
	noise,
	stackOf,
} from './project-fixtures.ts';
import {allRecords} from './idb-helpers.ts';

const PREFIX = "Can't import backup:";
const LOCAL_BYTES = noise(90_000, 11);

async function sha256Of(repository: StorageRepository, id: string) {
	return (await repository.getProject(id))!.sourceHash;
}

// A local library that shares nothing with the backup.
async function seedLocal(repository: StorageRepository) {
	const project = await addProject(repository, 'Local only', LOCAL_BYTES);
	const preset = await repository.createPreset({
		name: 'Local preset',
		stack: stackOf(instance({mix: 0.9})),
	});
	await repository.updateAppState({theme: 'light'});
	return {project, preset};
}

for (const adapter of adapters) {
	describe(`backup and restore: ${adapter.name}`, () => {
		it('exports shared sources once with presets and settings (AC-F17.1)', async () => {
			const {repository} = await adapter.create();
			const {ids} = await seedLibrary(repository);

			const {blob, fileName} = await repository.exportBackup();

			expect(fileName).toMatch(/^glitch-backup-\d{8}-\d{6}\.zip$/);
			const entries = await entriesOf(blob);
			const names = Object.keys(entries);
			expect(
				names.filter((name) => name.startsWith('sources/')).toSorted(),
			).toStrictEqual(
				[
					`sources/${await sha256Of(repository, ids.edited)}.png`,
					`sources/${await sha256Of(repository, ids.other)}.png`,
				].toSorted(),
			);
			expect(
				names.filter((name) => name.endsWith('/project.json')),
			).toHaveLength(3);
			expect(names).toEqual(
				expect.arrayContaining([
					'manifest.json',
					'presets.json',
					'settings.json',
				]),
			);
			expect(jsonOf(entries['settings.json'])).toStrictEqual({
				theme: 'dark',
				compareMode: 'split',
			});
			expect(jsonOf(entries['manifest.json'])).toMatchObject({
				scope: 'library',
				presetCount: 2,
			});
		});

		it('exports only the chosen projects and parts', async () => {
			const {repository} = await adapter.create();
			const {ids} = await seedLibrary(repository);

			const {blob} = await repository.exportBackup({
				projectIds: [ids.twin],
				includeHistory: false,
				includePresets: false,
				includeSettings: false,
			});

			const entries = await entriesOf(blob);
			expect(Object.keys(entries)).toStrictEqual([
				'manifest.json',
				`projects/${ids.twin}/project.json`,
				`sources/${await sha256Of(repository, ids.twin)}.png`,
			]);
			expect(jsonOf(entries['manifest.json'])).toMatchObject({
				scope: 'selection',
				includesHistory: false,
			});
			await expect(
				repository.exportBackup({projectIds: ['nope']}),
			).rejects.toThrow(StorageNotFoundError);
		});

		it('reports the stored source sizes', async () => {
			const {repository} = await adapter.create();
			await seedLibrary(repository);

			const sizes = Object.values(await repository.getSourceSizes());

			expect(sizes.toSorted((a, b) => a - b)).toStrictEqual([150_000, 200_000]);
		});

		it('restores the checked projects, presets and settings on a fresh profile (AC-F17.2)', async () => {
			const original = await exportedBackup();
			const {repository} = await adapter.create({now: () => 5000});

			const inspection = await repository.inspectBackup(original.blob);

			expect(await repository.listProjects()).toStrictEqual([]);
			expect(await repository.getSourceSizes()).toStrictEqual({});
			const {preview} = inspection;
			expect(preview.projects.map((item) => item.status)).toStrictEqual([
				'New',
				'New',
				'New',
			]);
			expect(preview).toMatchObject({
				presetCount: 2,
				hasSettings: true,
				localProjectCount: 0,
				localPresetCount: 0,
			});
			const cropped = preview.projects.find(
				(item) => item.id === original.ids.edited,
			)!;
			expect(cropped).toMatchObject({
				name: 'Night Drive',
				sourceBytes: 200_000,
			});
			expect([cropped.width, cropped.height]).not.toStrictEqual([400, 300]);
			const chosen = [original.ids.edited, original.ids.twin];
			expect(backupNewBytes(preview, chosen)).toBe(200_000);

			const result = await repository.importBackup(
				inspection,
				selectAll(inspection, {projectIds: chosen}),
			);

			expect(backupImportSummary(result)).toBe(
				'Imported 2 projects and 2 presets. Applied settings.',
			);
			const restored = await repository.listProjects();
			expect(restored.map((item) => item.id).toSorted()).toStrictEqual(
				chosen.toSorted(),
			);
			for (const id of chosen) {
				expect(await repository.getProject(id)).toStrictEqual(
					await original.repository.getProject(id),
				);
				expect(await repository.getHistory(id)).toStrictEqual(
					await original.repository.getHistory(id),
				);
			}

			const edited = (await repository.getProject(original.ids.edited))!;
			expect(edited.stackA?.instances).toHaveLength(1);
			expect(edited.transform.rotation).toBe(90);
			const source = (await repository.getSource(edited.sourceHash))!;
			expect(new Uint8Array(await source.blob.arrayBuffer())).toStrictEqual(
				SHARED_BYTES,
			);
			expect(await repository.getThumbnail(edited.id)).toMatchObject({
				width: 200,
				stackSignature: '',
			});
			expect(Object.keys(await repository.getSourceSizes())).toHaveLength(1);
			expect(await repository.listPresets()).toStrictEqual(
				await original.repository.listPresets(),
			);
			expect(await repository.getAppState()).toMatchObject({
				theme: 'dark',
				compareMode: 'split',
				activeProjectId: null,
			});
		});

		it('leaves presets and settings alone when unchecked', async () => {
			const {blob} = await exportedBackup();
			const {repository} = await adapter.create();
			const inspection = await repository.inspectBackup(blob);

			await repository.importBackup(
				inspection,
				selectAll(inspection, {presets: false, settings: false}),
			);

			expect(await repository.listPresets()).toStrictEqual([]);
			expect(await repository.getAppState()).toMatchObject({
				theme: 'system',
				compareMode: 'toggle',
			});
		});

		it('writes an Initial entry holding side A for a backup without history', async () => {
			const {repository: source} = await adapter.create();
			const {ids} = await seedLibrary(source);
			const {blob} = await source.exportBackup({includeHistory: false});
			const {repository} = await adapter.create({now: () => 7000});
			const inspection = await repository.inspectBackup(blob);

			await repository.importBackup(inspection, selectAll(inspection));

			const history = await repository.getHistory(ids.edited);
			expect(history).toMatchObject([
				{seq: 0, label: 'Initial', createdAt: 7000},
			]);
			expect(history[0].stackA?.instances).toHaveLength(1);
			expect(history[0].transform.rotation).toBe(90);
		});

		it('skips unchanged projects and presets on a second Merge (AC-F17.3)', async () => {
			const {repository} = await adapter.create();
			await seedLibrary(repository);
			const {blob} = await repository.exportBackup();
			const before = await librarySnapshot(repository);

			const inspection = await repository.inspectBackup(blob);

			expect(
				inspection.preview.projects.map((item) => item.status),
			).toStrictEqual(['Unchanged', 'Unchanged', 'Unchanged']);
			expect(inspection.preview.newSources).toStrictEqual({});
			const result = await repository.importBackup(
				inspection,
				selectAll(inspection),
			);

			expect(result).toMatchObject({
				projects: [],
				skippedProjectCount: 3,
				presets: [],
				skippedPresetCount: 2,
			});
			expect(await librarySnapshot(repository)).toStrictEqual(before);
		});

		it('keeps a local edit and imports the clash under a new name (AC-F17.3)', async () => {
			const {repository} = await adapter.create();
			const {ids} = await seedLibrary(repository);
			const {blob} = await repository.exportBackup();
			const backedUp = await repository.getHistory(ids.edited);
			await repository.commitStack({
				projectId: ids.edited,
				stack: stackOf(instance({id: 'local001'})),
				selectedInstanceId: null,
				label: 'Local edit',
			});
			const edited = (await repository.getProject(ids.edited))!;

			const inspection = await repository.inspectBackup(blob);

			expect(
				Object.fromEntries(
					inspection.preview.projects.map((item) => [item.id, item.status]),
				),
			).toStrictEqual({
				[ids.edited]: 'Modified locally',
				[ids.twin]: 'Unchanged',
				[ids.other]: 'Unchanged',
			});
			const result = await repository.importBackup(
				inspection,
				selectAll(inspection),
			);

			expect(result.projects).toHaveLength(1);
			const [copy] = result.projects;
			expect(copy.id).not.toBe(ids.edited);
			expect(copy.name).toBe('Night Drive (imported)');
			expect(await repository.getProject(ids.edited)).toStrictEqual(edited);
			expect(await repository.getHistory(copy.id)).toStrictEqual(
				backedUp.map((entry) => ({...entry, projectId: copy.id})),
			);
			expect(await repository.getThumbnail(copy.id)).toBeDefined();
			expect(await repository.listProjects()).toHaveLength(4);

			const again = await repository.importBackup(
				inspection,
				selectAll(inspection),
			);
			expect(again.projects[0].name).toBe('Night Drive (imported 2)');
		});

		it('adds the suffix even when a rename freed the name', async () => {
			const {repository} = await adapter.create();
			const {ids} = await seedLibrary(repository);
			const {blob} = await repository.exportBackup();
			await repository.renameProject(ids.twin, 'Renamed');

			const inspection = await repository.inspectBackup(blob);
			const result = await repository.importBackup(
				inspection,
				selectAll(inspection),
			);

			expect(result.projects.map((item) => item.name)).toStrictEqual([
				'Twin (imported)',
			]);
		});

		it('merges presets by name and stack, and renews a clashing id', async () => {
			const {repository} = await adapter.create();
			const {presets} = await seedLibrary(repository);
			const {blob} = await repository.exportBackup();
			// Renamed with the same stack: still the same id, so skipped.
			await repository.renamePreset(presets.warm.id, 'Warmer');
			// Same id, different stack: imported under a new id.
			const changed = stackOf(instance({mix: 0.75}));
			const edited = await editedBackup(blob, (_, json) => {
				json('presets.json', (value) => {
					// Listed by name, so "Cold" comes first.
					(value.presets as Array<{stack: unknown}>)[0].stack = changed;
				});
			});

			const inspection = await repository.inspectBackup(edited);
			const result = await repository.importBackup(
				inspection,
				selectAll(inspection),
			);

			expect(result.skippedPresetCount).toBe(1);
			expect(result.presets.map((item) => item.name)).toStrictEqual(['Cold']);
			expect(result.presets[0].id).not.toBe(presets.cold.id);
			expect(result.presets[0].id).toMatch(/^user:/);
			const names = (await repository.listPresets()).map((item) => item.name);
			expect(names).toStrictEqual(['Cold', 'Cold', 'Warmer']);
		});

		it('replaces projects and presets and frees orphaned sources (AC-F17.4)', async () => {
			const original = await exportedBackup();
			const {repository} = await adapter.create();
			const local = await seedLocal(repository);
			await repository.openProject(local.project.id);
			const inspection = await repository.inspectBackup(original.blob);
			expect(inspection.preview).toMatchObject({
				localProjectCount: 1,
				localPresetCount: 1,
			});
			const chosen = [original.ids.edited, original.ids.other];

			const result = await repository.importBackup(
				inspection,
				selectAll(inspection, {mode: 'replace', projectIds: chosen}),
			);

			expect(result.projects.map((item) => item.id).toSorted()).toStrictEqual(
				chosen.toSorted(),
			);
			const projects = await repository.listProjects();
			expect(projects.map((item) => item.id).toSorted()).toStrictEqual(
				chosen.toSorted(),
			);
			expect(await repository.getHistory(local.project.id)).toStrictEqual([]);
			expect(await repository.hasSource(local.project.sourceHash)).toBe(false);
			expect(Object.keys(await repository.getSourceSizes())).toHaveLength(2);
			expect(
				(await repository.listPresets()).map((item) => item.name),
			).toStrictEqual(['Cold', 'Warm']);
			expect((await repository.getAppState()).activeProjectId).toBeNull();
		});

		it('replaces an edited project under its own id and name', async () => {
			const {repository} = await adapter.create();
			const {ids} = await seedLibrary(repository);
			const {blob} = await repository.exportBackup();
			const backedUp = await repository.getProject(ids.twin);
			await repository.renameProject(ids.twin, 'Renamed');
			const inspection = await repository.inspectBackup(blob);

			await repository.importBackup(
				inspection,
				selectAll(inspection, {
					mode: 'replace',
					presets: false,
					settings: false,
				}),
			);

			expect(await repository.getProject(ids.twin)).toStrictEqual(backedUp);
			expect(await repository.listProjects()).toHaveLength(3);
			// Replace clears presets even when none are imported.
			expect(await repository.listPresets()).toStrictEqual([]);
			expect(await repository.getAppState()).toMatchObject({theme: 'dark'});
		});

		it('writes nothing when a selection names an unknown project', async () => {
			const {blob} = await exportedBackup();
			const {repository} = await adapter.create();
			const inspection = await repository.inspectBackup(blob);

			await expect(
				repository.importBackup(
					inspection,
					selectAll(inspection, {projectIds: ['nope']}),
				),
			).rejects.toThrow(StorageValidationError);
			expect(await repository.getSourceSizes()).toStrictEqual({});
		});

		it.each<[string, (progress: BackupProgress) => boolean]>([
			['before reading', (progress) => progress.stage === 'reading'],
			[
				'between two projects',
				(progress) => progress.stage === 'reading' && progress.fraction > 0,
			],
			['while packing', (progress) => progress.stage === 'packing'],
		])(
			'stops an export cancelled %s and changes nothing (AC-F17.5)',
			async (_, when) => {
				const {repository} = await adapter.create();
				await seedLibrary(repository);
				const before = await librarySnapshot(repository);
				const controller = new AbortController();
				let abortedAt = 0;

				await expect(
					repository.exportBackup({
						signal: controller.signal,
						onProgress(progress) {
							if (!when(progress)) {
								return;
							}

							abortedAt ||= performance.now();
							controller.abort();
						},
					}),
				).rejects.toThrow(/abort/i);

				expect(abortedAt).toBeGreaterThan(0);
				expect(performance.now() - abortedAt).toBeLessThan(1000);
				expect(await librarySnapshot(repository)).toStrictEqual(before);
			},
		);

		it.each<[string, (progress: BackupProgress) => boolean]>([
			['before the first image', (progress) => progress.fraction === 0],
			['after the first image', (progress) => progress.fraction > 0],
			['before the commit', (progress) => progress.fraction === 0.9],
		])('undoes an import cancelled %s (AC-F17.5)', async (_, when) => {
			const {blob} = await exportedBackup();
			const {repository} = await adapter.create();
			await seedLocal(repository);
			const inspection = await repository.inspectBackup(blob);
			const before = await librarySnapshot(repository);
			const controller = new AbortController();
			let abortedAt = 0;

			await expect(
				repository.importBackup(
					inspection,
					selectAll(inspection, {mode: 'replace'}),
					{
						signal: controller.signal,
						onProgress(progress) {
							if (!when(progress)) {
								return;
							}

							abortedAt ||= performance.now();
							controller.abort();
						},
					},
				),
			).rejects.toThrow(/abort/i);

			expect(abortedAt).toBeGreaterThan(0);
			expect(performance.now() - abortedAt).toBeLessThan(1000);
			expect(await librarySnapshot(repository)).toStrictEqual(before);
		});

		it('writes nothing when cancelled while validating', async () => {
			const {blob} = await exportedBackup();
			const {repository, probeImage} = await adapter.create();
			const controller = new AbortController();
			// A decode that never ends must not delay the cancel.
			probeImage.mockImplementationOnce(async () => {
				controller.abort();
				return new Promise<never>(() => {});
			});

			await expect(
				repository.inspectBackup(blob, {signal: controller.signal}),
			).rejects.toThrow(/abort/i);
			expect(await repository.getSourceSizes()).toStrictEqual({});
		});

		it.each<[string, (blob: Blob) => Promise<Blob>, string]>([
			[
				'a corrupt ZIP',
				async (blob) => blob.slice(0, blob.size - 100),
				'the file is damaged or not a valid ZIP archive.',
			],
			[
				'a tampered source byte',
				async (blob) =>
					editedBackup(blob, (files) => {
						const path = Object.keys(files).find((name) =>
							name.startsWith('sources/'),
						)!;
						files[path][0] = (files[path][0] + 1) % 256;
					}),
				'image data is damaged',
			],
			[
				'a newer backup version',
				async (blob) =>
					editedBackup(blob, (_, json) => {
						json('manifest.json', (value) => {
							value.backupVersion = 2;
						});
					}),
				'format version 2 is newer than this app supports. Update the app and try again.',
			],
			[
				'a missing manifest',
				async (blob) =>
					editedBackup(blob, (files) => {
						delete files['manifest.json'];
					}),
				'missing or invalid manifest.',
			],
		])(
			'refuses %s and writes nothing (AC-F17.7)',
			async (_, damage, message) => {
				const {blob} = await exportedBackup();
				const {repository} = await adapter.create();
				await seedLocal(repository);
				const before = await librarySnapshot(repository);

				const error: unknown = await repository
					.inspectBackup(await damage(blob))
					.catch((error: unknown) => error);

				expect(error).toBeInstanceOf(BackupError);
				expect((error as BackupError).message).toContain(
					`${PREFIX} ${message}`,
				);
				expect(await librarySnapshot(repository)).toStrictEqual(before);
			},
		);

		it('refuses an image that does not decode', async () => {
			const {blob} = await exportedBackup();
			const {repository, probeImage} = await adapter.create();
			probeImage.mockResolvedValueOnce({
				ok: false,
				error: {code: 'too-large', message: 'Image too large'},
			});

			await expect(repository.inspectBackup(blob)).rejects.toThrow(
				`${PREFIX} embedded image is unreadable or exceeds 16,384 px.`,
			);
		});

		it('refuses a declared size that differs from the stored source', async () => {
			const {repository, probeImage} = await adapter.create();
			await seedLibrary(repository);
			const {blob} = await repository.exportBackup();
			const taller = (record: Record<string, unknown>) => {
				record.sourceHeight = 301;
			};

			const edited = await editedBackup(blob, (files, json) => {
				for (const path of Object.keys(files)) {
					if (path.endsWith('/project.json')) {
						json(path, taller);
					}
				}

				json('manifest.json', (value) => {
					const {sources, projects} = value as {
						sources: Array<{height: number}>;
						projects: Array<Record<string, unknown>>;
					};
					for (const source of sources) {
						source.height = 301;
					}

					for (const project of projects) {
						taller(project);
					}
				});
			});
			probeImage.mockClear();

			await expect(repository.inspectBackup(edited)).rejects.toThrow(
				`${PREFIX} missing or invalid manifest.`,
			);
			// Stored sources are compared, not decoded again.
			expect(probeImage).not.toHaveBeenCalled();
		});

		it('reports each stage in order', async () => {
			const {repository} = await adapter.create();
			await seedLibrary(repository);
			const progress: BackupProgress[] = [];
			const options = {
				onProgress(item: BackupProgress) {
					progress.push(item);
				},
			};

			const {blob} = await repository.exportBackup(options);
			const inspection = await repository.inspectBackup(blob, options);
			await repository.importBackup(
				inspection,
				selectAll(inspection, {mode: 'replace'}),
				options,
			);

			const stages = [...new Set(progress.map((item) => item.stage))];
			expect(stages).toStrictEqual([
				'reading',
				'packing',
				'validating',
				'importing',
			]);
			for (const stage of stages) {
				const fractions = progress
					.filter((item) => item.stage === stage)
					.map((item) => item.fraction);
				expect(fractions).toStrictEqual(fractions.toSorted((a, b) => a - b));
				expect(fractions.at(-1)).toBe(1);
			}
		});
	});
}

type Fault = {
	store: string;
	// The call to `put` that fails, counted across transactions.
	call: number;
	fail?: () => void;
};

// Makes one write of one store fail, as a full disk would.
function faultyWrites(
	database: IDBDatabase,
	{
		store: storeName,
		call,
		fail = () => {
			throw new DOMException('Simulated', 'QuotaExceededError');
		},
	}: Fault,
) {
	const original = database.transaction.bind(database);
	let calls = 0;
	database.transaction = (...args) => {
		const transaction = original(...args);
		const objectStore = transaction.objectStore.bind(transaction);
		transaction.objectStore = (name) => {
			const store = objectStore(name);
			if (name === storeName) {
				const put = store.put.bind(store);
				store.put = (...putArgs) => {
					calls++;
					if (calls === call) {
						fail();
					}

					return put(...putArgs);
				};
			}

			return store;
		};

		return transaction;
	};

	return {
		calls: () => calls,
		restore() {
			database.transaction = original;
		},
	};
}

describe('IndexedDbRepository backup import', () => {
	it.each<[string, Fault, 'merge' | 'replace']>([
		['the second image', {store: 'sources', call: 2}, 'merge'],
		['the second image', {store: 'sources', call: 2}, 'replace'],
		['a project', {store: 'projects', call: 2}, 'replace'],
		['a history entry', {store: 'history', call: 3}, 'merge'],
		['a history entry', {store: 'history', call: 3}, 'replace'],
		['a thumbnail', {store: 'thumbnails', call: 1}, 'replace'],
		['a preset', {store: 'presets', call: 2}, 'replace'],
		['the settings', {store: 'meta', call: 1}, 'replace'],
	])(
		'leaves no trace of a quota error on %s (%o, %s) (AC-F17.6)',
		async (_, fault, mode) => {
			const {blob} = await exportedBackup();
			const {database, repository} = await indexedDbSetup();
			await seedLocal(repository);
			const inspection = await repository.inspectBackup(blob);
			const before = await librarySnapshot(repository);
			const faulty = faultyWrites(database, fault);

			await expect(
				repository.importBackup(inspection, selectAll(inspection, {mode})),
			).rejects.toThrow(StorageQuotaError);

			expect(faulty.calls()).toBeGreaterThanOrEqual(fault.call);
			faulty.restore();
			expect(await librarySnapshot(repository)).toStrictEqual(before);
			expect(await allRecords(database, 'sources')).toHaveLength(1);
		},
	);

	it.each<[string, Omit<Fault, 'fail'>]>([
		['history', {store: 'history', call: 2}],
		['the last preset', {store: 'presets', call: 2}],
		['the settings', {store: 'meta', call: 1}],
	])('undoes an import cancelled while writing %s', async (_, fault) => {
		const {blob} = await exportedBackup();
		const {database, repository} = await indexedDbSetup();
		await seedLocal(repository);
		const inspection = await repository.inspectBackup(blob);
		const before = await librarySnapshot(repository);
		const controller = new AbortController();
		const faulty = faultyWrites(database, {
			...fault,
			fail() {
				controller.abort();
			},
		});

		await expect(
			repository.importBackup(
				inspection,
				selectAll(inspection, {mode: 'replace'}),
				{signal: controller.signal},
			),
		).rejects.toThrow(expect.objectContaining({name: 'AbortError'}) as Error);

		faulty.restore();
		expect(await librarySnapshot(repository)).toStrictEqual(before);
	});

	it('undoes an import cancelled while an image is being stored', async () => {
		const {blob} = await exportedBackup();
		const {database, repository} = await indexedDbSetup();
		const inspection = await repository.inspectBackup(blob);
		const controller = new AbortController();
		const faulty = faultyWrites(database, {
			store: 'sources',
			call: 2,
			fail() {
				controller.abort();
			},
		});

		await expect(
			repository.importBackup(inspection, selectAll(inspection), {
				signal: controller.signal,
			}),
		).rejects.toThrow(/abort/i);

		faulty.restore();
		expect(await repository.getSourceSizes()).toStrictEqual({});
		expect(await repository.listProjects()).toStrictEqual([]);
	});

	it('checks the quota for the missing images only, before writing', async () => {
		const {blob} = await exportedBackup();
		let usage = 0;
		const {repository} = await indexedDbSetup({
			storageManager: {estimate: async () => ({usage, quota: 10_000_000})},
		});
		await addProject(repository, 'Shared');
		const inspection = await repository.inspectBackup(blob);
		const before = await librarySnapshot(repository);
		// Room for less than 1.15 times the one missing image.
		usage = 10_000_000 - OTHER_BYTES.length;

		await expect(
			repository.importBackup(inspection, selectAll(inspection)),
		).rejects.toThrow(StorageQuotaError);
		expect(await librarySnapshot(repository)).toStrictEqual(before);

		usage = 10_000_000 - Math.ceil(OTHER_BYTES.length * 1.15);
		await repository.importBackup(inspection, selectAll(inspection));
		expect(await repository.listProjects()).toHaveLength(4);
	});

	it('stores again a staged image that a cleanup removed before the commit', async () => {
		const {blob} = await exportedBackup();
		const {repository} = await indexedDbSetup();
		const inspection = await repository.inspectBackup(blob);
		let cleanup: Promise<number> | undefined;

		await repository.importBackup(inspection, selectAll(inspection), {
			onProgress({fraction}) {
				if (fraction === 0.9) {
					cleanup = repository.cleanupOrphanedSources();
				}
			},
		});

		expect(await cleanup).toBe(2);
		for (const project of await repository.listProjects()) {
			expect(await repository.getSource(project.sourceHash)).toBeDefined();
		}
	});

	it('decides what to write from the library at commit time', async () => {
		const {repository} = await indexedDbSetup();
		const {ids} = await seedLibrary(repository);
		const {blob} = await repository.exportBackup();
		const inspection = await repository.inspectBackup(blob);
		// Edited after the preview said "Unchanged".
		await repository.renameProject(ids.twin, 'Edited since');

		const result = await repository.importBackup(
			inspection,
			selectAll(inspection),
		);

		expect(result.projects.map((item) => item.name)).toStrictEqual([
			'Twin (imported)',
		]);
	});

	it('reports a missing source on export', async () => {
		const {repository, database} = await indexedDbSetup();
		await addProject(repository, 'Lost');
		database.transaction('sources', 'readwrite').objectStore('sources').clear();

		await expect(repository.exportBackup()).rejects.toThrow(
			"Can't export backup: the image data of Lost is missing.",
		);
	});
});

describe('backupImportSummary', () => {
	const empty = {
		mode: 'merge' as const,
		projects: [],
		skippedProjectCount: 0,
		presets: [],
		skippedPresetCount: 0,
		settings: null,
	};

	it('counts what was written', () => {
		expect(backupImportSummary(empty)).toBe('Nothing new to import.');
		expect(backupImportSummary({...empty, skippedProjectCount: 3})).toBe(
			'Nothing new to import. Skipped 3 unchanged.',
		);
		expect(backupImportSummary({...empty, projects: [{} as never]})).toBe(
			'Imported 1 project.',
		);
		expect(
			backupImportSummary({
				...empty,
				settings: {theme: 'dark', compareMode: 'toggle'},
			}),
		).toBe('Applied settings.');
	});
});
