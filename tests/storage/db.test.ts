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

		const current = await openDatabase({
			indexedDB: idb,
			name: 'drift-vc-upgrade',
			version: 3,
			onVersionChange(event) {
				events.push({
					oldVersion: event.oldVersion,
					newVersion: event.newVersion,
				});
			},
		});

		const next = await openDatabase({
			indexedDB: idb,
			name: 'drift-vc-upgrade',
			version: 4,
			migrations: {
				...dbMigrations,
				3(database) {
					database.createObjectStore('extra', {keyPath: 'id'});
					return undefined;
				},
			},
		});

		expect(events).toEqual([{oldVersion: 3, newVersion: 4}]);
		expect(next.version).toBe(4);
		expect(() => current.transaction('projects', 'readonly')).toThrow();

		next.close();
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
