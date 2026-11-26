import {
	IDBCursor,
	IDBFactory,
	IDBKeyRange as FakeKeyRange,
} from 'fake-indexeddb';
import {describe, expect, it, vi} from 'vite-plus/test';
import {IDENTITY_TRANSFORM} from '../../src/engine/transform.ts';
import type {EffectStack} from '../../src/engine/types.ts';
import {
	DB_VERSION,
	IndexedDbRepository,
	dbMigrations,
	openDatabase,
	openStorage,
	type DbMigration,
	type HistoryEntryRecord,
	type ProjectRecord,
} from '../../src/storage/index.ts';
import {allRecords, putRecords, settle} from './idb-helpers.ts';
import {CROPPED, instance, stackOf} from './project-fixtures.ts';

const NAME = 'drift-v2-fixture';
const STORES = [
	'sources',
	'projects',
	'history',
	'thumbnails',
	'presets',
	'meta',
];

const hash = (digit: string) => digit.repeat(64);
// Primary sources.
const FIRST = hash('a');
const SECOND = hash('b');
// Extra sources, named by where the only reference to each is.
const IN_STACK = hash('c');
const IN_SIDE_A = hash('d');
const IN_UNDO = hash('e');
const IN_REDO = hash('f');
const IN_OLD_SIDE_A = hash('1');
const ORPHAN = hash('0');

function blend(id: string, image: string): EffectStack {
	return stackOf(
		instance({
			id,
			type: 'imageBlend',
			params: {image, blendMode: 'difference', opacity: 0.5},
		}),
	);
}

// A project record as version 2 wrote it: geometry, but no references.
function v2Project(
	id: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id,
		name: id,
		sourceHash: FIRST,
		sourceWidth: 400,
		sourceHeight: 300,
		transform: IDENTITY_TRANSFORM,
		effectiveWidth: 400,
		effectiveHeight: 300,
		stack: stackOf(),
		selectedInstanceId: null,
		historyHeadSeq: 0,
		historyMinSeq: 0,
		historyMaxSeq: 0,
		viewState: {
			fitMode: 'custom',
			zoom: 2,
			centerX: 10,
			centerY: 20,
			splitPosition: 0.4,
			splitOrientation: 'horizontal',
			editSide: 'a',
		},
		exportSettings: {
			format: 'jpeg',
			quality: 70,
			sizeMode: 'half',
			customLongestSide: null,
			maxFileSizeKb: 200,
		},
		createdAt: 1,
		updatedAt: 2,
		openedAt: 3,
		...overrides,
	};
}

function v2Entry(
	projectId: string,
	seq: number,
	stack: EffectStack,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		projectId,
		seq,
		label: seq === 0 ? 'Initial' : `Step ${seq}`,
		stack,
		selectedInstanceId: stack.instances[0]?.id ?? null,
		transform: IDENTITY_TRANSFORM,
		createdAt: 100 + seq,
		...overrides,
	};
}

const projects = [
	v2Project('plain', {sourceHash: SECOND}),
	// Undone by one step, cropped and turned, with side A.
	v2Project('blended', {
		transform: CROPPED,
		effectiveWidth: 100,
		effectiveHeight: 200,
		stack: blend('b1', IN_STACK),
		selectedInstanceId: 'b1',
		stackA: blend('a1', IN_SIDE_A),
		selectedInstanceIdA: 'a1',
		historyHeadSeq: 2,
		historyMaxSeq: 3,
	}),
	// Uses another project's primary source as its extra image.
	v2Project('twin', {stack: blend('t1', SECOND)}),
];

const history = [
	v2Entry('plain', 0, stackOf()),
	v2Entry('blended', 0, stackOf(), {stackA: blend('a0', IN_OLD_SIDE_A)}),
	v2Entry('blended', 1, blend('b0', IN_UNDO)),
	v2Entry('blended', 2, blend('b1', IN_STACK), {
		transform: CROPPED,
		stackA: blend('a1', IN_SIDE_A),
		selectedInstanceIdA: 'a1',
	}),
	v2Entry('blended', 3, blend('b2', IN_REDO), {transform: CROPPED}),
	v2Entry('twin', 0, blend('t1', SECOND)),
];

// Distinct bytes per source, to see that each survives unchanged.
const sourceHashes = [
	FIRST,
	SECOND,
	IN_STACK,
	IN_SIDE_A,
	IN_UNDO,
	IN_REDO,
	IN_OLD_SIDE_A,
	ORPHAN,
];
const bytesFor = (index: number) => new Uint8Array([index, 1, 2, 3, index]);
const thumbnails = ['blended', 'plain'].map((projectId, index) => ({
	projectId,
	blob: new Blob([bytesFor(index + 20)], {type: 'image/webp'}),
	width: 200,
	height: 150,
	stackSignature: `v2-signature-${projectId}`,
	updatedAt: 50,
}));
const preset = {
	id: 'user:one',
	name: 'Mine',
	nameLower: 'mine',
	stack: stackOf(instance()),
	createdAt: 5,
	updatedAt: 5,
};
const appState = {
	key: 'appState',
	activeProjectId: 'blended',
	theme: 'dark',
	compareMode: 'split',
	welcomeDismissed: true,
};

const references: Record<string, string[]> = {
	plain: [SECOND],
	blended: [
		FIRST,
		IN_STACK,
		IN_SIDE_A,
		IN_UNDO,
		IN_REDO,
		IN_OLD_SIDE_A,
	].toSorted(),
	twin: [FIRST, SECOND],
};

async function createV2Database(
	idb: IDBFactory,
	records: {projects?: unknown[]} = {},
): Promise<void> {
	const database = await openDatabase({
		indexedDB: idb,
		name: NAME,
		version: 2,
	});
	await putRecords(
		database,
		'sources',
		sourceHashes.map((sha256, index) => ({
			sha256,
			blob: new Blob([bytesFor(index)], {type: 'image/png'}),
			mimeType: 'image/png',
			byteLength: 5,
			width: 400,
			height: 300,
			createdAt: 1,
		})),
	);
	await putRecords(database, 'projects', records.projects ?? projects);
	await putRecords(database, 'history', history);
	await putRecords(database, 'thumbnails', thumbnails);
	await putRecords(database, 'presets', [preset]);
	await putRecords(database, 'meta', [appState]);
	database.close();
}

// Every record, with blobs as bytes so two dumps compare.
async function dump(database: IDBDatabase) {
	const stores: Record<string, unknown[]> = {};
	for (const name of STORES) {
		const records = await allRecords<Record<string, unknown>>(database, name);
		stores[name] = await Promise.all(
			records.map(async (record) =>
				record.blob instanceof Blob
					? {
							...record,
							blob: {
								type: record.blob.type,
								bytes: new Uint8Array(await record.blob.arrayBuffer()),
							},
						}
					: record,
			),
		);
	}

	return stores;
}

async function dumpV2(idb: IDBFactory) {
	const database = await openDatabase({
		indexedDB: idb,
		name: NAME,
		version: 2,
	});
	const result = {
		version: database.version,
		indexes: [
			...database.transaction('projects').objectStore('projects').indexNames,
		],
		stores: await dump(database),
	};
	database.close();
	return result;
}

async function upgrade(idb: IDBFactory) {
	const database = await openDatabase({indexedDB: idb, name: NAME});
	const repository = new IndexedDbRepository(database, {
		keyRange: FakeKeyRange,
	});
	return {database, repository};
}

describe('database upgrade from version 2 to 3 (persistence.md section 8.5)', () => {
	it('adds references to every project and keeps all other data', async () => {
		const idb = new IDBFactory();
		await createV2Database(idb);
		const before = await dumpV2(idb);
		expect(before.indexes).not.toContain('byReferencedSourceHash');

		const {database, repository} = await upgrade(idb);

		expect(DB_VERSION).toBe(3);
		expect(database.version).toBe(3);
		const after = await dump(database);
		for (const name of ['sources', 'history', 'thumbnails', 'presets']) {
			expect(after[name]).toStrictEqual(before.stores[name]);
		}

		expect(after.projects).toStrictEqual(
			(before.stores.projects as ProjectRecord[]).map((record) => ({
				...record,
				referencedSourceHashes: references[record.id],
			})),
		);
		expect(await repository.getSchemaInfo()).toMatchObject({dbVersion: 3});
		expect(await repository.getAppState()).toStrictEqual(appState);

		const index = database
			.transaction('projects')
			.objectStore('projects')
			.index('byReferencedSourceHash');
		expect(index.multiEntry).toBe(true);
		expect(await settle(index.count(SECOND))).toBe(2);
		expect(await settle(index.count(IN_REDO))).toBe(1);
		expect(await settle(index.count(ORPHAN))).toBe(0);
		repository.close();
	});

	it('keeps every backfilled source through cleanup, redo and delete', async () => {
		const idb = new IDBFactory();
		await createV2Database(idb);
		const {repository} = await upgrade(idb);

		expect(await repository.cleanupOrphanedSources()).toBe(1);
		expect(await repository.hasSource(ORPHAN)).toBe(false);

		const redone = await repository.redo('blended');
		expect(redone?.project.stack).toStrictEqual(blend('b2', IN_REDO));
		const committed = await repository.commitStack({
			projectId: 'blended',
			stack: stackOf(),
			selectedInstanceId: null,
			label: 'Remove Image blend',
		});
		expect(committed.project.referencedSourceHashes).toStrictEqual(
			references.blended,
		);

		await repository.deleteProject('plain');
		expect(await repository.hasSource(SECOND)).toBe(true);
		await repository.deleteProject('blended');
		expect(await repository.hasSource(FIRST)).toBe(true);
		expect(await repository.hasSource(IN_UNDO)).toBe(false);
		await repository.deleteProject('twin');
		expect(await repository.getSourceSizes()).toStrictEqual({});
		repository.close();
	});

	it.each<[string, () => Readonly<Record<number, DbMigration>>]>([
		[
			'fails after rewriting every project',
			() => ({
				...dbMigrations,
				2(database, transaction) {
					const step = dbMigrations[2](database, transaction)!;
					return () => {
						step(() => {
							throw new Error('Injected failure');
						});
					};
				},
			}),
		],
		[
			'runs out of space on the second project',
			() => {
				const {update} = IDBCursor.prototype;
				let calls = 0;
				vi.spyOn(IDBCursor.prototype, 'update').mockImplementation(function (
					this: IDBCursor,
					value,
				) {
					calls++;
					if (calls === 2) {
						throw new DOMException('Full', 'QuotaExceededError');
					}

					return update.call(this, value);
				});
				return dbMigrations;
			},
		],
	])('leaves version 2 intact when the upgrade %s', async (_name, broken) => {
		const idb = new IDBFactory();
		await createV2Database(idb);
		const before = await dumpV2(idb);
		try {
			await expect(
				openDatabase({indexedDB: idb, name: NAME, migrations: broken()}),
			).rejects.toThrow(/abort/i);
		} finally {
			vi.restoreAllMocks();
		}

		expect(await dumpV2(idb)).toStrictEqual(before);

		const {database, repository} = await upgrade(idb);
		expect(database.version).toBe(3);
		expect(
			(await repository.getProject('blended'))?.referencedSourceHashes,
		).toStrictEqual(references.blended);
		repository.close();
	});

	it('upgrades a project whose stored stacks are damaged', async () => {
		const idb = new IDBFactory();
		await createV2Database(idb, {
			projects: [
				v2Project('damaged', {
					stack: {schemaVersion: 1},
					stackA: {schemaVersion: 1, instances: [null, {id: 'x'}]},
				}),
			],
		});

		const {database, repository} = await upgrade(idb);

		expect(database.version).toBe(3);
		const [project] = await allRecords<ProjectRecord>(database, 'projects');
		expect(project.referencedSourceHashes).toStrictEqual([FIRST]);
		const entries = await allRecords<HistoryEntryRecord>(database, 'history');
		expect(entries).toHaveLength(history.length);
		repository.close();
	});

	it('starts a migration only when the one before has rewritten its records', async () => {
		const order: string[] = [];

		const database = await openDatabase({
			indexedDB: new IDBFactory(),
			name: NAME,
			version: 3,
			migrations: {
				0: dbMigrations[0],
				1: (_database, transaction) => (done) => {
					const request = transaction.objectStore('meta').count();
					request.addEventListener('success', () => {
						order.push('first finished');
						done();
					});
				},
				2() {
					order.push('second started');
					return undefined;
				},
			},
		});

		expect(order).toStrictEqual(['first finished', 'second started']);
		expect(await allRecords(database, 'meta')).toMatchObject([
			{key: 'schemaInfo', dbVersion: 3},
		]);
		database.close();
	});

	it('creates a fresh database with the reference index', async () => {
		const idb = new IDBFactory();
		const opened = await openStorage({indexedDB: idb});
		expect(opened.persistence).toBe('indexeddb');
		const created = await opened.repository.createProject({
			name: 'New.png',
			blob: new Blob([bytesFor(1)], {type: 'image/png'}),
			width: 40,
			height: 30,
		});
		expect(created.project.referencedSourceHashes).toStrictEqual([
			created.source.sha256,
		]);
		expect(await opened.repository.cleanupOrphanedSources()).toBe(0);
		opened.repository.close();
	});
});
