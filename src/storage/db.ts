import {
	DB_NAME,
	DB_VERSION,
	STORE_NAMES,
	StorageVersionError,
	type SchemaInfoRecord,
} from './types.ts';

export type DbMigration = (
	database: IDBDatabase,
	transaction: IDBTransaction,
) => void;

export const dbMigrations: Readonly<Record<number, DbMigration>> = {
	0(database) {
		if (!database.objectStoreNames.contains(STORE_NAMES.sources)) {
			const sources = database.createObjectStore(STORE_NAMES.sources, {
				keyPath: 'sha256',
			});
			sources.createIndex('byCreatedAt', 'createdAt');
		}

		if (!database.objectStoreNames.contains(STORE_NAMES.projects)) {
			const projects = database.createObjectStore(STORE_NAMES.projects, {
				keyPath: 'id',
			});
			projects.createIndex('byOpenedAt', 'openedAt');
			projects.createIndex('bySourceHash', 'sourceHash');
		}

		if (!database.objectStoreNames.contains(STORE_NAMES.thumbnails)) {
			database.createObjectStore(STORE_NAMES.thumbnails, {
				keyPath: 'projectId',
			});
		}

		if (!database.objectStoreNames.contains(STORE_NAMES.history)) {
			const history = database.createObjectStore(STORE_NAMES.history, {
				keyPath: ['projectId', 'seq'],
			});
			history.createIndex('byProjectId', 'projectId');
		}

		if (!database.objectStoreNames.contains(STORE_NAMES.presets)) {
			const presets = database.createObjectStore(STORE_NAMES.presets, {
				keyPath: 'id',
			});
			presets.createIndex('byNameLower', 'nameLower');
		}

		if (!database.objectStoreNames.contains(STORE_NAMES.meta)) {
			database.createObjectStore(STORE_NAMES.meta, {
				keyPath: 'key',
			});
		}
	},
};

export type OpenDatabaseOptions = {
	indexedDB?: IDBFactory;
	name?: string;
	version?: number;
	migrations?: Readonly<Record<number, DbMigration>>;
};

export function openDatabase(
	options: OpenDatabaseOptions = {},
): Promise<IDBDatabase> {
	const factory = options.indexedDB ?? globalThis.indexedDB;
	if (!factory) {
		return Promise.reject(new Error('IndexedDB is not available'));
	}

	const name = options.name ?? DB_NAME;
	const version = options.version ?? DB_VERSION;
	const migrations = options.migrations ?? dbMigrations;

	return new Promise<IDBDatabase>((resolve, reject) => {
		let request: IDBOpenDBRequest;
		try {
			request = factory.open(name, version);
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}

		request.addEventListener('upgradeneeded', (event) => {
			const database = request.result;
			const {transaction} = request;
			if (!transaction) {
				return;
			}

			for (let current = event.oldVersion; current < version; current++) {
				const migrate = migrations[current];
				if (migrate) {
					migrate(database, transaction);
				}
			}

			if (!database.objectStoreNames.contains(STORE_NAMES.meta)) {
				return;
			}

			const schemaInfo: SchemaInfoRecord = {
				key: 'schemaInfo',
				dbVersion: version,
				migratedAt: Date.now(),
			};
			transaction.objectStore(STORE_NAMES.meta).put(schemaInfo);
		});

		request.addEventListener('success', () => {
			resolve(request.result);
		});

		request.addEventListener('error', () => {
			const error = request.error ?? new Error('Failed to open IndexedDB');
			if (error.name === 'VersionError') {
				reject(new StorageVersionError(version, undefined, {cause: error}));
				return;
			}

			reject(error);
		});
	});
}
