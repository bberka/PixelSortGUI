// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {
	SOURCE_SIZE,
	transferDependencies,
} from '../../../tests/storage/project-transfer-fixtures.ts';
import {SaveProjectDialog} from './save-project-dialog.tsx';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import type {AppRuntime} from '@/state/index.ts';
import {MemoryStorageAdapter} from '@/storage/memory-adapter.ts';
import {ProjectFileError} from '@/storage/project-file-error.ts';
import type {ExportProjectOptions} from '@/storage/types.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let root: ReturnType<typeof createRoot> | undefined;

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = undefined;
	document.body.replaceChildren();
});

async function setup(
	repository = new MemoryStorageAdapter(transferDependencies()),
) {
	const test = createTestStore({repository});
	const {project} = await test.store.getState().importImage({
		name: 'drive',
		blob: makeTestBlob(),
		...SOURCE_SIZE,
	});
	const downloadFile = vi.fn<(blob: Blob, fileName: string) => void>();
	const onClose = vi.fn();
	const runtime = {
		ready: new Promise(() => {}),
		result: null,
		dispose() {},
	} as unknown as AppRuntime;
	const container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			<AppRuntimeProvider value={{runtime, bundle: test.bundle}}>
				<SaveProjectDialog
					project={project}
					downloadFile={downloadFile}
					onClose={onClose}
				/>
			</AppRuntimeProvider>,
		);
	});
	return {...test, repository, project, downloadFile, onClose};
}

function button(label: string): HTMLButtonElement {
	const match = [...document.querySelectorAll('button')].find(
		(item) => item.textContent === label,
	);
	if (!match) {
		throw new Error(`No button labelled "${label}"`);
	}

	return match;
}

async function click(element: HTMLElement): Promise<void> {
	await act(async () => {
		element.click();
	});
}

const checkbox = () =>
	document.querySelector<HTMLButtonElement>('[role="checkbox"]')!;

// A save that stays unfinished until the test ends it.
class SlowRepository extends MemoryStorageAdapter {
	signal: AbortSignal | undefined;
	finish: (() => void) | undefined;

	override async exportProjectFile(
		_id: string,
		options: ExportProjectOptions = {},
	) {
		this.signal = options.signal;
		options.onProgress?.({path: 'project.json', fraction: 0.4});
		await new Promise<void>((resolve) => {
			this.finish = resolve;
		});
		return {blob: new Blob(['file']), fileName: 'drive.glproj'};
	}
}

describe('SaveProjectDialog (F25)', () => {
	it.each([true, false])(
		'saves with undo history set to %s, then closes',
		async (includeHistory) => {
			const harness = await setup();
			const exportSpy = vi.spyOn(harness.repository, 'exportProjectFile');
			expect(checkbox().getAttribute('aria-checked')).toBe('true');
			if (!includeHistory) {
				await click(checkbox());
			}

			await click(button('Save'));
			await vi.waitFor(() => {
				expect(harness.downloadFile).toHaveBeenCalledOnce();
			});

			expect(exportSpy.mock.calls[0]?.[1]?.includeHistory).toBe(includeHistory);
			expect(harness.downloadFile.mock.calls[0]?.[1]).toMatch(
				/^drive-\d{8}-\d{6}\.glproj$/,
			);
			expect(harness.onClose).toHaveBeenCalledOnce();
		},
	);

	it('shows progress, and Cancel stops the save without a download', async () => {
		const repository = new SlowRepository(transferDependencies());
		const harness = await setup(repository);

		await click(button('Save'));
		await vi.waitFor(() => {
			expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
		});
		expect(document.body.textContent).toContain('40%');

		await click(button('Cancel'));
		expect(repository.signal?.aborted).toBe(true);
		await act(async () => {
			repository.finish?.();
		});

		expect(harness.downloadFile).not.toHaveBeenCalled();
		expect(harness.onClose).not.toHaveBeenCalled();
		expect(document.querySelector('[role="progressbar"]')).toBeNull();
		expect(button('Save').disabled).toBe(false);
	});

	it('shows a save error in the dialog', async () => {
		const harness = await setup();
		const message = "Can't save drive: its image data is missing.";
		vi.spyOn(harness.repository, 'exportProjectFile').mockRejectedValue(
			new ProjectFileError('missing-source', message),
		);

		await click(button('Save'));

		await vi.waitFor(() => {
			expect(document.querySelector('[role="alert"]')?.textContent).toBe(
				message,
			);
		});
		expect(harness.downloadFile).not.toHaveBeenCalled();
	});
});
