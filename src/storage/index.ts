import {openDatabase, type OpenDatabaseOptions} from './db.ts';
import {
	MemoryStorageAdapter,
	type MemoryStorageAdapterOptions,
} from './memory-adapter.ts';
import {
	IndexedDbRepository,
	type IndexedDbRepositoryOptions,
} from './repository.ts';
import {StorageVersionError, type StorageRepository} from './types.ts';

export type OpenStorageOptions = OpenDatabaseOptions &
	IndexedDbRepositoryOptions &
	MemoryStorageAdapterOptions;

export type OpenStorageResult =
	| {
			repository: StorageRepository;
			persistence: 'indexeddb';
			storageUnavailable: false;
	  }
	| {
			repository: StorageRepository;
			persistence: 'memory';
			storageUnavailable: true;
			error: unknown;
	  };

export async function openStorage(
	options: OpenStorageOptions = {},
): Promise<OpenStorageResult> {
	try {
		const database = await openDatabase(options);
		return {
			repository: new IndexedDbRepository(database, options),
			persistence: 'indexeddb',
			storageUnavailable: false,
		};
	} catch (error) {
		if (error instanceof StorageVersionError) {
			throw error;
		}

		return {
			repository: new MemoryStorageAdapter(options),
			persistence: 'memory',
			storageUnavailable: true,
			error,
		};
	}
}

export * from './db.ts';
export * from './geometry.ts';
export * from './helpers.ts';
export * from './memory-adapter.ts';
export * from './migrations.ts';
export * from './project-transfer.ts';
export * from './quota.ts';
export * from './repository.ts';
export * from './types.ts';
