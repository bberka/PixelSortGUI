import {IDBFactory, IDBKeyRange as FakeKeyRange} from 'fake-indexeddb';
import {describe, expect, it} from 'vite-plus/test';
import {IDENTITY_TRANSFORM} from '../../src/engine/transform.ts';
import type {EffectStack} from '../../src/engine/types.ts';
import {
	DB_VERSION,
	IndexedDbRepository,
	openDatabase,
	openStorage,
	type HistoryEntryRecord,
	type ProjectRecord,
} from '../../src/storage/index.ts';
import {allRecords, putRecords} from './idb-helpers.ts';

const NAME = 'drift-v1-fixture';
const EMPTY: EffectStack = {schemaVersion: 1, instances: []};

function stackOf(id: string, angle: number): EffectStack {
	return {
		schemaVersion: 1,
		instances: [
			{
				id,
				type: 'pixelSort',
				version: 1,
				enabled: true,
				params: {angle},
				mix: 1,
				blend: 'normal',
			},
		],
	};
}

// A project record as version 1 wrote it: no geometry fields.
function v1Project(
	id: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id,
		name: id,
		sourceHash: 'a'.repeat(64),
		sourceWidth: 400,
		sourceHeight: 300,
		stack: EMPTY,
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
		},
		exportSettings: {
			format: 'jpeg',
			quality: 70,
			sizeMode: 'half',
			customLongestSide: null,
		},
		createdAt: 1,
		updatedAt: 2,
		openedAt: 3,
		...overrides,
	};
}

function v1Entry(
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
		createdAt: 100 + seq,
		...overrides,
	};
}

const projects = [
	v1Project('plain'),
	// Undone by one step, with a side A.
	v1Project('edited', {
		stack: stackOf('b1', 10),
		stackA: stackOf('a1', 20),
		selectedInstanceIdA: 'a1',
		selectedInstanceId: 'b1',
		historyHeadSeq: 1,
		historyMaxSeq: 2,
	}),
	// A version 1 build rendered a transform it found but never wrote one.
	v1Project('turned', {transform: {...IDENTITY_TRANSFORM, rotation: 90}}),
	v1Project('broken', {transform: {rotation: 45}}),
];

const history = [
	v1Entry('plain', 0, EMPTY),
	v1Entry('edited', 0, EMPTY),
	v1Entry('edited', 1, stackOf('b1', 10), {
		stackA: stackOf('a1', 20),
		selectedInstanceIdA: 'a1',
	}),
	v1Entry('edited', 2, stackOf('b1', 30), {
		stackA: stackOf('a1', 20),
		selectedInstanceIdA: 'a1',
	}),
	v1Entry('turned', 0, EMPTY),
	v1Entry('broken', 0, EMPTY),
];

const sourceBytes = new Uint8Array([1, 2, 3, 4, 5]);
const thumbnails = [
	{
		projectId: 'edited',
		blob: new Blob([new Uint8Array([9, 9])], {type: 'image/webp'}),
		width: 200,
		height: 150,
		stackSignature: 'v1-signature',
		updatedAt: 50,
	},
];
const preset = {
	id: 'user:one',
	name: 'Mine',
	nameLower: 'mine',
	stack: stackOf('p1', 45),
	createdAt: 5,
	updatedAt: 5,
};
const appState = {
	key: 'appState',
	activeProjectId: 'edited',
	theme: 'dark',
	compareMode: 'split',
};

async function createV1Database(idb: IDBFactory): Promise<void> {
	const database = await openDatabase({
		indexedDB: idb,
		name: NAME,
		version: 1,
	});
	await putRecords(database, 'sources', [
		{
			sha256: 'a'.repeat(64),
			blob: new Blob([sourceBytes], {type: 'image/png'}),
			mimeType: 'image/png',
			byteLength: sourceBytes.length,
			width: 400,
			height: 300,
			createdAt: 1,
		},
	]);
	await putRecords(database, 'projects', projects);
	await putRecords(database, 'history', history);
	await putRecords(database, 'thumbnails', thumbnails);
	await putRecords(database, 'presets', [preset]);
	await putRecords(database, 'meta', [appState]);
	database.close();
}

async function upgrade(idb: IDBFactory) {
	const database = await openDatabase({indexedDB: idb, name: NAME});
	const repository = new IndexedDbRepository(database, {
		keyRange: FakeKeyRange,
	});
	return {database, repository};
}

describe('database upgrade from version 1 (persistence.md section 8.1)', () => {
	it('adds geometry to every project and history entry and keeps all other data', async () => {
		const idb = new IDBFactory();
		await createV1Database(idb);
		const {database, repository} = await upgrade(idb);

		expect(database.version).toBe(DB_VERSION);
		expect((await repository.getSchemaInfo())?.dbVersion).toBe(DB_VERSION);

		// Version 3 ran after version 2 and kept what it wrote.
		const references = {referencedSourceHashes: ['a'.repeat(64)]};
		const identity = {
			...references,
			transform: IDENTITY_TRANSFORM,
			effectiveWidth: 400,
			effectiveHeight: 300,
		};
		const upgraded = new Map(
			(await allRecords<ProjectRecord>(database, 'projects')).map((record) => [
				record.id,
				record,
			]),
		);
		expect(upgraded.get('plain')).toEqual({...projects[0], ...identity});
		expect(upgraded.get('edited')).toEqual({...projects[1], ...identity});
		// A stored transform survives and sizes the record.
		expect(upgraded.get('turned')).toEqual({
			...projects[2],
			...references,
			effectiveWidth: 300,
			effectiveHeight: 400,
		});
		// An invalid one is left for the read-time repair and never blocks opening.
		expect(upgraded.get('broken')).toEqual({
			...projects[3],
			...references,
			effectiveWidth: 400,
			effectiveHeight: 300,
		});

		const entries = await allRecords<HistoryEntryRecord>(database, 'history');
		expect(entries).toHaveLength(history.length);
		for (const entry of entries) {
			const before = history.find(
				(item) => item.projectId === entry.projectId && item.seq === entry.seq,
			);
			expect(entry).toEqual({...before, transform: IDENTITY_TRANSFORM});
		}

		const source = await repository.getSource('a'.repeat(64));
		expect(new Uint8Array(await source!.blob.arrayBuffer())).toEqual(
			sourceBytes,
		);
		const thumbnail = await repository.getThumbnail('edited');
		expect(thumbnail).toMatchObject({
			stackSignature: 'v1-signature',
			width: 200,
			height: 150,
		});
		expect(thumbnail!.blob.size).toBe(2);
		expect(await repository.listPresets()).toEqual([preset]);
		expect(await repository.getAppState()).toEqual(appState);
		repository.close();
	});

	it('leaves upgraded history usable for redo, new commits and undo', async () => {
		const idb = new IDBFactory();
		await createV1Database(idb);
		const {repository} = await upgrade(idb);

		const redone = await repository.redo('edited');
		expect(redone?.project.stack).toEqual(stackOf('b1', 30));
		expect(redone?.project.stackA).toEqual(stackOf('a1', 20));

		const committed = await repository.commitStack({
			projectId: 'edited',
			stack: redone!.project.stack,
			selectedInstanceId: 'b1',
			transform: {...IDENTITY_TRANSFORM, flipX: true},
			label: 'Flip horizontal',
		});
		expect(committed.entry.stackA).toEqual(stackOf('a1', 20));

		const undone = await repository.undo('edited');
		expect(undone?.project.transform).toEqual(IDENTITY_TRANSFORM);
		expect(undone?.project.stackA).toEqual(stackOf('a1', 20));
		repository.close();
	});

	it('creates a fresh database at the current version', async () => {
		const opened = await openStorage({indexedDB: new IDBFactory()});

		expect(opened.persistence).toBe('indexeddb');
		expect((await opened.repository.getSchemaInfo())?.dbVersion).toBe(
			DB_VERSION,
		);
		opened.repository.close();
	});
});
