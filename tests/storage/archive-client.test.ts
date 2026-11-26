import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {
	openProjectFile,
	saveProjectFile,
	type ArchiveWorker,
} from '../../src/storage/archive-client.ts';
import {ProjectFileError} from '../../src/storage/project-file-error.ts';
import type {
	ArchiveRequest,
	ArchiveResponse,
} from '../../src/worker/protocol.ts';
import {noise, projectInput} from './project-fixtures.ts';

type WorkerListener = (event: {data?: unknown; message?: string}) => void;

function fakeWorker() {
	const listeners = new Map<string, WorkerListener>();
	const worker = {
		postMessage: vi.fn<(request: ArchiveRequest) => void>(),
		terminate: vi.fn(),
		addEventListener(type: string, listener: WorkerListener) {
			listeners.set(type, listener);
		},
	} satisfies ArchiveWorker;
	return {worker, listeners, createWorker: () => worker};
}

// Runs the real worker script behind the client's worker interface.
async function scriptWorker(): Promise<ArchiveWorker> {
	let script: ((event: {data: ArchiveRequest}) => void) | undefined;
	let client: WorkerListener | undefined;
	vi.resetModules();
	vi.stubGlobal(
		'addEventListener',
		(_type: string, added: (event: {data: ArchiveRequest}) => void) => {
			script = added;
		},
	);
	vi.stubGlobal('postMessage', (data: ArchiveResponse) => {
		client?.({data: structuredClone(data)});
	});
	await import('../../src/worker/archive.worker.ts');
	return {
		postMessage(request) {
			script!({data: structuredClone(request)});
		},
		terminate() {},
		addEventListener(type, listener) {
			if (type === 'message') {
				client = listener;
			}
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('archive client and worker', () => {
	it('saves and opens a project, forwarding progress', async () => {
		const progress = vi.fn();
		const saveWorker = await scriptWorker();
		const {blob, fileName} = await saveProjectFile(projectInput(), {
			createWorker: () => saveWorker,
			onProgress: progress,
		});
		expect(fileName).toMatch(/\.glproj$/);
		expect(progress).toHaveBeenLastCalledWith(
			expect.objectContaining({fraction: 1}),
		);

		const openWorker = await scriptWorker();
		const contents = await openProjectFile(blob, fileName, {
			createWorker: () => openWorker,
		});
		expect(contents.project.name).toBe('Night Drive / take 2');
	});

	it('rebuilds the codec error with its code and message', async () => {
		const worker = await scriptWorker();
		const opening = openProjectFile(new Blob([noise(100)]), 'bad.glproj', {
			createWorker: () => worker,
		});

		const error = await opening.catch((error: unknown) => error);
		expect(error).toBeInstanceOf(ProjectFileError);
		expect(error).toMatchObject({
			code: 'damaged',
			message:
				"Can't open bad.glproj: the file is damaged or not a valid project archive.",
		});
	});

	it('terminates the worker when cancelled', async () => {
		const {worker, createWorker} = fakeWorker();
		const controller = new AbortController();
		const saving = saveProjectFile(projectInput(), {
			createWorker,
			signal: controller.signal,
		});
		expect(worker.terminate).not.toHaveBeenCalled();
		controller.abort();

		await expect(saving).rejects.toMatchObject({name: 'AbortError'});
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('starts no worker when already cancelled', async () => {
		const createWorker = vi.fn();
		await expect(
			saveProjectFile(projectInput(), {
				createWorker,
				signal: AbortSignal.abort(),
			}),
		).rejects.toMatchObject({name: 'AbortError'});
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('rejects and terminates when the worker fails', async () => {
		const {worker, listeners, createWorker} = fakeWorker();
		const opening = openProjectFile(new Blob(), 'a.glproj', {createWorker});
		listeners.get('error')!({message: 'boom'});

		await expect(opening).rejects.toThrow('boom');
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
});
