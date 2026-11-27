import {IDENTITY_TRANSFORM} from '../engine/transform.ts';
import type {EffectStack} from '../engine/types.ts';
import {
	backupSourceHashes,
	type BackupOptions,
	type BackupOutput,
	type ExportBackupOptions,
	type BackupInput,
} from './backup-format.ts';
import {
	chooseBackupProjects,
	inspectBackupArchive,
	runBackupImport,
	writeBackupArchive,
	type BackupImportResult,
	type BackupImportStore,
	type BackupInspection,
	type BackupSelection,
	type BackupTransferDependencies,
} from './backup-transfer.ts';
import {
	addedSourceReferences,
	missingSourceError,
	newSourceRecord,
	projectSourceHashes,
	referencedSourceHashes,
	stripSourceReferences,
} from './extra-sources.ts';
import {commitGeometry, resolveStoredGeometry} from './geometry.ts';
import {
	createDefaultAppState,
	createDefaultExportSettings,
	createDefaultViewState,
	createDuplicateProjectName,
	createEmptyStack,
	generateId,
	hashBlobSha256,
	normalizeExportSettings,
	normalizeImportProjectName,
	normalizeViewState,
	validateImageDimensions,
	validatePresetName,
	validateProjectName,
	validateStackForWrite,
	withSideA,
} from './helpers.ts';
import type {ProjectFileOutput} from './project-format.ts';
import {
	buildImportedProject,
	prepareProjectImport,
	toSourceRecord,
	writeProjectArchive,
	type ProjectTransferDependencies,
} from './project-transfer.ts';
import {checkQuotaForImport, type StorageManagerLike} from './quota.ts';
import {
	MAX_HISTORY_ENTRIES,
	STORE_NAMES,
	StorageNotFoundError,
	StorageQuotaError,
	isQuotaExceededError,
	type AppStateRecord,
	type CommitStackInput,
	type CommitStackResult,
	type CreatePresetInput,
	type CreateProjectInput,
	type CreateProjectResult,
	type DeleteProjectResult,
	type ExportProjectOptions,
	type ExportSettings,
	type HistoryEntryRecord,
	type HistoryStepResult,
	type ImportProjectOptions,
	type ProjectRecord,
	type SchemaInfoRecord,
	type SourceRecord,
	type StartupSnapshot,
	type StorageRepository,
	type StoreName,
	type ThumbnailRecord,
	type UserPresetRecord,
	type ViewState,
} from './types.ts';

function wrapStorageError(error: unknown): Error {
	if (isQuotaExceededError(error)) {
		return error instanceof StorageQuotaError
			? error
			: new StorageQuotaError(undefined, {cause: error});
	}

	return error instanceof Error ? error : new Error(String(error));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.addEventListener('success', () => {
			resolve(request.result);
		});
		request.addEventListener('error', () => {
			reject(wrapStorageError(request.error));
		});
	});
}

function beginTransaction(
	database: IDBDatabase,
	stores: StoreName | readonly StoreName[],
	mode: IDBTransactionMode,
): IDBTransaction {
	const storeList = typeof stores === 'string' ? [stores] : [...stores];
	try {
		return database.transaction(storeList, mode, {durability: 'default'});
	} catch {
		return database.transaction(storeList, mode);
	}
}

function runTransaction<T>(
	database: IDBDatabase,
	stores: StoreName | readonly StoreName[],
	mode: IDBTransactionMode,
	operation: (transaction: IDBTransaction) => Promise<T> | T,
	// Aborting rolls the transaction back, unless it is already committing.
	signal?: AbortSignal,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		signal?.throwIfAborted();
		let transaction: IDBTransaction;
		try {
			transaction = beginTransaction(database, stores, mode);
		} catch (error) {
			reject(wrapStorageError(error));
			return;
		}

		let result: T;
		let operationSettled = false;
		let operationError: unknown;
		let cancelled = false;
		const cancel = () => {
			try {
				transaction.abort();
			} catch {
				// Too late to cancel: let the commit finish.
				return;
			}

			cancelled = true;
			operationError = signal!.reason;
		};

		signal?.addEventListener('abort', cancel);
		const settle = () => {
			signal?.removeEventListener('abort', cancel);
		};

		transaction.addEventListener('complete', () => {
			settle();
			if (operationError !== undefined) {
				reject(wrapStorageError(operationError));
				return;
			}

			resolve(result);
		});

		transaction.addEventListener('abort', () => {
			settle();
			const cause = operationError ?? transaction.error;
			reject(
				cause
					? wrapStorageError(cause)
					: new Error('IndexedDB transaction aborted'),
			);
		});

		transaction.addEventListener('error', () => {
			if (!operationSettled) {
				operationError = transaction.error;
			}
		});

		const handleFailure = (error: unknown) => {
			// Requests of a cancelled transaction fail too; keep the reason.
			if (!cancelled) {
				operationError = error;
			}

			operationSettled = true;
			try {
				transaction.abort();
			} catch {
				// Transaction may already be aborting or finished.
			}
		};

		try {
			const outcome = operation(transaction);
			Promise.resolve(outcome)
				.then((value) => {
					result = value;
					operationSettled = true;
				})
				.catch(handleFailure);
		} catch (error) {
			handleFailure(error);
		}
	});
}

function readIndexDescending<T>(index: IDBIndex): Promise<T[]> {
	return new Promise<T[]>((resolve, reject) => {
		const results: T[] = [];
		const request = index.openCursor(null, 'prev');
		request.addEventListener('success', () => {
			const cursor = request.result;
			if (!cursor) {
				resolve(results);
				return;
			}

			results.push(cursor.value as T);
			cursor.continue();
		});
		request.addEventListener('error', () => {
			reject(wrapStorageError(request.error));
		});
	});
}

async function readHistory(
	transaction: IDBTransaction,
	projectId: string,
): Promise<HistoryEntryRecord[]> {
	return (await requestToPromise(
		transaction
			.objectStore(STORE_NAMES.history)
			.index('byProjectId')
			.getAll(projectId),
	)) as HistoryEntryRecord[];
}

// The stored ones among `hashes`, in their order.
async function readSources(
	transaction: IDBTransaction,
	hashes: Iterable<string>,
): Promise<SourceRecord[]> {
	const sources: SourceRecord[] = [];
	for (const sha256 of hashes) {
		const source = (await requestToPromise(
			transaction.objectStore(STORE_NAMES.sources).get(sha256),
		)) as SourceRecord | undefined;
		if (source) {
			sources.push(source);
		}
	}

	return sources;
}

async function requireSources(
	transaction: IDBTransaction,
	hashes: readonly string[],
): Promise<void> {
	for (const sha256 of hashes) {
		const count = await requestToPromise(
			transaction.objectStore(STORE_NAMES.sources).count(sha256),
		);
		if (count === 0) {
			throw missingSourceError(sha256);
		}
	}
}

// Keeps a record that is already stored under the same hash.
async function storeSourceOnce(
	transaction: IDBTransaction,
	record: SourceRecord,
): Promise<void> {
	const store = transaction.objectStore(STORE_NAMES.sources);
	if ((await requestToPromise(store.count(record.sha256))) === 0) {
		await requestToPromise(store.put(record));
	}
}

// Deletes those of the sources that no project refers to, and returns them
// (persistence.md section 8.5). The transaction covers sources and projects.
async function deleteUnreferencedSources(
	transaction: IDBTransaction,
	hashes: Iterable<string>,
): Promise<string[]> {
	const projects = transaction.objectStore(STORE_NAMES.projects);
	const indexes = [
		projects.index('byReferencedSourceHash'),
		projects.index('bySourceHash'),
	];
	const deleted: string[] = [];
	for (const sha256 of hashes) {
		let references = 0;
		for (const index of indexes) {
			references += await requestToPromise(index.count(sha256));
		}

		if (references !== 0) {
			continue;
		}

		await requestToPromise(
			transaction.objectStore(STORE_NAMES.sources).delete(sha256),
		);
		deleted.push(sha256);
	}

	return deleted;
}

export type IndexedDbRepositoryOptions = ProjectTransferDependencies &
	BackupTransferDependencies & {
		storageManager?: StorageManagerLike;
		now?: () => number;
		keyRange?: typeof IDBKeyRange;
	};

export class IndexedDbRepository implements StorageRepository {
	readonly #db: IDBDatabase;
	readonly #storageManager: StorageManagerLike | undefined;
	readonly #now: () => number;
	readonly #keyRange: typeof IDBKeyRange;
	readonly #transfer: ProjectTransferDependencies & BackupTransferDependencies;

	constructor(database: IDBDatabase, options: IndexedDbRepositoryOptions = {}) {
		this.#db = database;
		this.#storageManager = options.storageManager;
		this.#now = options.now ?? (() => Date.now());
		this.#keyRange = options.keyRange ?? globalThis.IDBKeyRange;
		this.#transfer = options;
	}

	async #moveHistoryHead(
		projectId: string,
		resolveSeq: (project: ProjectRecord) => number,
	): Promise<HistoryStepResult | null> {
		const now = this.#now();
		return runTransaction(
			this.#db,
			[STORE_NAMES.projects, STORE_NAMES.history],
			'readwrite',
			async (tx) => {
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const historyStore = tx.objectStore(STORE_NAMES.history);

				const existing = (await requestToPromise(
					projectsStore.get(projectId),
				)) as ProjectRecord | undefined;
				if (!existing) {
					throw new StorageNotFoundError(`Project "${projectId}" not found`);
				}

				const targetSeq = resolveSeq(existing);
				if (
					!Number.isSafeInteger(targetSeq) ||
					targetSeq < existing.historyMinSeq ||
					targetSeq > existing.historyMaxSeq
				) {
					return null;
				}

				const entry = (await requestToPromise(
					historyStore.get([projectId, targetSeq]),
				)) as HistoryEntryRecord | undefined;
				if (!entry) {
					return null;
				}

				const {repaired, ...geometry} = resolveStoredGeometry(
					existing.sourceWidth,
					existing.sourceHeight,
					entry.transform,
				);
				const updated = withSideA<ProjectRecord>(
					{
						...existing,
						...geometry,
						stack: entry.stack,
						selectedInstanceId: entry.selectedInstanceId,
						historyHeadSeq: entry.seq,
						updatedAt: now,
					},
					entry.stackA,
					entry.selectedInstanceIdA,
				);
				await requestToPromise(projectsStore.put(updated));
				return {project: updated, entry};
			},
		);
	}

	#backupStore(): BackupImportStore {
		return {
			checkQuota: async (bytes) => this.#requireQuota(bytes),
			hasSource: async (sha256) => this.hasSource(sha256),
			stageSource: async (source, signal) =>
				runTransaction(
					this.#db,
					STORE_NAMES.sources,
					'readwrite',
					async (tx) => {
						const store = tx.objectStore(STORE_NAMES.sources);
						if ((await requestToPromise(store.count(source.sha256))) > 0) {
							return false;
						}

						await requestToPromise(store.put(source));
						return true;
					},
					signal,
				),
			commit: async (plan, signal) =>
				runTransaction(
					this.#db,
					[
						STORE_NAMES.sources,
						STORE_NAMES.projects,
						STORE_NAMES.history,
						STORE_NAMES.thumbnails,
						STORE_NAMES.presets,
						STORE_NAMES.meta,
					],
					'readwrite',
					async (tx) => this.#writeBackupPlan(tx, plan),
					signal,
				),
			discardSources: async (hashes) =>
				runTransaction(
					this.#db,
					[STORE_NAMES.sources, STORE_NAMES.projects],
					'readwrite',
					async (tx) => {
						await deleteUnreferencedSources(tx, hashes);
					},
				),
			cleanupOrphanedSources: async () => this.cleanupOrphanedSources(),
		};
	}

	// The metadata commit of a backup import (persistence.md section 8.4.4).
	async #writeBackupPlan(
		tx: IDBTransaction,
		planFrom: Parameters<BackupImportStore['commit']>[0],
	) {
		const projectsStore = tx.objectStore(STORE_NAMES.projects);
		const presetsStore = tx.objectStore(STORE_NAMES.presets);
		const sourcesStore = tx.objectStore(STORE_NAMES.sources);
		const metaStore = tx.objectStore(STORE_NAMES.meta);
		const plan = planFrom({
			projects: (await requestToPromise(
				projectsStore.getAll(),
			)) as ProjectRecord[],
			presets: (await requestToPromise(
				presetsStore.getAll(),
			)) as UserPresetRecord[],
		});

		// A cleanup in another tab may have deleted a staged source.
		for (const source of plan.sources) {
			if ((await requestToPromise(sourcesStore.count(source.sha256))) === 0) {
				await requestToPromise(
					sourcesStore.put(toSourceRecord(source, this.#now())),
				);
			}
		}

		const replace = plan.mode === 'replace';
		if (replace) {
			for (const name of [
				STORE_NAMES.projects,
				STORE_NAMES.history,
				STORE_NAMES.thumbnails,
				STORE_NAMES.presets,
			]) {
				await requestToPromise(tx.objectStore(name).clear());
			}
		}

		for (const {project, history, thumbnail} of plan.records) {
			await requestToPromise(projectsStore.put(project));
			for (const entry of history) {
				await requestToPromise(tx.objectStore(STORE_NAMES.history).put(entry));
			}

			if (thumbnail) {
				await requestToPromise(
					tx.objectStore(STORE_NAMES.thumbnails).put(thumbnail),
				);
			}
		}

		for (const preset of plan.presets) {
			await requestToPromise(presetsStore.put(preset));
		}

		if (replace || plan.settings) {
			const appState =
				((await requestToPromise(metaStore.get('appState'))) as
					AppStateRecord | undefined) ?? createDefaultAppState();
			await requestToPromise(
				metaStore.put({
					...appState,
					...plan.settings,
					...(replace && {activeProjectId: null}),
					key: 'appState',
				}),
			);
		}

		return plan;
	}

	async #requireQuota(bytes: number): Promise<void> {
		const quotaCheck = await checkQuotaForImport(bytes, this.#storageManager);
		if (!quotaCheck.ok) {
			throw new StorageQuotaError(
				`Insufficient storage quota for ${bytes} bytes of images`,
			);
		}
	}

	async createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
		validateImageDimensions(input.width, input.height);
		const name = normalizeImportProjectName(
			input.name,
			input.stripExtension ?? true,
		);
		const sha256 = await hashBlobSha256(input.blob);
		const sourceExists = await this.hasSource(sha256);

		if (!sourceExists) {
			const quotaCheck = await checkQuotaForImport(
				input.blob.size,
				this.#storageManager,
			);
			if (!quotaCheck.ok) {
				throw new StorageQuotaError(
					`Insufficient storage quota for ${input.blob.size} byte image`,
				);
			}
		}

		const now = this.#now();
		const projectId = generateId();
		const initialStack = createEmptyStack();
		const mimeType =
			input.mimeType || input.blob.type || 'application/octet-stream';
		const shouldActivate = input.setActive ?? true;

		return runTransaction(
			this.#db,
			[
				STORE_NAMES.sources,
				STORE_NAMES.projects,
				STORE_NAMES.history,
				STORE_NAMES.meta,
			],
			'readwrite',
			async (tx) => {
				const sourcesStore = tx.objectStore(STORE_NAMES.sources);
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const historyStore = tx.objectStore(STORE_NAMES.history);
				const metaStore = tx.objectStore(STORE_NAMES.meta);

				const existingSource = (await requestToPromise(
					sourcesStore.get(sha256),
				)) as SourceRecord | undefined;

				let source: SourceRecord;
				let deduplicated: boolean;
				if (existingSource) {
					source = existingSource;
					deduplicated = true;
				} else {
					source = {
						sha256,
						blob: input.blob,
						mimeType,
						byteLength: input.blob.size,
						width: input.width,
						height: input.height,
						createdAt: now,
					};
					await requestToPromise(sourcesStore.put(source));
					deduplicated = false;
				}

				const project: ProjectRecord = {
					id: projectId,
					name,
					sourceHash: sha256,
					referencedSourceHashes: [sha256],
					sourceWidth: input.width,
					sourceHeight: input.height,
					transform: IDENTITY_TRANSFORM,
					effectiveWidth: input.width,
					effectiveHeight: input.height,
					stack: initialStack,
					selectedInstanceId: null,
					historyHeadSeq: 0,
					historyMinSeq: 0,
					historyMaxSeq: 0,
					viewState: createDefaultViewState(input.width, input.height),
					exportSettings: createDefaultExportSettings(),
					createdAt: now,
					updatedAt: now,
					openedAt: now,
				};

				const initialHistory: HistoryEntryRecord = {
					projectId,
					seq: 0,
					label: 'Initial',
					stack: initialStack,
					selectedInstanceId: null,
					transform: IDENTITY_TRANSFORM,
					createdAt: now,
				};

				await requestToPromise(projectsStore.put(project));
				await requestToPromise(historyStore.put(initialHistory));

				if (shouldActivate) {
					const existingAppState = (await requestToPromise(
						metaStore.get('appState'),
					)) as AppStateRecord | undefined;
					const nextAppState: AppStateRecord = {
						...(existingAppState ?? createDefaultAppState()),
						key: 'appState',
						activeProjectId: projectId,
					};
					await requestToPromise(metaStore.put(nextAppState));
				}

				return {project, source, deduplicated};
			},
		);
	}

	async listProjects(): Promise<ProjectRecord[]> {
		return runTransaction(this.#db, STORE_NAMES.projects, 'readonly', (tx) => {
			const index = tx.objectStore(STORE_NAMES.projects).index('byOpenedAt');
			return readIndexDescending<ProjectRecord>(index);
		});
	}

	async getProject(id: string): Promise<ProjectRecord | undefined> {
		return runTransaction(
			this.#db,
			STORE_NAMES.projects,
			'readonly',
			async (tx) =>
				(await requestToPromise(
					tx.objectStore(STORE_NAMES.projects).get(id),
				)) as ProjectRecord | undefined,
		);
	}

	async getSource(sha256: string): Promise<SourceRecord | undefined> {
		return runTransaction(
			this.#db,
			STORE_NAMES.sources,
			'readonly',
			async (tx) =>
				(await requestToPromise(
					tx.objectStore(STORE_NAMES.sources).get(sha256),
				)) as SourceRecord | undefined,
		);
	}

	async hasSource(sha256: string): Promise<boolean> {
		return runTransaction(
			this.#db,
			STORE_NAMES.sources,
			'readonly',
			async (tx) => {
				const count = await requestToPromise(
					tx.objectStore(STORE_NAMES.sources).count(sha256),
				);
				return count > 0;
			},
		);
	}

	async openProject(id: string): Promise<ProjectRecord> {
		const now = this.#now();
		return runTransaction(
			this.#db,
			[STORE_NAMES.projects, STORE_NAMES.meta],
			'readwrite',
			async (tx) => {
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const metaStore = tx.objectStore(STORE_NAMES.meta);
				const existing = (await requestToPromise(projectsStore.get(id))) as
					ProjectRecord | undefined;
				if (!existing) {
					throw new StorageNotFoundError(`Project "${id}" not found`);
				}

				const updated: ProjectRecord = {
					...existing,
					openedAt: now,
				};
				await requestToPromise(projectsStore.put(updated));

				const existingAppState = (await requestToPromise(
					metaStore.get('appState'),
				)) as AppStateRecord | undefined;
				const nextAppState: AppStateRecord = {
					...(existingAppState ?? createDefaultAppState()),
					key: 'appState',
					activeProjectId: id,
				};
				await requestToPromise(metaStore.put(nextAppState));

				return updated;
			},
		);
	}

	async closeActiveProject(): Promise<AppStateRecord> {
		return this.updateAppState({activeProjectId: null});
	}

	async renameProject(id: string, rawName: string): Promise<ProjectRecord> {
		const name = validateProjectName(rawName);
		const now = this.#now();
		return runTransaction(
			this.#db,
			STORE_NAMES.projects,
			'readwrite',
			async (tx) => {
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const existing = (await requestToPromise(projectsStore.get(id))) as
					ProjectRecord | undefined;
				if (!existing) {
					throw new StorageNotFoundError(`Project "${id}" not found`);
				}

				const updated: ProjectRecord = {
					...existing,
					name,
					updatedAt: now,
				};
				await requestToPromise(projectsStore.put(updated));
				return updated;
			},
		);
	}

	async duplicateProject(id: string): Promise<ProjectRecord> {
		const now = this.#now();
		const newId = generateId();
		return runTransaction(
			this.#db,
			[STORE_NAMES.projects, STORE_NAMES.history, STORE_NAMES.thumbnails],
			'readwrite',
			async (tx) => {
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const historyStore = tx.objectStore(STORE_NAMES.history);
				const thumbnailsStore = tx.objectStore(STORE_NAMES.thumbnails);

				const existing = (await requestToPromise(projectsStore.get(id))) as
					ProjectRecord | undefined;
				if (!existing) {
					throw new StorageNotFoundError(`Project "${id}" not found`);
				}

				const size = resolveStoredGeometry(
					existing.sourceWidth,
					existing.sourceHeight,
					existing.transform,
				);
				const historyRows = await readHistory(tx, id);
				const copy: ProjectRecord = {
					...existing,
					referencedSourceHashes: referencedSourceHashes(existing, historyRows),
					id: newId,
					name: createDuplicateProjectName(existing.name),
					viewState: createDefaultViewState(
						size.effectiveWidth,
						size.effectiveHeight,
					),
					createdAt: now,
					updatedAt: now,
					openedAt: now,
				};
				await requestToPromise(projectsStore.put(copy));

				for (const row of historyRows) {
					await requestToPromise(
						historyStore.put({
							...row,
							projectId: newId,
						}),
					);
				}

				const thumbnail = (await requestToPromise(thumbnailsStore.get(id))) as
					ThumbnailRecord | undefined;
				if (thumbnail) {
					await requestToPromise(
						thumbnailsStore.put({
							...thumbnail,
							projectId: newId,
						}),
					);
				}

				return copy;
			},
		);
	}

	async deleteProject(id: string): Promise<DeleteProjectResult> {
		return runTransaction(
			this.#db,
			[
				STORE_NAMES.projects,
				STORE_NAMES.history,
				STORE_NAMES.thumbnails,
				STORE_NAMES.sources,
				STORE_NAMES.meta,
			],
			'readwrite',
			async (tx) => {
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const historyStore = tx.objectStore(STORE_NAMES.history);
				const thumbnailsStore = tx.objectStore(STORE_NAMES.thumbnails);
				const metaStore = tx.objectStore(STORE_NAMES.meta);

				const existing = (await requestToPromise(projectsStore.get(id))) as
					ProjectRecord | undefined;
				if (!existing) {
					return {deleted: false, sourceDeleted: false};
				}

				await requestToPromise(projectsStore.delete(id));
				await requestToPromise(
					historyStore.delete(
						this.#keyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
					),
				);
				await requestToPromise(thumbnailsStore.delete(id));

				const appState = (await requestToPromise(metaStore.get('appState'))) as
					AppStateRecord | undefined;
				if (appState?.activeProjectId === id) {
					await requestToPromise(
						metaStore.put({
							...appState,
							activeProjectId: null,
						}),
					);
				}

				const removed = await deleteUnreferencedSources(
					tx,
					existing.referencedSourceHashes,
				);
				return {
					deleted: true,
					sourceDeleted: removed.includes(existing.sourceHash),
				};
			},
		);
	}

	async exportProjectFile(
		projectId: string,
		options: ExportProjectOptions = {},
	): Promise<ProjectFileOutput> {
		const includeHistory = options.includeHistory ?? true;
		// One transaction, so the project and its history agree.
		const snapshot = await runTransaction(
			this.#db,
			[
				STORE_NAMES.projects,
				STORE_NAMES.sources,
				STORE_NAMES.history,
				STORE_NAMES.thumbnails,
			],
			'readonly',
			async (tx) => {
				const project = (await requestToPromise(
					tx.objectStore(STORE_NAMES.projects).get(projectId),
				)) as ProjectRecord | undefined;
				if (!project) {
					throw new StorageNotFoundError(`Project "${projectId}" not found`);
				}

				const history = includeHistory
					? await readHistory(tx, projectId)
					: undefined;
				const sources = await readSources(
					tx,
					projectSourceHashes(project, history),
				);
				const thumbnail = (await requestToPromise(
					tx.objectStore(STORE_NAMES.thumbnails).get(projectId),
				)) as ThumbnailRecord | undefined;
				return {project, sources, history, thumbnail};
			},
		);
		return writeProjectArchive(snapshot, options, this.#transfer);
	}

	async importProjectFile(
		file: Blob,
		fileName: string,
		options: ImportProjectOptions = {},
	): Promise<CreateProjectResult> {
		const prepared = await prepareProjectImport(
			file,
			fileName,
			options,
			this.#transfer,
			async (sha256) => this.getSource(sha256),
		);
		if (prepared.newSourceBytes > 0) {
			await this.#requireQuota(prepared.newSourceBytes);
		}

		options.signal?.throwIfAborted();
		const now = this.#now();
		const projectId = generateId();

		return runTransaction(
			this.#db,
			[
				STORE_NAMES.sources,
				STORE_NAMES.projects,
				STORE_NAMES.history,
				STORE_NAMES.thumbnails,
				STORE_NAMES.meta,
			],
			'readwrite',
			async (tx) => {
				const sourcesStore = tx.objectStore(STORE_NAMES.sources);
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const historyStore = tx.objectStore(STORE_NAMES.history);
				const metaStore = tx.objectStore(STORE_NAMES.meta);

				const sources: SourceRecord[] = [];
				let deduplicated = false;
				for (const [index, entry] of prepared.contents.sources.entries()) {
					const existing = (await requestToPromise(
						sourcesStore.get(entry.sha256),
					)) as SourceRecord | undefined;
					const source = existing ?? toSourceRecord(entry, now);
					if (!existing) {
						await requestToPromise(sourcesStore.put(source));
					}

					deduplicated ||= index === 0 && existing !== undefined;
					sources.push(source);
				}

				const others = (await requestToPromise(
					projectsStore.getAll(),
				)) as ProjectRecord[];
				const {project, history, thumbnail} = buildImportedProject(prepared, {
					projectId,
					existingNames: others.map((other) => other.name),
					now,
				});
				await requestToPromise(projectsStore.put(project));
				for (const entry of history) {
					await requestToPromise(historyStore.put(entry));
				}

				if (thumbnail) {
					await requestToPromise(
						tx.objectStore(STORE_NAMES.thumbnails).put(thumbnail),
					);
				}

				if (options.setActive ?? true) {
					const appState = (await requestToPromise(
						metaStore.get('appState'),
					)) as AppStateRecord | undefined;
					await requestToPromise(
						metaStore.put({
							...(appState ?? createDefaultAppState()),
							key: 'appState',
							activeProjectId: projectId,
						}),
					);
				}

				return {project, source: sources[0], deduplicated};
			},
		);
	}

	async exportBackup(options: ExportBackupOptions = {}): Promise<BackupOutput> {
		const {signal, onProgress} = options;
		onProgress?.({stage: 'reading', fraction: 0});
		// One transaction, so the records agree.
		const snapshot = await runTransaction(
			this.#db,
			[
				STORE_NAMES.projects,
				STORE_NAMES.sources,
				STORE_NAMES.history,
				STORE_NAMES.thumbnails,
				STORE_NAMES.presets,
				STORE_NAMES.meta,
			],
			'readonly',
			async (tx) => {
				const all = await readIndexDescending<ProjectRecord>(
					tx.objectStore(STORE_NAMES.projects).index('byOpenedAt'),
				);
				const {projects, scope} = chooseBackupProjects(all, options.projectIds);
				const includesHistory = options.includeHistory ?? true;
				const items: Array<BackupInput['projects'][number]> = [];
				for (const [index, project] of projects.entries()) {
					const history = includesHistory
						? await readHistory(tx, project.id)
						: undefined;
					const thumbnail = (await requestToPromise(
						tx.objectStore(STORE_NAMES.thumbnails).get(project.id),
					)) as ThumbnailRecord | undefined;
					items.push({project, history, thumbnail: thumbnail?.blob});
					onProgress?.({
						stage: 'reading',
						fraction: (index + 1) / projects.length,
					});
				}

				const sources = await readSources(
					tx,
					new Set(
						items.flatMap(({project, history}) =>
							backupSourceHashes(project, history),
						),
					),
				);

				const presets =
					(options.includePresets ?? true)
						? ((await requestToPromise(
								tx
									.objectStore(STORE_NAMES.presets)
									.index('byNameLower')
									.getAll(),
							)) as UserPresetRecord[])
						: undefined;
				let settings: BackupInput['settings'];
				if (options.includeSettings ?? true) {
					const {theme, compareMode} =
						((await requestToPromise(
							tx.objectStore(STORE_NAMES.meta).get('appState'),
						)) as AppStateRecord | undefined) ?? createDefaultAppState();
					settings = {theme, compareMode};
				}

				return {
					scope,
					includesHistory,
					projects: items,
					sources,
					presets,
					settings,
				};
			},
			signal,
		);
		return writeBackupArchive(snapshot, options, this.#transfer);
	}

	async getSourceSizes(): Promise<Record<string, number>> {
		return runTransaction(
			this.#db,
			STORE_NAMES.sources,
			'readonly',
			async (tx) => {
				const sources = (await requestToPromise(
					tx.objectStore(STORE_NAMES.sources).getAll(),
				)) as SourceRecord[];
				return Object.fromEntries(
					sources.map((source) => [source.sha256, source.byteLength]),
				);
			},
		);
	}

	async inspectBackup(
		file: Blob,
		options: BackupOptions = {},
	): Promise<BackupInspection> {
		return inspectBackupArchive(file, options, this.#transfer, {
			findSource: async (sha256) => this.getSource(sha256),
			read: async () => this.getStartupSnapshot(),
		});
	}

	async importBackup(
		backup: BackupInspection,
		selection: BackupSelection,
		options: BackupOptions = {},
	): Promise<BackupImportResult> {
		return runBackupImport(this.#backupStore(), backup, selection, options, {
			now: this.#now,
			createId: generateId,
		});
	}

	async commitStack(input: CommitStackInput): Promise<CommitStackResult> {
		validateStackForWrite(input.stack);
		if (input.stackA) {
			validateStackForWrite(input.stackA);
		}

		const {newSource} = input;
		if (newSource) {
			validateImageDimensions(newSource.width, newSource.height);
			if (!(await this.hasSource(newSource.sha256))) {
				await this.#requireQuota(newSource.blob.size);
			}
		}

		const now = this.#now();

		return runTransaction(
			this.#db,
			[STORE_NAMES.projects, STORE_NAMES.history, STORE_NAMES.sources],
			'readwrite',
			async (tx) => {
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const historyStore = tx.objectStore(STORE_NAMES.history);

				const existing = (await requestToPromise(
					projectsStore.get(input.projectId),
				)) as ProjectRecord | undefined;
				if (!existing) {
					throw new StorageNotFoundError(
						`Project "${input.projectId}" not found`,
					);
				}

				// Validated first, so a rejected commit leaves history alone.
				const geometry = commitGeometry(existing, input.transform);
				const stackA = input.stackA ?? existing.stackA;
				const next = {stack: input.stack, stackA};
				const added = addedSourceReferences(existing, next);
				const record = newSource && newSourceRecord(newSource, next, now);
				if (record) {
					await storeSourceOnce(tx, record);
				}

				await requireSources(tx, added);
				await requestToPromise(
					historyStore.delete(
						this.#keyRange.bound(
							[input.projectId, existing.historyHeadSeq + 1],
							[input.projectId, Number.MAX_SAFE_INTEGER],
						),
					),
				);

				const nextSeq = existing.historyHeadSeq + 1;
				const selectedInstanceIdA =
					input.selectedInstanceIdA === undefined
						? existing.selectedInstanceIdA
						: input.selectedInstanceIdA;
				const entry = withSideA<HistoryEntryRecord>(
					{
						projectId: input.projectId,
						seq: nextSeq,
						label: input.label,
						stack: input.stack,
						selectedInstanceId: input.selectedInstanceId,
						transform: geometry.transform,
						createdAt: now,
					},
					stackA,
					selectedInstanceIdA,
				);
				await requestToPromise(historyStore.put(entry));

				let nextMinSeq = existing.historyMinSeq;
				const retainedCount = nextSeq - nextMinSeq + 1;
				if (retainedCount > MAX_HISTORY_ENTRIES) {
					nextMinSeq = nextSeq - MAX_HISTORY_ENTRIES + 1;
					await requestToPromise(
						historyStore.delete(
							this.#keyRange.bound(
								[input.projectId, 0],
								[input.projectId, nextMinSeq - 1],
							),
						),
					);
				}

				const updated = withSideA<ProjectRecord>(
					{
						...existing,
						...geometry,
						stack: input.stack,
						selectedInstanceId: input.selectedInstanceId,
						historyHeadSeq: nextSeq,
						historyMinSeq: nextMinSeq,
						historyMaxSeq: nextSeq,
						updatedAt: now,
					},
					stackA,
					selectedInstanceIdA,
				);
				updated.referencedSourceHashes = referencedSourceHashes(
					updated,
					await readHistory(tx, input.projectId),
				);
				await requestToPromise(projectsStore.put(updated));

				return {project: updated, entry};
			},
		);
	}

	async saveProjectStack(
		id: string,
		stack: EffectStack,
		selectedInstanceId?: string | null,
	): Promise<ProjectRecord> {
		validateStackForWrite(stack);
		const now = this.#now();
		return runTransaction(
			this.#db,
			[STORE_NAMES.projects, STORE_NAMES.history, STORE_NAMES.sources],
			'readwrite',
			async (tx) => {
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const existing = (await requestToPromise(projectsStore.get(id))) as
					ProjectRecord | undefined;
				if (!existing) {
					throw new StorageNotFoundError(`Project "${id}" not found`);
				}

				await requireSources(
					tx,
					addedSourceReferences(existing, {stack, stackA: existing.stackA}),
				);
				const updated: ProjectRecord = {
					...existing,
					stack,
					selectedInstanceId:
						selectedInstanceId === undefined
							? existing.selectedInstanceId
							: selectedInstanceId,
					updatedAt: now,
				};
				updated.referencedSourceHashes = referencedSourceHashes(
					updated,
					await readHistory(tx, id),
				);
				await requestToPromise(projectsStore.put(updated));
				return updated;
			},
		);
	}

	async undo(projectId: string): Promise<HistoryStepResult | null> {
		return this.#moveHistoryHead(
			projectId,
			(project) => project.historyHeadSeq - 1,
		);
	}

	async redo(projectId: string): Promise<HistoryStepResult | null> {
		return this.#moveHistoryHead(
			projectId,
			(project) => project.historyHeadSeq + 1,
		);
	}

	async jumpToHistory(
		projectId: string,
		seq: number,
	): Promise<HistoryStepResult | null> {
		return this.#moveHistoryHead(projectId, () => seq);
	}

	async getHistory(projectId: string): Promise<HistoryEntryRecord[]> {
		return runTransaction(
			this.#db,
			STORE_NAMES.history,
			'readonly',
			async (tx) => {
				const rows = await readHistory(tx, projectId);
				return rows.toSorted((a, b) => a.seq - b.seq);
			},
		);
	}

	async getHistoryEntry(
		projectId: string,
		seq: number,
	): Promise<HistoryEntryRecord | undefined> {
		return runTransaction(
			this.#db,
			STORE_NAMES.history,
			'readonly',
			async (tx) =>
				(await requestToPromise(
					tx.objectStore(STORE_NAMES.history).get([projectId, seq]),
				)) as HistoryEntryRecord | undefined,
		);
	}

	async updateViewState(
		id: string,
		viewState: ViewState,
		selectedInstanceId?: string | null,
		selectedInstanceIdA?: string | null,
	): Promise<ProjectRecord> {
		const normalized = normalizeViewState(viewState);
		return runTransaction(
			this.#db,
			STORE_NAMES.projects,
			'readwrite',
			async (tx) => {
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const existing = (await requestToPromise(projectsStore.get(id))) as
					ProjectRecord | undefined;
				if (!existing) {
					throw new StorageNotFoundError(`Project "${id}" not found`);
				}

				const updated = withSideA<ProjectRecord>(
					{
						...existing,
						viewState: normalized,
						selectedInstanceId:
							selectedInstanceId === undefined
								? existing.selectedInstanceId
								: selectedInstanceId,
					},
					existing.stackA,
					selectedInstanceIdA === undefined
						? existing.selectedInstanceIdA
						: selectedInstanceIdA,
				);
				await requestToPromise(projectsStore.put(updated));
				return updated;
			},
		);
	}

	async updateExportSettings(
		id: string,
		exportSettings: ExportSettings,
	): Promise<ProjectRecord> {
		const normalized = normalizeExportSettings(exportSettings);
		return runTransaction(
			this.#db,
			STORE_NAMES.projects,
			'readwrite',
			async (tx) => {
				const projectsStore = tx.objectStore(STORE_NAMES.projects);
				const existing = (await requestToPromise(projectsStore.get(id))) as
					ProjectRecord | undefined;
				if (!existing) {
					throw new StorageNotFoundError(`Project "${id}" not found`);
				}

				const updated: ProjectRecord = {
					...existing,
					exportSettings: normalized,
				};
				await requestToPromise(projectsStore.put(updated));
				return updated;
			},
		);
	}

	async getThumbnail(projectId: string): Promise<ThumbnailRecord | undefined> {
		return runTransaction(
			this.#db,
			STORE_NAMES.thumbnails,
			'readonly',
			async (tx) =>
				(await requestToPromise(
					tx.objectStore(STORE_NAMES.thumbnails).get(projectId),
				)) as ThumbnailRecord | undefined,
		);
	}

	async putThumbnail(thumbnail: ThumbnailRecord): Promise<void> {
		await runTransaction(
			this.#db,
			STORE_NAMES.thumbnails,
			'readwrite',
			async (tx) => {
				await requestToPromise(
					tx.objectStore(STORE_NAMES.thumbnails).put(thumbnail),
				);
			},
		);
	}

	async deleteThumbnail(projectId: string): Promise<void> {
		await runTransaction(
			this.#db,
			STORE_NAMES.thumbnails,
			'readwrite',
			async (tx) => {
				await requestToPromise(
					tx.objectStore(STORE_NAMES.thumbnails).delete(projectId),
				);
			},
		);
	}

	async listPresets(): Promise<UserPresetRecord[]> {
		return runTransaction(
			this.#db,
			STORE_NAMES.presets,
			'readonly',
			async (tx) =>
				(await requestToPromise(
					tx.objectStore(STORE_NAMES.presets).index('byNameLower').getAll(),
				)) as UserPresetRecord[],
		);
	}

	async getPreset(id: string): Promise<UserPresetRecord | undefined> {
		return runTransaction(
			this.#db,
			STORE_NAMES.presets,
			'readonly',
			async (tx) =>
				(await requestToPromise(
					tx.objectStore(STORE_NAMES.presets).get(id),
				)) as UserPresetRecord | undefined,
		);
	}

	async createPreset(input: CreatePresetInput): Promise<UserPresetRecord> {
		const name = validatePresetName(input.name);
		validateStackForWrite(input.stack);
		const now = this.#now();
		const preset: UserPresetRecord = {
			id: `user:${generateId()}`,
			name,
			nameLower: name.toLocaleLowerCase('en'),
			stack: stripSourceReferences(input.stack),
			createdAt: now,
			updatedAt: now,
		};

		await runTransaction(
			this.#db,
			STORE_NAMES.presets,
			'readwrite',
			async (tx) => {
				await requestToPromise(tx.objectStore(STORE_NAMES.presets).put(preset));
			},
		);

		return preset;
	}

	async renamePreset(id: string, rawName: string): Promise<UserPresetRecord> {
		const name = validatePresetName(rawName);
		const now = this.#now();
		return runTransaction(
			this.#db,
			STORE_NAMES.presets,
			'readwrite',
			async (tx) => {
				const presetsStore = tx.objectStore(STORE_NAMES.presets);
				const existing = (await requestToPromise(presetsStore.get(id))) as
					UserPresetRecord | undefined;
				if (!existing) {
					throw new StorageNotFoundError(`Preset "${id}" not found`);
				}

				const updated: UserPresetRecord = {
					...existing,
					name,
					nameLower: name.toLocaleLowerCase('en'),
					updatedAt: now,
				};
				await requestToPromise(presetsStore.put(updated));
				return updated;
			},
		);
	}

	async deletePreset(id: string): Promise<boolean> {
		return runTransaction(
			this.#db,
			STORE_NAMES.presets,
			'readwrite',
			async (tx) => {
				const presetsStore = tx.objectStore(STORE_NAMES.presets);
				const count = await requestToPromise(presetsStore.count(id));
				if (count === 0) {
					return false;
				}

				await requestToPromise(presetsStore.delete(id));
				return true;
			},
		);
	}

	async getAppState(): Promise<AppStateRecord> {
		return runTransaction(
			this.#db,
			STORE_NAMES.meta,
			'readonly',
			async (tx) => {
				const existing = (await requestToPromise(
					tx.objectStore(STORE_NAMES.meta).get('appState'),
				)) as AppStateRecord | undefined;
				return existing ?? createDefaultAppState();
			},
		);
	}

	async updateAppState(
		patch: Partial<Omit<AppStateRecord, 'key'>>,
	): Promise<AppStateRecord> {
		return runTransaction(
			this.#db,
			STORE_NAMES.meta,
			'readwrite',
			async (tx) => {
				const metaStore = tx.objectStore(STORE_NAMES.meta);
				const existing = (await requestToPromise(metaStore.get('appState'))) as
					AppStateRecord | undefined;
				const updated: AppStateRecord = {
					...(existing ?? createDefaultAppState()),
					...patch,
					key: 'appState',
				};
				await requestToPromise(metaStore.put(updated));
				return updated;
			},
		);
	}

	async getStartupSnapshot(): Promise<StartupSnapshot> {
		return runTransaction(
			this.#db,
			[STORE_NAMES.meta, STORE_NAMES.projects, STORE_NAMES.presets],
			'readonly',
			async (tx) => {
				const [appStateRaw, projects, presets] = await Promise.all([
					requestToPromise(
						tx.objectStore(STORE_NAMES.meta).get('appState'),
					) as Promise<AppStateRecord | undefined>,
					readIndexDescending<ProjectRecord>(
						tx.objectStore(STORE_NAMES.projects).index('byOpenedAt'),
					),
					requestToPromise(
						tx.objectStore(STORE_NAMES.presets).index('byNameLower').getAll(),
					) as Promise<UserPresetRecord[]>,
				]);

				return {
					appState: appStateRaw ?? createDefaultAppState(),
					projects,
					presets,
				};
			},
		);
	}

	async getSchemaInfo(): Promise<SchemaInfoRecord | undefined> {
		return runTransaction(
			this.#db,
			STORE_NAMES.meta,
			'readonly',
			async (tx) =>
				(await requestToPromise(
					tx.objectStore(STORE_NAMES.meta).get('schemaInfo'),
				)) as SchemaInfoRecord | undefined,
		);
	}

	async cleanupOrphanedSources(): Promise<number> {
		return runTransaction(
			this.#db,
			[STORE_NAMES.sources, STORE_NAMES.projects],
			'readwrite',
			async (tx) => {
				const keys = (await requestToPromise(
					tx.objectStore(STORE_NAMES.sources).getAllKeys(),
				)) as string[];
				return (await deleteUnreferencedSources(tx, keys)).length;
			},
		);
	}

	close(): void {
		this.#db.close();
	}
}
