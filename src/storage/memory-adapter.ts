import {IDENTITY_TRANSFORM} from '../engine/transform.ts';
import type {EffectStack} from '../engine/types.ts';
import {commitGeometry, resolveStoredGeometry} from './geometry.ts';
import {
	cloneRecord,
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
import {
	DB_VERSION,
	MAX_HISTORY_ENTRIES,
	StorageNotFoundError,
	type AppStateRecord,
	type CommitStackInput,
	type CommitStackResult,
	type CreatePresetInput,
	type CreateProjectInput,
	type CreateProjectResult,
	type DeleteProjectResult,
	type ExportSettings,
	type HistoryEntryRecord,
	type HistoryStepResult,
	type ProjectRecord,
	type SchemaInfoRecord,
	type SourceRecord,
	type StartupSnapshot,
	type StorageRepository,
	type ThumbnailRecord,
	type UserPresetRecord,
	type ViewState,
} from './types.ts';

export type MemoryStorageAdapterOptions = {
	now?: () => number;
};

export class MemoryStorageAdapter implements StorageRepository {
	readonly #sources = new Map<string, SourceRecord>();
	readonly #projects = new Map<string, ProjectRecord>();
	readonly #thumbnails = new Map<string, ThumbnailRecord>();
	readonly #history = new Map<string, Map<number, HistoryEntryRecord>>();
	readonly #presets = new Map<string, UserPresetRecord>();
	#appState: AppStateRecord = createDefaultAppState();
	readonly #schemaInfo: SchemaInfoRecord;
	readonly #now: () => number;

	constructor(options: MemoryStorageAdapterOptions = {}) {
		this.#now = options.now ?? (() => Date.now());
		this.#schemaInfo = {
			key: 'schemaInfo',
			dbVersion: DB_VERSION,
			migratedAt: this.#now(),
		};
	}

	#moveHistoryHead(
		projectId: string,
		resolveSeq: (project: ProjectRecord) => number,
	): HistoryStepResult | null {
		const existing = this.#projects.get(projectId);
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

		const entry = this.#history.get(projectId)?.get(targetSeq);
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
				stack: cloneRecord(entry.stack),
				selectedInstanceId: entry.selectedInstanceId,
				historyHeadSeq: entry.seq,
				updatedAt: this.#now(),
			},
			entry.stackA && cloneRecord(entry.stackA),
			entry.selectedInstanceIdA,
		);
		this.#projects.set(projectId, updated);

		return {
			project: cloneRecord(updated),
			entry: cloneRecord(entry),
		};
	}

	async createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
		validateImageDimensions(input.width, input.height);
		const name = normalizeImportProjectName(
			input.name,
			input.stripExtension ?? true,
		);
		const sha256 = await hashBlobSha256(input.blob);
		const now = this.#now();
		const projectId = generateId();
		const initialStack = createEmptyStack();
		const mimeType =
			input.mimeType || input.blob.type || 'application/octet-stream';
		const shouldActivate = input.setActive ?? true;

		const existingSource = this.#sources.get(sha256);
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
			this.#sources.set(sha256, source);
			deduplicated = false;
		}

		const project: ProjectRecord = {
			id: projectId,
			name,
			sourceHash: sha256,
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
			stack: cloneRecord(initialStack),
			selectedInstanceId: null,
			transform: IDENTITY_TRANSFORM,
			createdAt: now,
		};

		this.#projects.set(projectId, cloneRecord(project));
		const projectHistory = new Map<number, HistoryEntryRecord>();
		projectHistory.set(0, cloneRecord(initialHistory));
		this.#history.set(projectId, projectHistory);

		if (shouldActivate) {
			this.#appState = {
				...this.#appState,
				key: 'appState',
				activeProjectId: projectId,
			};
		}

		return {
			project: cloneRecord(project),
			source: {...source},
			deduplicated,
		};
	}

	async listProjects(): Promise<ProjectRecord[]> {
		return [...this.#projects.values()]
			.toSorted((a, b) => b.openedAt - a.openedAt)
			.map((project) => cloneRecord(project));
	}

	async getProject(id: string): Promise<ProjectRecord | undefined> {
		const project = this.#projects.get(id);
		return project ? cloneRecord(project) : undefined;
	}

	async getSource(sha256: string): Promise<SourceRecord | undefined> {
		const source = this.#sources.get(sha256);
		return source ? {...source} : undefined;
	}

	async hasSource(sha256: string): Promise<boolean> {
		return this.#sources.has(sha256);
	}

	async openProject(id: string): Promise<ProjectRecord> {
		const existing = this.#projects.get(id);
		if (!existing) {
			throw new StorageNotFoundError(`Project "${id}" not found`);
		}

		const updated: ProjectRecord = {
			...existing,
			openedAt: this.#now(),
		};
		this.#projects.set(id, updated);
		this.#appState = {
			...this.#appState,
			key: 'appState',
			activeProjectId: id,
		};
		return cloneRecord(updated);
	}

	async closeActiveProject(): Promise<AppStateRecord> {
		return this.updateAppState({activeProjectId: null});
	}

	async renameProject(id: string, rawName: string): Promise<ProjectRecord> {
		const name = validateProjectName(rawName);
		const existing = this.#projects.get(id);
		if (!existing) {
			throw new StorageNotFoundError(`Project "${id}" not found`);
		}

		const updated: ProjectRecord = {
			...existing,
			name,
			updatedAt: this.#now(),
		};
		this.#projects.set(id, updated);
		return cloneRecord(updated);
	}

	async duplicateProject(id: string): Promise<ProjectRecord> {
		const existing = this.#projects.get(id);
		if (!existing) {
			throw new StorageNotFoundError(`Project "${id}" not found`);
		}

		const now = this.#now();
		const newId = generateId();
		const size = resolveStoredGeometry(
			existing.sourceWidth,
			existing.sourceHeight,
			existing.transform,
		);
		const copy: ProjectRecord = {
			...cloneRecord(existing),
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
		this.#projects.set(newId, copy);

		const sourceHistory = this.#history.get(id);
		const copiedHistory = new Map<number, HistoryEntryRecord>();
		if (sourceHistory) {
			for (const [seq, row] of sourceHistory) {
				copiedHistory.set(seq, {
					...cloneRecord(row),
					projectId: newId,
				});
			}
		}

		this.#history.set(newId, copiedHistory);

		const thumbnail = this.#thumbnails.get(id);
		if (thumbnail) {
			this.#thumbnails.set(newId, {
				...thumbnail,
				projectId: newId,
			});
		}

		return cloneRecord(copy);
	}

	async deleteProject(id: string): Promise<DeleteProjectResult> {
		const existing = this.#projects.get(id);
		if (!existing) {
			return {deleted: false, sourceDeleted: false};
		}

		this.#projects.delete(id);
		this.#history.delete(id);
		this.#thumbnails.delete(id);

		if (this.#appState.activeProjectId === id) {
			this.#appState = {
				...this.#appState,
				activeProjectId: null,
			};
		}

		let stillReferenced = false;
		for (const project of this.#projects.values()) {
			if (project.sourceHash === existing.sourceHash) {
				stillReferenced = true;
				break;
			}
		}

		let sourceDeleted = false;
		if (!stillReferenced) {
			this.#sources.delete(existing.sourceHash);
			sourceDeleted = true;
		}

		return {deleted: true, sourceDeleted};
	}

	async commitStack(input: CommitStackInput): Promise<CommitStackResult> {
		validateStackForWrite(input.stack);
		if (input.stackA) {
			validateStackForWrite(input.stackA);
		}

		const existing = this.#projects.get(input.projectId);
		if (!existing) {
			throw new StorageNotFoundError(`Project "${input.projectId}" not found`);
		}

		// Validated first, so a rejected transform leaves history alone.
		const geometry = commitGeometry(existing, input.transform);
		const now = this.#now();
		let projectHistory = this.#history.get(input.projectId);
		if (!projectHistory) {
			projectHistory = new Map<number, HistoryEntryRecord>();
			this.#history.set(input.projectId, projectHistory);
		}

		for (const seq of projectHistory.keys()) {
			if (seq > existing.historyHeadSeq) {
				projectHistory.delete(seq);
			}
		}

		const nextSeq = existing.historyHeadSeq + 1;
		const stackA = input.stackA ? cloneRecord(input.stackA) : existing.stackA;
		const selectedInstanceIdA =
			input.selectedInstanceIdA === undefined
				? existing.selectedInstanceIdA
				: input.selectedInstanceIdA;
		const entry = withSideA<HistoryEntryRecord>(
			{
				projectId: input.projectId,
				seq: nextSeq,
				label: input.label,
				stack: cloneRecord(input.stack),
				selectedInstanceId: input.selectedInstanceId,
				transform: geometry.transform,
				createdAt: now,
			},
			stackA,
			selectedInstanceIdA,
		);
		projectHistory.set(nextSeq, entry);

		let nextMinSeq = existing.historyMinSeq;
		const retainedCount = nextSeq - nextMinSeq + 1;
		if (retainedCount > MAX_HISTORY_ENTRIES) {
			nextMinSeq = nextSeq - MAX_HISTORY_ENTRIES + 1;
			for (const seq of projectHistory.keys()) {
				if (seq < nextMinSeq) {
					projectHistory.delete(seq);
				}
			}
		}

		const updated = withSideA<ProjectRecord>(
			{
				...existing,
				...geometry,
				stack: cloneRecord(input.stack),
				selectedInstanceId: input.selectedInstanceId,
				historyHeadSeq: nextSeq,
				historyMinSeq: nextMinSeq,
				historyMaxSeq: nextSeq,
				updatedAt: now,
			},
			stackA,
			selectedInstanceIdA,
		);
		this.#projects.set(input.projectId, updated);

		return {
			project: cloneRecord(updated),
			entry: cloneRecord(entry),
		};
	}

	async saveProjectStack(
		id: string,
		stack: EffectStack,
		selectedInstanceId?: string | null,
	): Promise<ProjectRecord> {
		validateStackForWrite(stack);
		const existing = this.#projects.get(id);
		if (!existing) {
			throw new StorageNotFoundError(`Project "${id}" not found`);
		}

		const updated: ProjectRecord = {
			...existing,
			stack: cloneRecord(stack),
			selectedInstanceId:
				selectedInstanceId === undefined
					? existing.selectedInstanceId
					: selectedInstanceId,
			updatedAt: this.#now(),
		};
		this.#projects.set(id, updated);
		return cloneRecord(updated);
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
		const projectHistory = this.#history.get(projectId);
		if (!projectHistory) {
			return [];
		}

		return [...projectHistory.values()]
			.toSorted((a, b) => a.seq - b.seq)
			.map((entry) => cloneRecord(entry));
	}

	async getHistoryEntry(
		projectId: string,
		seq: number,
	): Promise<HistoryEntryRecord | undefined> {
		const entry = this.#history.get(projectId)?.get(seq);
		return entry ? cloneRecord(entry) : undefined;
	}

	async updateViewState(
		id: string,
		viewState: ViewState,
		selectedInstanceId?: string | null,
		selectedInstanceIdA?: string | null,
	): Promise<ProjectRecord> {
		const existing = this.#projects.get(id);
		if (!existing) {
			throw new StorageNotFoundError(`Project "${id}" not found`);
		}

		const updated = withSideA<ProjectRecord>(
			{
				...existing,
				viewState: normalizeViewState(cloneRecord(viewState)),
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
		this.#projects.set(id, updated);
		return cloneRecord(updated);
	}

	async updateExportSettings(
		id: string,
		exportSettings: ExportSettings,
	): Promise<ProjectRecord> {
		const existing = this.#projects.get(id);
		if (!existing) {
			throw new StorageNotFoundError(`Project "${id}" not found`);
		}

		const updated: ProjectRecord = {
			...existing,
			exportSettings: normalizeExportSettings(cloneRecord(exportSettings)),
		};
		this.#projects.set(id, updated);
		return cloneRecord(updated);
	}

	async getThumbnail(projectId: string): Promise<ThumbnailRecord | undefined> {
		const thumbnail = this.#thumbnails.get(projectId);
		return thumbnail ? {...thumbnail} : undefined;
	}

	async putThumbnail(thumbnail: ThumbnailRecord): Promise<void> {
		this.#thumbnails.set(thumbnail.projectId, {...thumbnail});
	}

	async deleteThumbnail(projectId: string): Promise<void> {
		this.#thumbnails.delete(projectId);
	}

	async listPresets(): Promise<UserPresetRecord[]> {
		return [...this.#presets.values()]
			.toSorted((a, b) => a.nameLower.localeCompare(b.nameLower, 'en'))
			.map((preset) => cloneRecord(preset));
	}

	async getPreset(id: string): Promise<UserPresetRecord | undefined> {
		const preset = this.#presets.get(id);
		return preset ? cloneRecord(preset) : undefined;
	}

	async createPreset(input: CreatePresetInput): Promise<UserPresetRecord> {
		const name = validatePresetName(input.name);
		validateStackForWrite(input.stack);
		const now = this.#now();
		const preset: UserPresetRecord = {
			id: `user:${generateId()}`,
			name,
			nameLower: name.toLocaleLowerCase('en'),
			stack: cloneRecord(input.stack),
			createdAt: now,
			updatedAt: now,
		};
		this.#presets.set(preset.id, preset);
		return cloneRecord(preset);
	}

	async renamePreset(id: string, rawName: string): Promise<UserPresetRecord> {
		const name = validatePresetName(rawName);
		const existing = this.#presets.get(id);
		if (!existing) {
			throw new StorageNotFoundError(`Preset "${id}" not found`);
		}

		const updated: UserPresetRecord = {
			...existing,
			name,
			nameLower: name.toLocaleLowerCase('en'),
			updatedAt: this.#now(),
		};
		this.#presets.set(id, updated);
		return cloneRecord(updated);
	}

	async deletePreset(id: string): Promise<boolean> {
		return this.#presets.delete(id);
	}

	async getAppState(): Promise<AppStateRecord> {
		return cloneRecord(this.#appState);
	}

	async updateAppState(
		patch: Partial<Omit<AppStateRecord, 'key'>>,
	): Promise<AppStateRecord> {
		this.#appState = {
			...this.#appState,
			...cloneRecord(patch),
			key: 'appState',
		};
		return cloneRecord(this.#appState);
	}

	async getStartupSnapshot(): Promise<StartupSnapshot> {
		return {
			appState: await this.getAppState(),
			projects: await this.listProjects(),
			presets: await this.listPresets(),
		};
	}

	async getSchemaInfo(): Promise<SchemaInfoRecord | undefined> {
		return {...this.#schemaInfo};
	}

	async cleanupOrphanedSources(): Promise<number> {
		const referenced = new Set<string>();
		for (const project of this.#projects.values()) {
			referenced.add(project.sourceHash);
		}

		let removed = 0;
		for (const sha256 of this.#sources.keys()) {
			if (referenced.has(sha256)) {
				continue;
			}

			this.#sources.delete(sha256);
			removed++;
		}

		return removed;
	}

	close(): void {
		// Nothing to close for in-memory storage.
	}
}
