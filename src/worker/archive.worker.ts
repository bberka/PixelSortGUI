// Saves and opens project files and backups off the main thread
// (persistence.md sections 8.3 and 8.4).
import {BackupError} from '../storage/backup-error.ts';
import {readBackup, writeBackup} from '../storage/backup.ts';
import {ProjectFileError} from '../storage/project-file-error.ts';
import {
	readProjectFile,
	writeProjectFile,
	type ArchiveOptions,
} from '../storage/project-file.ts';
import type {ArchiveRequest, ArchiveResponse} from './protocol.ts';

type WorkerScope = {
	postMessage(message: ArchiveResponse): void;
	addEventListener(
		type: 'message',
		listener: (event: MessageEvent<ArchiveRequest>) => void,
	): void;
};

const scope = globalThis as unknown as WorkerScope;

const options: ArchiveOptions = {
	onProgress(progress) {
		scope.postMessage({type: 'progress', ...progress});
	},
};

async function run(request: ArchiveRequest): Promise<ArchiveResponse> {
	switch (request.type) {
		case 'writeProject': {
			const output = await writeProjectFile(request.input, options);
			return {type: 'projectWritten', ...output};
		}

		case 'readProject': {
			const contents = await readProjectFile(
				request.file,
				request.fileName,
				options,
			);
			return {type: 'projectRead', contents};
		}

		case 'writeBackup': {
			const output = await writeBackup(request.input, options);
			return {type: 'backupWritten', ...output};
		}

		case 'readBackup': {
			const contents = await readBackup(request.file, options);
			return {type: 'backupRead', contents};
		}
	}
}

async function handle(request: ArchiveRequest): Promise<void> {
	try {
		scope.postMessage(await run(request));
	} catch (error) {
		scope.postMessage({
			type: 'error',
			...((error instanceof ProjectFileError ||
				error instanceof BackupError) && {code: error.code}),
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

scope.addEventListener('message', (event) => {
	void handle(event.data);
});
