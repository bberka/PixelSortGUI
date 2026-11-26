import {IDBFactory} from 'fake-indexeddb';
import {describe, expect, it} from 'vite-plus/test';
import {
	dbMigrations,
	openDatabase,
	openStorage,
} from '../../src/storage/index.ts';

function deleteDatabase(idb: IDBFactory, name: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = idb.deleteDatabase(name);
		request.addEventListener('success', () => {
			resolve();
		});
		request.addEventListener('error', () => {
			reject(request.error ?? new Error('deleteDatabase failed'));
		});
		request.addEventListener('blocked', () => {
			reject(new Error('deleteDatabase was blocked by an open connection'));
		});
	});
}

describe('openDatabase versionchange handling', () => {
	it('closes the open connection and notifies onVersionChange when another connection upgrades the database', async () => {
		const idb = new IDBFactory();
		const events: Array<{oldVersion: number; newVersion: number | null}> = [];

		const dbV2 = await openDatabase({
			indexedDB: idb,
			name: 'drift-vc-upgrade',
			version: 2,
			onVersionChange(event) {
				events.push({
					oldVersion: event.oldVersion,
					newVersion: event.newVersion,
				});
			},
		});

		const dbV3 = await openDatabase({
			indexedDB: idb,
			name: 'drift-vc-upgrade',
			version: 3,
			migrations: {
				...dbMigrations,
				2(database) {
					database.createObjectStore('extra', {keyPath: 'id'});
				},
			},
		});

		expect(events).toEqual([{oldVersion: 2, newVersion: 3}]);
		expect(dbV3.version).toBe(3);
		expect(() => dbV2.transaction('projects', 'readonly')).toThrow();

		dbV3.close();
	});

	it('closes the open connection and notifies onVersionChange when the database is deleted', async () => {
		const idb = new IDBFactory();
		const events: Array<{oldVersion: number; newVersion: number | null}> = [];

		const opened = await openStorage({
			indexedDB: idb,
			name: 'drift-vc-delete',
			version: 1,
			onVersionChange(event) {
				events.push({
					oldVersion: event.oldVersion,
					newVersion: event.newVersion,
				});
			},
		});
		expect(opened.persistence).toBe('indexeddb');

		await deleteDatabase(idb, 'drift-vc-delete');

		expect(events).toEqual([{oldVersion: 1, newVersion: null}]);
		await expect(opened.repository.listProjects()).rejects.toThrow();
	});
});
