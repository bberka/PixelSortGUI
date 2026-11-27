import {
	IDBCursor,
	IDBFactory,
	IDBKeyRange as FakeKeyRange,
} from 'fake-indexeddb';
import {describe, expect, it, vi} from 'vite-plus/test';
import type {InstanceMask} from '../../src/engine/mask/types.ts';
import type {EffectStack} from '../../src/engine/types.ts';
import {
	IndexedDbRepository,
	dbMigrations,
	openDatabase,
	openStorage,
	type DbMigration,
	type ProjectRecord,
} from '../../src/storage/index.ts';
import {allRecords, putRecords, settle} from './idb-helpers.ts';
import {instance, stackOf} from './project-fixtures.ts';

const NAME = 'drift-v3-fixture';
const STORES = [
	'sources',
	'projects',
	'history',
	'thumbnails',
	'presets',
	'meta',
];

const hash = (digit: string) => digit.repeat(64);
const PRIMARY = hash('a');
// Painted masks, named by where the only reference to each is.
const IN_STACK = hash('b');
const IN_SIDE_A = hash('c');
const IN_UNDO = hash('d');
const IN_REDO = hash('e');
// The image of an image mask, which version 3 did not count.
const MASK_IMAGE = hash('f');

function masked(id: string, mask: InstanceMask): EffectStack {
	return {schemaVersion: 2, instances: [instance({id, mask})]};
}

const paint = (id: string, asset: string) =>
	masked(id, {kind: 'paint', asset, invert: false, feather: 0});

const imageMask = masked('image', {
	kind: 'image',
	source: MASK_IMAGE,
	fit: 'stretch',
	invert: false,
	feather: 0,
});

// A 4000 × 3000 px project as version 3 wrote it (AC-F29.17).
function v3Project(
	id: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id,
		name: id,
		sourceHash: PRIMARY,
		referencedSourceHashes: [PRIMARY],
		sourceWidth: 4000,
		sourceHeight: 3000,
		transform: {
			rotation: 0,
			flipX: false,
			flipY: false,
			crop: null,
			resize: null,
		},
		effectiveWidth: 4000,
		effectiveHeight: 3000,
		stack: stackOf(),
		selectedInstanceId: null,
		historyHeadSeq: 0,
		historyMinSeq: 0,
		historyMaxSeq: 0,
		createdAt: 1,
		updatedAt: 2,
		openedAt: 3,
		...overrides,
	};
}

function entry(projectId: string, seq: number, stack: EffectStack) {
	return {
		projectId,
		seq,
		label: seq === 0 ? 'Initial' : `Step ${seq}`,
		stack,
		selectedInstanceId: null,
		createdAt: 100 + seq,
	};
}

const projects = [
	v3Project('plain', {stack: stackOf(instance())}),
	// Undone by one step, with side A.
	v3Project('masked', {
		stack: paint('p1', IN_STACK),
		stackA: paint('a1', IN_SIDE_A),
		historyHeadSeq: 1,
		historyMaxSeq: 2,
	}),
	v3Project('imaged', {stack: imageMask}),
	v3Project('damaged', {
		stack: {schemaVersion: 2},
		stackA: {schemaVersion: 2, instances: [null, {id: 'x', mask: 7}]},
	}),
];

const history = [
	entry('plain', 0, stackOf(instance())),
	entry('masked', 0, paint('p0', IN_UNDO)),
	entry('masked', 1, paint('p1', IN_STACK)),
	entry('masked', 2, paint('p2', IN_REDO)),
	entry('imaged', 0, imageMask),
];

const expected: Record<string, {sources: string[]; masks: string[]}> = {
	plain: {sources: [PRIMARY], masks: []},
	masked: {
		sources: [PRIMARY],
		masks: [IN_STACK, IN_SIDE_A, IN_UNDO, IN_REDO].toSorted(),
	},
	imaged: {sources: [PRIMARY, MASK_IMAGE], masks: []},
	damaged: {sources: [PRIMARY], masks: []},
};

async function createV3Database(idb: IDBFactory): Promise<void> {
	const database = await openDatabase({
		indexedDB: idb,
		name: NAME,
		version: 3,
	});
	await putRecords(
		database,
		'sources',
		[PRIMARY, MASK_IMAGE].map((sha256) => ({sha256, createdAt: 1})),
	);
	await putRecords(database, 'projects', projects);
	await putRecords(database, 'history', history);
	await putRecords(database, 'thumbnails', [
		{projectId: 'masked', stackSignature: 'v3'},
	]);
	await putRecords(database, 'presets', [
		{id: 'user:one', nameLower: 'mine', stack: stackOf(instance())},
	]);
	await putRecords(database, 'meta', [
		{key: 'appState', activeProjectId: 'masked', theme: 'dark'},
	]);
	database.close();
}

async function dump(database: IDBDatabase) {
	const stores: Record<string, unknown[]> = {};
	for (const name of STORES) {
		stores[name] = await allRecords(database, name);
	}

	return stores;
}

async function dumpV3(idb: IDBFactory) {
	const database = await openDatabase({
		indexedDB: idb,
		name: NAME,
		version: 3,
	});
	const result = {
		version: database.version,
		storeNames: [...database.objectStoreNames],
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

describe('database upgrade from version 3 to 4 (persistence.md section 8.6)', () => {
	it('adds the mask store and references and keeps all other data (AC-F29.17)', async () => {
		const idb = new IDBFactory();
		await createV3Database(idb);
		const before = await dumpV3(idb);
		expect(before.storeNames).not.toContain('masks');

		const {database, repository} = await upgrade(idb);

		expect(database.version).toBe(4);
		expect(await repository.getSchemaInfo()).toMatchObject({dbVersion: 4});
		const after = await dump(database);
		for (const name of ['sources', 'history', 'thumbnails', 'presets']) {
			expect(after[name]).toStrictEqual(before.stores[name]);
		}

		expect(after.projects).toStrictEqual(
			(before.stores.projects as ProjectRecord[]).map((record) => ({
				...record,
				referencedSourceHashes: expected[record.id].sources,
				referencedMaskHashes: expected[record.id].masks,
			})),
		);

		const masks = database.transaction('masks').objectStore('masks');
		expect(masks.keyPath).toBe('sha256');
		expect([...masks.indexNames]).toStrictEqual(['byCreatedAt']);
		const index = database
			.transaction('projects')
			.objectStore('projects')
			.index('byReferencedMaskHash');
		expect(index.multiEntry).toBe(true);
		expect(await settle(index.count(IN_REDO))).toBe(1);
		expect(await settle(index.count(MASK_IMAGE))).toBe(0);

		// The image of an image mask survives the cleanup that follows.
		expect(await repository.cleanupOrphanedSources()).toBe(0);
		repository.close();
	});

	it.each<[string, () => Readonly<Record<number, DbMigration>>]>([
		[
			'fails after rewriting every project',
			() => ({
				...dbMigrations,
				3(database, transaction) {
					const step = dbMigrations[3](database, transaction)!;
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
	])('leaves version 3 intact when the upgrade %s', async (_name, broken) => {
		const idb = new IDBFactory();
		await createV3Database(idb);
		const before = await dumpV3(idb);
		try {
			await expect(
				openDatabase({indexedDB: idb, name: NAME, migrations: broken()}),
			).rejects.toThrow(/abort/i);
		} finally {
			vi.restoreAllMocks();
		}

		expect(await dumpV3(idb)).toStrictEqual(before);

		const {database, repository} = await upgrade(idb);
		expect(database.version).toBe(4);
		expect(
			(await repository.getProject('masked'))?.referencedMaskHashes,
		).toStrictEqual(expected.masked.masks);
		repository.close();
	});

	it('creates a fresh database with the mask store', async () => {
		const opened = await openStorage({indexedDB: new IDBFactory()});
		const created = await opened.repository.createProject({
			name: 'New.png',
			blob: new Blob([new Uint8Array([1])], {type: 'image/png'}),
			width: 40,
			height: 30,
		});
		expect(created.project.referencedMaskHashes).toStrictEqual([]);
		expect(await opened.repository.cleanupOrphanedMasks()).toBe(0);
		opened.repository.close();
	});
});
