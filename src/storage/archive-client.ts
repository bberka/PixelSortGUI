// The main thread's side of the archive worker. It imports types only from the
// codec, so `fflate` stays in the worker chunk.
import type {ArchiveRequest, ArchiveResponse} from '../worker/protocol.ts';
import {BackupError, type BackupErrorCode} from './backup-error.ts';
import type {
	BackupContents,
	BackupInput,
	BackupOutput,
} from './backup-format.ts';
import {
	ProjectFileError,
	type ProjectFileErrorCode,
} from './project-file-error.ts';
import type {
	ArchiveOptions,
	ProjectFileContents,
	ProjectFileInput,
	ProjectFileOutput,
} from './project-file.ts';

type WorkerEvent = {data?: unknown; message?: string};

export type ArchiveWorker = {
	postMessage(request: ArchiveRequest): void;
	terminate(): void;
	addEventListener(
		type: 'message' | 'error' | 'messageerror',
		listener: (event: WorkerEvent) => void,
	): void;
};

const createArchiveWorker = (): ArchiveWorker =>
	new Worker(new URL('../worker/archive.worker.ts', import.meta.url), {
		type: 'module',
	});

export type ArchiveJobOptions = ArchiveOptions & {
	// Replaced by tests.
	createWorker?: () => ArchiveWorker;
};

type Result = Exclude<ArchiveResponse, {type: 'progress' | 'error'}>;

// The error class the codec of `request` threw, rebuilt on this side.
function jobError(
	request: ArchiveRequest,
	{code, message}: Extract<ArchiveResponse, {type: 'error'}>,
): Error {
	if (!code) {
		return new Error(message);
	}

	return request.type === 'writeBackup' || request.type === 'readBackup'
		? new BackupError(code as BackupErrorCode, message)
		: new ProjectFileError(code as ProjectFileErrorCode, message);
}

async function runJob(
	request: ArchiveRequest,
	{signal, onProgress, createWorker = createArchiveWorker}: ArchiveJobOptions,
): Promise<Result> {
	signal?.throwIfAborted();
	const worker = createWorker();
	let abort: (() => void) | undefined;
	try {
		return await new Promise<Result>((resolve, reject) => {
			abort = () => {
				reject(signal!.reason as Error);
			};

			signal?.addEventListener('abort', abort);
			worker.addEventListener('message', (event) => {
				const data = event.data as ArchiveResponse;
				if (data.type === 'progress') {
					onProgress?.({path: data.path, fraction: data.fraction});
				} else if (data.type === 'error') {
					reject(jobError(request, data));
				} else {
					resolve(data);
				}
			});
			worker.addEventListener('error', (event) => {
				reject(new Error(event.message || 'The archive worker failed'));
			});
			worker.addEventListener('messageerror', () => {
				reject(new Error('The archive worker sent an unreadable message'));
			});

			worker.postMessage(request);
		});
	} finally {
		if (abort) {
			signal?.removeEventListener('abort', abort);
		}

		worker.terminate();
	}
}

// `writeProjectFile` in a worker. Aborting terminates the worker.
export async function saveProjectFile(
	input: ProjectFileInput,
	options: ArchiveJobOptions = {},
): Promise<ProjectFileOutput> {
	const result = await runJob({type: 'writeProject', input}, options);
	if (result.type !== 'projectWritten') {
		throw new Error('The archive worker answered another request');
	}

	return {blob: result.blob, fileName: result.fileName};
}

// `readProjectFile` in a worker. Aborting terminates the worker.
export async function openProjectFile(
	file: Blob,
	fileName: string,
	options: ArchiveJobOptions = {},
): Promise<ProjectFileContents> {
	const result = await runJob({type: 'readProject', file, fileName}, options);
	if (result.type !== 'projectRead') {
		throw new Error('The archive worker answered another request');
	}

	return result.contents;
}

// `writeBackup` in a worker. Aborting terminates the worker.
export async function saveBackup(
	input: BackupInput,
	options: ArchiveJobOptions = {},
): Promise<BackupOutput> {
	const result = await runJob({type: 'writeBackup', input}, options);
	if (result.type !== 'backupWritten') {
		throw new Error('The archive worker answered another request');
	}

	return {blob: result.blob, fileName: result.fileName};
}

// `readBackup` in a worker. Aborting terminates the worker.
export async function openBackup(
	file: Blob,
	options: ArchiveJobOptions = {},
): Promise<BackupContents> {
	const result = await runJob({type: 'readBackup', file}, options);
	if (result.type !== 'backupRead') {
		throw new Error('The archive worker answered another request');
	}

	return result.contents;
}
