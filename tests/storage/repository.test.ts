import {IDBFactory, IDBKeyRange as FakeKeyRange} from 'fake-indexeddb';
import {describe, expect, it} from 'vite-plus/test';
import type {EffectInstance, EffectStack} from '../../src/engine/types.ts';
import {
	IndexedDbRepository,
	MAX_HISTORY_ENTRIES,
	MemoryStorageAdapter,
	StorageNotFoundError,
	StorageQuotaError,
	StorageValidationError,
	hashBlobSha256,
	isQuotaExceededError,
	openDatabase,
	openStorage,
	type StorageRepository,
} from '../../src/storage/index.ts';

function makeBlob(seed: number, size = 1024, type = 'image/png'): Blob {
	const bytes = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		bytes[i] = (seed * 31 + i * 17) % 256;
	}

	return new Blob([bytes], {type});
}

function makeInstance(
	id: string,
	overrides: Partial<EffectInstance> = {},
): EffectInstance {
	return {
		id,
		type: 'pixelSort',
		version: 1,
		enabled: true,
		params: {angle: 90, threshold: [0.2, 0.8]},
		mix: 1,
		blend: 'normal',
		...overrides,
	};
}

function makeStack(instances: EffectInstance[]): EffectStack {
	return {
		schemaVersion: 1,
		instances,
	};
}

type AdapterFactory = {
	name: string;
	create: (now?: () => number) => Promise<StorageRepository>;
};

const adapters: AdapterFactory[] = [
	{
		name: 'IndexedDbRepository (fake-indexeddb)',
		async create(now) {
			const idb = new IDBFactory();
			const db = await openDatabase({indexedDB: idb});
			return new IndexedDbRepository(db, {now, keyRange: FakeKeyRange});
		},
	},
	{
		name: 'MemoryStorageAdapter',
		async create(now) {
			return new MemoryStorageAdapter({now});
		},
	},
];

for (const adapter of adapters) {
	describe(`StorageRepository behavioural suite: ${adapter.name}`, () => {
		it('creates, reads, lists (by openedAt desc), renames, and deletes projects', async () => {
			let clock = 1000;
			const repo = await adapter.create(() => {
				clock += 100;
				return clock;
			});

			try {
				const first = await repo.createProject({
					name: 'sunset.jpg',
					blob: makeBlob(1),
					width: 800,
					height: 600,
				});
				expect(first.deduplicated).toBe(false);
				expect(first.project.name).toBe('sunset');
				expect(first.project.historyHeadSeq).toBe(0);
				expect(first.project.historyMinSeq).toBe(0);
				expect(first.project.historyMaxSeq).toBe(0);

				const second = await repo.createProject({
					name: '  .png  ',
					blob: makeBlob(2),
					width: 1200,
					height: 900,
					setActive: false,
				});
				expect(second.project.name).toBe('.png');

				const untitled = await repo.createProject({
					name: ' '.repeat(3),
					blob: makeBlob(3),
					width: 100,
					height: 100,
					setActive: false,
				});
				expect(untitled.project.name).toBe('Untitled');

				const appState = await repo.getAppState();
				expect(appState.activeProjectId).toBe(first.project.id);

				const listed = await repo.listProjects();
				expect(listed.map((p) => p.id)).toEqual([
					untitled.project.id,
					second.project.id,
					first.project.id,
				]);

				await repo.openProject(first.project.id);
				const relisted = await repo.listProjects();
				expect(relisted[0]?.id).toBe(first.project.id);

				const renamed = await repo.renameProject(
					first.project.id,
					'  Golden Hour  ',
				);
				expect(renamed.name).toBe('Golden Hour');
				expect((await repo.getProject(first.project.id))?.name).toBe(
					'Golden Hour',
				);

				await expect(
					repo.renameProject(first.project.id, ' '.repeat(3)),
				).rejects.toThrow(StorageValidationError);
				await expect(
					repo.renameProject(first.project.id, 'a'.repeat(121)),
				).rejects.toThrow(StorageValidationError);

				const deleted = await repo.deleteProject(first.project.id);
				expect(deleted).toEqual({deleted: true, sourceDeleted: true});
				expect(await repo.getProject(first.project.id)).toBeUndefined();
				expect(await repo.hasSource(first.source.sha256)).toBe(false);
				expect((await repo.getAppState()).activeProjectId).toBeNull();
			} finally {
				repo.close();
			}
		});

		it('deduplicates identical source blobs and reference-counts on delete', async () => {
			const repo = await adapter.create();

			try {
				const blob = makeBlob(42, 4096);
				const expectedHash = await hashBlobSha256(blob);

				const first = await repo.createProject({
					name: 'photo-a.png',
					blob,
					width: 500,
					height: 500,
				});
				const second = await repo.createProject({
					name: 'photo-b.png',
					blob: makeBlob(42, 4096),
					width: 500,
					height: 500,
				});

				expect(first.deduplicated).toBe(false);
				expect(second.deduplicated).toBe(true);
				expect(first.source.sha256).toBe(expectedHash);
				expect(second.source.sha256).toBe(expectedHash);
				expect(first.project.sourceHash).toBe(second.project.sourceHash);

				const firstDelete = await repo.deleteProject(first.project.id);
				expect(firstDelete).toEqual({deleted: true, sourceDeleted: false});
				expect(await repo.hasSource(expectedHash)).toBe(true);

				const secondDelete = await repo.deleteProject(second.project.id);
				expect(secondDelete).toEqual({deleted: true, sourceDeleted: true});
				expect(await repo.hasSource(expectedHash)).toBe(false);
				expect(await repo.getSource(expectedHash)).toBeUndefined();
			} finally {
				repo.close();
			}
		});

		it('duplicates a project with shared source, copied history and thumbnail, and isolated edits', async () => {
			const repo = await adapter.create();

			try {
				const {project} = await repo.createProject({
					name: 'Original',
					blob: makeBlob(7),
					width: 640,
					height: 480,
				});

				const inst = makeInstance('inst0001');
				await repo.commitStack({
					projectId: project.id,
					stack: makeStack([inst]),
					selectedInstanceId: inst.id,
					label: 'Add Pixel sort',
				});
				await repo.updateViewState(project.id, {
					fitMode: 'custom',
					zoom: 2.5,
					centerX: 100,
					centerY: 120,
					splitPosition: 0.75,
				});
				await repo.putThumbnail({
					projectId: project.id,
					blob: makeBlob(9, 256, 'image/webp'),
					width: 320,
					height: 240,
					stackSignature: 'sig-1',
					updatedAt: Date.now(),
				});

				const copy = await repo.duplicateProject(project.id);
				expect(copy.id).not.toBe(project.id);
				expect(copy.name).toBe('Original copy');
				expect(copy.sourceHash).toBe(project.sourceHash);
				expect(copy.viewState.fitMode).toBe('fit');
				expect(copy.viewState.zoom).toBe(1);
				expect(copy.stack.instances).toHaveLength(1);
				expect(copy.historyHeadSeq).toBe(1);

				const copyHistory = await repo.getHistory(copy.id);
				expect(copyHistory).toHaveLength(2);
				expect(copyHistory.every((row) => row.projectId === copy.id)).toBe(
					true,
				);

				const copyThumb = await repo.getThumbnail(copy.id);
				expect(copyThumb?.stackSignature).toBe('sig-1');

				await repo.commitStack({
					projectId: copy.id,
					stack: makeStack([]),
					selectedInstanceId: null,
					label: 'Clear stack',
				});
				expect(
					(await repo.getProject(project.id))?.stack.instances,
				).toHaveLength(1);

				const delOriginal = await repo.deleteProject(project.id);
				expect(delOriginal.sourceDeleted).toBe(false);
				expect(await repo.hasSource(project.sourceHash)).toBe(true);
			} finally {
				repo.close();
			}
		});

		it('enforces the 201-entry history cap (205 commits -> 200 undos possible, 201st is not)', async () => {
			const repo = await adapter.create();

			try {
				const {project} = await repo.createProject({
					name: 'HistoryCap',
					blob: makeBlob(11),
					width: 400,
					height: 300,
				});

				for (let i = 1; i <= 205; i++) {
					await repo.commitStack({
						projectId: project.id,
						stack: makeStack([
							makeInstance('inst0001', {params: {angle: i % 360}}),
						]),
						selectedInstanceId: 'inst0001',
						label: `Commit ${i}`,
					});
				}

				const afterCommits = await repo.getProject(project.id);
				expect(afterCommits?.historyHeadSeq).toBe(205);
				expect(afterCommits?.historyMinSeq).toBe(5);
				expect(afterCommits?.historyMaxSeq).toBe(205);

				const history = await repo.getHistory(project.id);
				expect(history).toHaveLength(MAX_HISTORY_ENTRIES);
				expect(history[0]?.seq).toBe(5);
				expect(history.at(-1)?.seq).toBe(205);
				expect(await repo.getHistoryEntry(project.id, 4)).toBeUndefined();

				let undoCount = 0;
				while ((await repo.undo(project.id)) !== null) {
					undoCount++;
				}

				expect(undoCount).toBe(200);
				expect(await repo.undo(project.id)).toBeNull();
				expect((await repo.getProject(project.id))?.historyHeadSeq).toBe(5);
			} finally {
				repo.close();
			}
		});

		it('supports undo, redo, discarding redo branch, and leaves viewState intact', async () => {
			const repo = await adapter.create();

			try {
				const {project} = await repo.createProject({
					name: 'UndoRedo',
					blob: makeBlob(12),
					width: 500,
					height: 400,
				});

				const customView = {
					fitMode: 'custom' as const,
					zoom: 2,
					centerX: 250,
					centerY: 200,
					splitPosition: 0.3,
				};
				await repo.updateViewState(project.id, customView);

				await repo.commitStack({
					projectId: project.id,
					stack: makeStack([makeInstance('a0000001', {params: {angle: 45}})]),
					selectedInstanceId: 'a0000001',
					label: 'Set 45',
				});
				await repo.commitStack({
					projectId: project.id,
					stack: makeStack([makeInstance('a0000001', {params: {angle: 90}})]),
					selectedInstanceId: 'a0000001',
					label: 'Set 90',
				});

				const undone = await repo.undo(project.id);
				expect(undone?.entry.seq).toBe(1);
				expect(undone?.project.stack.instances[0]?.params.angle).toBe(45);
				expect(undone?.project.viewState).toEqual(customView);

				const redone = await repo.redo(project.id);
				expect(redone?.entry.seq).toBe(2);
				expect(redone?.project.stack.instances[0]?.params.angle).toBe(90);

				await repo.undo(project.id);
				await repo.commitStack({
					projectId: project.id,
					stack: makeStack([makeInstance('a0000001', {params: {angle: 180}})]),
					selectedInstanceId: 'a0000001',
					label: 'Branch 180',
				});

				expect(await repo.redo(project.id)).toBeNull();
				const entries = await repo.getHistory(project.id);
				expect(entries.map((entry) => entry.label)).toEqual([
					'Initial',
					'Set 45',
					'Branch 180',
				]);
			} finally {
				repo.close();
			}
		});

		it('preserves unknown effect types and unknown fields through save and load', async () => {
			const repo = await adapter.create();

			try {
				const {project} = await repo.createProject({
					name: 'FutureCompat',
					blob: makeBlob(15),
					width: 400,
					height: 400,
				});

				const unknownInstance = {
					id: 'fut00001',
					type: 'futureQuantumGlitch',
					version: 9,
					enabled: true,
					params: {flux: 0.42, mode: 'hyper'},
					mix: 0.75,
					blend: 'difference',
					maskId: 'mask-future-1',
					extraNested: {tag: 'keep-me'},
				} as unknown as EffectInstance;

				const futureStack = {
					schemaVersion: 2,
					futureHeader: 'preserve-this',
					instances: [unknownInstance],
				} as unknown as EffectStack;

				await repo.commitStack({
					projectId: project.id,
					stack: futureStack,
					selectedInstanceId: 'fut00001',
					label: 'Future edit',
				});

				await repo.renameProject(project.id, 'FutureCompat Renamed');
				const loaded = await repo.getProject(project.id);
				expect(loaded?.stack).toEqual(futureStack);

				const historyEntry = await repo.getHistoryEntry(project.id, 1);
				expect(historyEntry?.stack).toEqual(futureStack);
			} finally {
				repo.close();
			}
		});

		it('manages presets, export settings, viewState clamping, and startup snapshot', async () => {
			const repo = await adapter.create();

			try {
				const {project} = await repo.createProject({
					name: 'SettingsTest',
					blob: makeBlob(21),
					width: 1000,
					height: 800,
				});

				const clampedView = await repo.updateViewState(project.id, {
					fitMode: 'custom',
					zoom: 999,
					centerX: 10,
					centerY: 20,
					splitPosition: -0.5,
				});
				expect(clampedView.viewState.zoom).toBe(32);
				expect(clampedView.viewState.splitPosition).toBe(0);

				const clampedExport = await repo.updateExportSettings(project.id, {
					format: 'jpeg',
					quality: 120.4,
					sizeMode: 'half',
					customLongestSide: null,
				});
				expect(clampedExport.exportSettings.quality).toBe(100);

				const pB = await repo.createPreset({
					name: 'Zebra',
					stack: makeStack([makeInstance('p0000001')]),
				});
				const pA = await repo.createPreset({
					name: '  alpha  ',
					stack: makeStack([]),
				});
				expect(pA.id.startsWith('user:')).toBe(true);
				expect(pA.name).toBe('alpha');

				const presets = await repo.listPresets();
				expect(presets.map((p) => p.name)).toEqual(['alpha', 'Zebra']);

				const renamedPreset = await repo.renamePreset(pB.id, 'Beta');
				expect(renamedPreset.nameLower).toBe('beta');

				await repo.updateAppState({theme: 'dark', compareMode: 'split'});
				const snapshot = await repo.getStartupSnapshot();
				expect(snapshot.appState.theme).toBe('dark');
				expect(snapshot.appState.compareMode).toBe('split');
				expect(snapshot.projects).toHaveLength(1);
				expect(snapshot.presets.map((p) => p.name)).toEqual(['alpha', 'Beta']);

				expect(await repo.deletePreset(pA.id)).toBe(true);
				expect(await repo.deletePreset('user:missing')).toBe(false);
				await expect(repo.renamePreset('user:missing', 'X')).rejects.toThrow(
					StorageNotFoundError,
				);
			} finally {
				repo.close();
			}
		});
	});
}

describe('IndexedDbRepository durability and failure paths', () => {
	it('persists undo and redo pointers across a simulated restart (close and reopen)', async () => {
		const idb = new IDBFactory();
		const db1 = await openDatabase({indexedDB: idb});
		const repo1 = new IndexedDbRepository(db1, {keyRange: FakeKeyRange});

		const {project} = await repo1.createProject({
			name: 'RestartTest.png',
			blob: makeBlob(99, 2048),
			width: 600,
			height: 400,
		});
		await repo1.commitStack({
			projectId: project.id,
			stack: makeStack([makeInstance('r0000001', {params: {angle: 15}})]),
			selectedInstanceId: 'r0000001',
			label: 'Angle 15',
		});
		await repo1.commitStack({
			projectId: project.id,
			stack: makeStack([makeInstance('r0000001', {params: {angle: 30}})]),
			selectedInstanceId: 'r0000001',
			label: 'Angle 30',
		});
		await repo1.undo(project.id);
		repo1.close();

		const db2 = await openDatabase({indexedDB: idb});
		const repo2 = new IndexedDbRepository(db2, {keyRange: FakeKeyRange});
		try {
			const restored = await repo2.getProject(project.id);
			expect(restored?.historyHeadSeq).toBe(1);
			expect(restored?.historyMinSeq).toBe(0);
			expect(restored?.historyMaxSeq).toBe(2);
			expect(restored?.stack.instances[0]?.params.angle).toBe(15);

			const redone = await repo2.redo(project.id);
			expect(redone?.entry.seq).toBe(2);
			expect(redone?.project.stack.instances[0]?.params.angle).toBe(30);

			const undoneTwice1 = await repo2.undo(project.id);
			expect(undoneTwice1?.entry.seq).toBe(1);
			const undoneTwice2 = await repo2.undo(project.id);
			expect(undoneTwice2?.entry.seq).toBe(0);
			expect(undoneTwice2?.project.stack.instances).toEqual([]);
		} finally {
			repo2.close();
		}
	});

	it('rolls back cleanly on mid-write QuotaExceededError and leaves prior state intact', async () => {
		const idb = new IDBFactory();
		const db = await openDatabase({indexedDB: idb});
		const repo = new IndexedDbRepository(db, {keyRange: FakeKeyRange});

		try {
			const {project} = await repo.createProject({
				name: 'QuotaRollback',
				blob: makeBlob(5),
				width: 400,
				height: 300,
			});
			await repo.commitStack({
				projectId: project.id,
				stack: makeStack([makeInstance('q0000001', {params: {angle: 10}})]),
				selectedInstanceId: 'q0000001',
				label: 'Good commit',
			});

			const originalTransaction = db.transaction.bind(db);
			const patchedDb = db as IDBDatabase & {
				transaction: IDBDatabase['transaction'];
			};
			patchedDb.transaction = ((
				storeNames: string | Iterable<string>,
				mode?: IDBTransactionMode,
				options?: IDBTransactionOptions,
			) => {
				const tx = originalTransaction(storeNames, mode, options);
				const originalObjectStore = tx.objectStore.bind(tx);
				tx.objectStore = (name: string) => {
					const store = originalObjectStore(name);
					if (name === 'projects' && mode === 'readwrite') {
						store.put = () => {
							throw new DOMException(
								'Simulated quota full',
								'QuotaExceededError',
							);
						};
					}

					return store;
				};

				return tx;
			}) as IDBDatabase['transaction'];

			let caught: unknown;
			try {
				await repo.commitStack({
					projectId: project.id,
					stack: makeStack([makeInstance('q0000001', {params: {angle: 99}})]),
					selectedInstanceId: 'q0000001',
					label: 'Doomed commit',
				});
			} catch (error) {
				caught = error;
			} finally {
				patchedDb.transaction = originalTransaction;
			}

			expect(caught).toBeInstanceOf(StorageQuotaError);
			expect(isQuotaExceededError(caught)).toBe(true);

			const intact = await repo.getProject(project.id);
			expect(intact?.historyHeadSeq).toBe(1);
			expect(intact?.historyMaxSeq).toBe(1);
			expect(intact?.stack.instances[0]?.params.angle).toBe(10);

			const history = await repo.getHistory(project.id);
			expect(history).toHaveLength(2);
			expect(history.at(-1)?.label).toBe('Good commit');
		} finally {
			repo.close();
		}
	});

	it('rejects import before write when pre-flight quota check fails', async () => {
		const idb = new IDBFactory();
		const db = await openDatabase({indexedDB: idb});
		const repo = new IndexedDbRepository(db, {
			storageManager: {
				async estimate() {
					return {usage: 9_900_000, quota: 10_000_000};
				},
			},
		});

		try {
			await expect(
				repo.createProject({
					name: 'TooBig.png',
					blob: makeBlob(3, 200_000),
					width: 100,
					height: 100,
				}),
			).rejects.toThrow(StorageQuotaError);

			expect(await repo.listProjects()).toEqual([]);
		} finally {
			repo.close();
		}
	});

	it('cleans up orphaned sources without touching referenced ones', async () => {
		const idb = new IDBFactory();
		const db = await openDatabase({indexedDB: idb});
		const repo = new IndexedDbRepository(db, {keyRange: FakeKeyRange});

		try {
			const {project} = await repo.createProject({
				name: 'Referenced.png',
				blob: makeBlob(1),
				width: 100,
				height: 100,
			});

			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('sources', 'readwrite');
				tx.objectStore('sources').put({
					sha256: '0'.repeat(64),
					blob: makeBlob(2),
					mimeType: 'image/png',
					byteLength: 1024,
					width: 100,
					height: 100,
					createdAt: Date.now(),
				});
				tx.addEventListener('complete', () => resolve());
				tx.addEventListener('error', () =>
					reject(tx.error ?? new Error('Transaction failed')),
				);
			});

			expect(await repo.hasSource('0'.repeat(64))).toBe(true);
			const removed = await repo.cleanupOrphanedSources();
			expect(removed).toBe(1);
			expect(await repo.hasSource('0'.repeat(64))).toBe(false);
			expect(await repo.hasSource(project.sourceHash)).toBe(true);
		} finally {
			repo.close();
		}
	});

	it('falls back to MemoryStorageAdapter when IndexedDB open fails with a non-VersionError', async () => {
		const brokenFactory = {
			open() {
				throw new DOMException('Blocked by policy', 'SecurityError');
			},
		} as unknown as IDBFactory;

		const opened = await openStorage({indexedDB: brokenFactory});
		expect(opened.persistence).toBe('memory');
		expect(opened.storageUnavailable).toBe(true);

		const created = await opened.repository.createProject({
			name: 'Ephemeral.png',
			blob: makeBlob(8),
			width: 200,
			height: 200,
		});
		expect(created.project.name).toBe('Ephemeral');
		opened.repository.close();
	});
});
