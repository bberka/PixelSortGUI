import {IDENTITY_TRANSFORM} from '../engine/transform.ts';
import {addSourceReferences, referencedSourceHashes} from './extra-sources.ts';
import {resolveStoredGeometry} from './geometry.ts';
import {addMaskReferences, referencedMaskHashes} from './masks.ts';
import {
	DB_NAME,
	DB_VERSION,
	STORE_NAMES,
	StorageVersionError,
	type HistoryEntryRecord,
	type ProjectRecord,
	type SchemaInfoRecord,
} from './types.ts';

// Record rewrites that outlast the migration call. `done` starts the next
// migration, so two never rewrite a record at once.
export type DbMigrationStep = (done: () => void) => void;

export type DbMigration = (
	database: IDBDatabase,
	transaction: IDBTransaction,
) => DbMigrationStep | undefined;

// Visits every record of a store inside the upgrade transaction. An error thrown
// here aborts the upgrade.
function forEachRecord(
	transaction: IDBTransaction,
	storeName: string,
	visit: (cursor: IDBCursorWithValue) => void,
	done: () => void,
): void {
	const request = transaction.objectStore(storeName).openCursor();
	request.addEventListener('success', () => {
		const cursor = request.result;
		if (!cursor) {
			done();
			return;
		}

		visit(cursor);
		cursor.continue();
	});
}

function updateEach<T>(
	transaction: IDBTransaction,
	storeName: string,
	update: (record: T) => T,
	done: () => void,
): void {
	forEachRecord(
		transaction,
		storeName,
		(cursor) => {
			cursor.update(update(cursor.value as T));
		},
		done,
	);
}

// Sets one reference list on every project: what `ofProject` finds in its
// current stacks, and what `addEntry` finds in each entry of its history.
function backfillReferences(
	transaction: IDBTransaction,
	field: 'referencedSourceHashes' | 'referencedMaskHashes',
	ofProject: (project: ProjectRecord) => string[],
	addEntry: (entry: HistoryEntryRecord, into?: Set<string>) => Set<string>,
	done: () => void,
): void {
	// By project id, what its history uses.
	const inHistory = new Map<string, Set<string>>();
	const collect = (cursor: IDBCursorWithValue) => {
		const entry = cursor.value as HistoryEntryRecord;
		inHistory.set(
			entry.projectId,
			addEntry(entry, inHistory.get(entry.projectId)),
		);
	};

	forEachRecord(transaction, STORE_NAMES.history, collect, () => {
		updateEach<ProjectRecord>(
			transaction,
			STORE_NAMES.projects,
			(project) => {
				const earlier = inHistory.get(project.id) ?? [];
				return {
					...project,
					[field]: [...new Set([...ofProject(project), ...earlier])].toSorted(),
				};
			},
			done,
		);
	});
}

function backfillSources(transaction: IDBTransaction, done: () => void): void {
	backfillReferences(
		transaction,
		'referencedSourceHashes',
		(project) => referencedSourceHashes(project, []),
		addSourceReferences,
		done,
	);
}

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

		return undefined;
	},
	// Geometry transforms (persistence.md section 8.1).
	1: (_database, transaction) => (done) => {
		const updateProject = (project: ProjectRecord) => {
			const {effectiveWidth, effectiveHeight, transform} =
				resolveStoredGeometry(
					project.sourceWidth,
					project.sourceHeight,
					project.transform,
				);
			return {
				...project,
				// A stored value is kept, so an invalid one is reported when read.
				transform:
					project.transform === undefined ? transform : project.transform,
				effectiveWidth,
				effectiveHeight,
			};
		};

		const updateEntry = (entry: HistoryEntryRecord) =>
			entry.transform === undefined
				? {...entry, transform: IDENTITY_TRANSFORM}
				: entry;

		updateEach(transaction, STORE_NAMES.projects, updateProject, () => {
			updateEach(transaction, STORE_NAMES.history, updateEntry, done);
		});
	},
	// Reference-counted extra sources (persistence.md section 8.5).
	2(_database, transaction) {
		transaction
			.objectStore(STORE_NAMES.projects)
			.createIndex('byReferencedSourceHash', 'referencedSourceHashes', {
				multiEntry: true,
			});

		return (done) => {
			backfillSources(transaction, done);
		};
	},
	// Painted masks (persistence.md section 8.6).
	3(database, transaction) {
		database
			.createObjectStore(STORE_NAMES.masks, {keyPath: 'sha256'})
			.createIndex('byCreatedAt', 'createdAt');
		transaction
			.objectStore(STORE_NAMES.projects)
			.createIndex('byReferencedMaskHash', 'referencedMaskHashes', {
				multiEntry: true,
			});

		return (done) => {
			backfillReferences(
				transaction,
				'referencedMaskHashes',
				(project) => referencedMaskHashes(project, []),
				addMaskReferences,
				() => {
					// Version 3 did not count the images of image masks as sources.
					backfillSources(transaction, done);
				},
			);
		};
	},
};

export type OpenDatabaseOptions = {
	indexedDB?: IDBFactory;
	name?: string;
	version?: number;
	migrations?: Readonly<Record<number, DbMigration>>;
	onVersionChange?: (event: IDBVersionChangeEvent) => void;
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

			const writeSchemaInfo = () => {
				if (!database.objectStoreNames.contains(STORE_NAMES.meta)) {
					return;
				}

				const schemaInfo: SchemaInfoRecord = {
					key: 'schemaInfo',
					dbVersion: version,
					migratedAt: Date.now(),
				};
				transaction.objectStore(STORE_NAMES.meta).put(schemaInfo);
			};

			const migrateFrom = (current: number) => {
				if (current >= version) {
					writeSchemaInfo();
					return;
				}

				const next = () => {
					migrateFrom(current + 1);
				};

				const step = migrations[current]?.(database, transaction);
				if (step) {
					step(next);
				} else {
					next();
				}
			};

			migrateFrom(event.oldVersion);
		});

		request.addEventListener('success', () => {
			const database = request.result;
			database.addEventListener('versionchange', (event) => {
				database.close();
				options.onVersionChange?.(event);
			});
			resolve(database);
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
