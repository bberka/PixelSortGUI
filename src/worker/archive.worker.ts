// Saves and opens project files off the main thread (persistence.md section 8.3).
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

async function handle(request: ArchiveRequest): Promise<void> {
	try {
		if (request.type === 'writeProject') {
			const output = await writeProjectFile(request.input, options);
			scope.postMessage({type: 'projectWritten', ...output});
			return;
		}

		const contents = await readProjectFile(
			request.file,
			request.fileName,
			options,
		);
		scope.postMessage({type: 'projectRead', contents});
	} catch (error) {
		scope.postMessage({
			type: 'error',
			...(error instanceof ProjectFileError && {code: error.code}),
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

scope.addEventListener('message', (event) => {
	void handle(event.data);
});
