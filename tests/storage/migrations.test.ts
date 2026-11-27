import {IDBFactory} from 'fake-indexeddb';
import {describe, expect, it} from 'vite-plus/test';
import {createRegistry} from '../../src/engine/registry.ts';
import type {
	EffectDefinition,
	EffectInstance,
	EffectStack,
} from '../../src/engine/types.ts';
import {
	DB_VERSION,
	IndexedDbRepository,
	StorageVersionError,
	dbMigrations,
	migrateStackEnvelope,
	openDatabase,
	openStorage,
	resolveStoredStack,
	type DbMigration,
} from '../../src/storage/index.ts';

function makeTestEffectV2(): EffectDefinition {
	return {
		type: 'testEffect',
		version: 2,
		label: 'Test Effect',
		description: 'Test effect for migration suite',
		category: 'glitch',
		params: {
			strength: {
				kind: 'number',
				label: 'Strength',
				group: 'Main',
				min: 0,
				max: 1,
				step: 0.01,
				default: 0.5,
			},
		},
		migrations: {
			1(old) {
				const legacy = typeof old.amount === 'number' ? old.amount : 50;
				return {strength: legacy / 100};
			},
		},
		render(_input, _output) {},
	};
}

// A schema version this build does not have.
const NEWER_VERSION = DB_VERSION + 1;
const newerMigrations: Readonly<Record<number, DbMigration>> = {
	...dbMigrations,
	[DB_VERSION](database) {
		database.createObjectStore('future', {keyPath: 'id'});
		return undefined;
	},
};

describe('Database schema migrations and VersionError handling', () => {
	it('upgrades from v1 through a later version sequentially while preserving v1 records and updating schemaInfo', async () => {
		const idb = new IDBFactory();

		const dbV1 = await openDatabase({indexedDB: idb, version: 1});
		const repoV1 = new IndexedDbRepository(dbV1);
		const created = await repoV1.createProject({
			name: 'LegacyProject.png',
			blob: new Blob([new Uint8Array([1, 2, 3, 4])], {type: 'image/png'}),
			width: 320,
			height: 240,
		});
		expect((await repoV1.getSchemaInfo())?.dbVersion).toBe(1);
		repoV1.close();

		const newer = await openDatabase({
			indexedDB: idb,
			version: NEWER_VERSION,
			migrations: newerMigrations,
		});
		const newerRepository = new IndexedDbRepository(newer);
		try {
			expect(newer.objectStoreNames.contains('future')).toBe(true);
			expect((await newerRepository.getSchemaInfo())?.dbVersion).toBe(
				NEWER_VERSION,
			);
			const existing = await newerRepository.getProject(created.project.id);
			expect(existing?.name).toBe('LegacyProject');
		} finally {
			newerRepository.close();
		}
	});

	it('throws StorageVersionError when opening a database written by a newer schema version without deleting it', async () => {
		const idb = new IDBFactory();

		const newer = await openDatabase({
			indexedDB: idb,
			version: NEWER_VERSION,
			migrations: newerMigrations,
		});
		const newerRepository = new IndexedDbRepository(newer);
		const created = await newerRepository.createProject({
			name: 'NewerVersionProject.png',
			blob: new Blob([new Uint8Array([9, 8, 7])], {type: 'image/png'}),
			width: 100,
			height: 100,
		});
		newerRepository.close();

		await expect(
			openDatabase({indexedDB: idb, version: DB_VERSION}),
		).rejects.toThrow(StorageVersionError);
		await expect(
			openStorage({indexedDB: idb, version: DB_VERSION}),
		).rejects.toThrow(StorageVersionError);

		const reopened = await openDatabase({
			indexedDB: idb,
			version: NEWER_VERSION,
		});
		const verifyRepo = new IndexedDbRepository(reopened);
		try {
			const intact = await verifyRepo.getProject(created.project.id);
			expect(intact?.name).toBe('NewerVersionProject');
		} finally {
			verifyRepo.close();
		}
	});
});

describe('EffectStack and EffectInstance migration on load', () => {
	it('migrates outdated EffectInstance params and preserves unknown types, newer versions, and unknown fields', () => {
		const registry = createRegistry([makeTestEffectV2()]);

		const v1Instance = {
			id: 'inst0001',
			type: 'testEffect',
			version: 1,
			enabled: true,
			params: {amount: 75},
			mix: 1,
			blend: 'normal',
			futureMaskId: 'mask-1',
		} as unknown as EffectInstance;

		const unknownTypeInstance = {
			id: 'inst0002',
			type: 'unknownFutureEffect',
			version: 1,
			enabled: true,
			params: {foo: 'bar'},
			mix: 0.5,
			blend: 'lighten',
			extraField: 123,
		} as unknown as EffectInstance;

		const newerVersionInstance = {
			id: 'inst0003',
			type: 'testEffect',
			version: 5,
			enabled: true,
			params: {strength: 0.9, v5Only: true},
			mix: 1,
			blend: 'normal',
		} as unknown as EffectInstance;

		const stack: EffectStack = {
			schemaVersion: 1,
			instances: [v1Instance, unknownTypeInstance, newerVersionInstance],
		};

		const resolved = resolveStoredStack(stack, registry);
		expect(resolved.envelopeStatus).toBe('ok');
		expect(resolved.needsWriteBack).toBe(true);
		expect(resolved.unsupportedInstances).toEqual([
			{
				instanceId: 'inst0002',
				type: 'unknownFutureEffect',
				version: 1,
				reason: 'unknown-type',
			},
			{
				instanceId: 'inst0003',
				type: 'testEffect',
				version: 5,
				reason: 'newer-version',
			},
		]);

		expect(resolved.stack.instances[0]).toEqual({
			id: 'inst0001',
			type: 'testEffect',
			version: 2,
			enabled: true,
			params: {strength: 0.75},
			mix: 1,
			blend: 'normal',
			futureMaskId: 'mask-1',
		});
		expect(resolved.stack.instances[1]).toBe(unknownTypeInstance);
		expect(resolved.stack.instances[2]).toBe(newerVersionInstance);
	});

	it('reads a masked stack (schemaVersion 2) like any current one', () => {
		const registry = createRegistry([makeTestEffectV2()]);
		const masked: EffectStack = {schemaVersion: 2, instances: []};

		expect(resolveStoredStack(masked, registry)).toEqual({
			stack: masked,
			envelopeStatus: 'ok',
			needsWriteBack: false,
			unsupportedInstances: [],
		});
	});

	it('preserves stacks with a newer schemaVersion untouched', () => {
		const registry = createRegistry([makeTestEffectV2()]);
		const newerStack = {
			schemaVersion: 3,
			extraEnvelopeField: 'keep',
			instances: [],
		} as unknown as EffectStack;

		const envelope = migrateStackEnvelope(newerStack);
		expect(envelope.status).toBe('newer-version');
		expect(envelope.stack).toBe(newerStack);

		const resolved = resolveStoredStack(newerStack, registry);
		expect(resolved.envelopeStatus).toBe('newer-version');
		expect(resolved.needsWriteBack).toBe(false);
		expect(resolved.stack).toBe(newerStack);
	});
});
