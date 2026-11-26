import {IDBFactory} from 'fake-indexeddb';
import {describe, expect, it} from 'vite-plus/test';
import {createRegistry} from '../../src/engine/registry.ts';
import type {
	EffectDefinition,
	EffectInstance,
	EffectStack,
} from '../../src/engine/types.ts';
import {
	IndexedDbRepository,
	StorageVersionError,
	dbMigrations,
	migrateStackEnvelope,
	openDatabase,
	openStorage,
	resolveStoredStack,
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

		const dbV4 = await openDatabase({
			indexedDB: idb,
			version: 4,
			migrations: {
				...dbMigrations,
				3(database) {
					if (!database.objectStoreNames.contains('masks')) {
						database.createObjectStore('masks', {keyPath: 'id'});
					}

					return undefined;
				},
			},
		});
		const repoV4 = new IndexedDbRepository(dbV4);
		try {
			expect(dbV4.objectStoreNames.contains('masks')).toBe(true);
			expect((await repoV4.getSchemaInfo())?.dbVersion).toBe(4);
			const existing = await repoV4.getProject(created.project.id);
			expect(existing?.name).toBe('LegacyProject');
		} finally {
			repoV4.close();
		}
	});

	it('throws StorageVersionError when opening a database written by a newer schema version without deleting it', async () => {
		const idb = new IDBFactory();

		const dbV4 = await openDatabase({
			indexedDB: idb,
			version: 4,
			migrations: {
				...dbMigrations,
				3(database) {
					database.createObjectStore('masks', {keyPath: 'id'});
					return undefined;
				},
			},
		});
		const repoV4 = new IndexedDbRepository(dbV4);
		const created = await repoV4.createProject({
			name: 'NewerVersionProject.png',
			blob: new Blob([new Uint8Array([9, 8, 7])], {type: 'image/png'}),
			width: 100,
			height: 100,
		});
		repoV4.close();

		await expect(openDatabase({indexedDB: idb, version: 3})).rejects.toThrow(
			StorageVersionError,
		);
		await expect(openStorage({indexedDB: idb, version: 3})).rejects.toThrow(
			StorageVersionError,
		);

		const reopenedV4 = await openDatabase({indexedDB: idb, version: 4});
		const verifyRepo = new IndexedDbRepository(reopenedV4);
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
