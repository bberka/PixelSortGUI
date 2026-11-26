// @vitest-environment happy-dom
import {act} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vite-plus/test';
import {
	exportedBackup,
	selectAll,
} from '../../../tests/storage/backup-fixtures.ts';
import {
	alertText,
	button,
	checkbox,
	click,
	endDialogTest,
	isChecked,
	mount,
	pageText,
	row,
	setupStore,
	startDialogTest,
	until,
	type TestContext,
} from '../../../tests/ui/backup-dialogs.ts';
import {ImportBackupDialog} from './import-backup-dialog.tsx';
import {BackupError, backupImportMessage} from '@/storage/backup-error.ts';
import type {BackupOptions} from '@/storage/backup-format.ts';
import type {BackupImportResult} from '@/storage/backup-transfer.ts';
import {StorageQuotaError} from '@/storage/types.ts';

const NIGHT = /^Night Drive/;
const TWIN = /^Twin/;
const OTHER = /^Other/;

/**
 A library holding the backup's projects as: "Night Drive" renamed, "Twin" as
 it was, "Other" deleted.
 */
async function seededContext(blob: Blob, ids: Record<string, string>) {
	const context = setupStore();
	const {store} = context;
	const inspection = await store.getState().inspectBackup(blob);
	await store.getState().importBackup(inspection, selectAll(inspection));
	await store.getState().renameProject(ids.edited, 'Night Drive local');
	await store.getState().deleteProject(ids.other);
	return context;
}

async function open(context: TestContext, file: Blob) {
	const onClose = vi.fn();
	const view = mount(
		context,
		<ImportBackupDialog file={file} onClose={onClose} />,
	);
	return {onClose, ...view};
}

async function openSelection() {
	const {blob, ids} = await exportedBackup();
	const context = await seededContext(blob, ids);
	const importing = vi.spyOn(context.repository, 'importBackup');
	const view = await open(context, blob);
	await until(() => {
		expect(button('Import')).toBeDefined();
	});
	return {...context, ...view, ids, importing};
}

beforeEach(startDialogTest);
afterEach(endDialogTest);

describe('import backup dialog', () => {
	it('previews each project with its status and the mode’s default checks', async () => {
		await openSelection();

		expect(row(NIGHT).textContent).toContain('Modified locally');
		expect(row(TWIN).textContent).toContain('Unchanged');
		expect(row(OTHER).textContent).toContain('New');
		expect(row(OTHER).textContent).toMatch(/\d+ × \d+ px, \d+ KB/);
		expect(isChecked(NIGHT)).toBe(true);
		expect(isChecked(TWIN)).toBe(false);
		expect(isChecked(OTHER)).toBe(true);
		expect(isChecked('User presets (2)')).toBe(true);
		expect(isChecked('Settings (Theme, Compare mode)')).toBe(true);

		await click(button('Replace'));
		expect(isChecked(TWIN)).toBe(true);
		// A choice the user made survives a mode change.
		await click(checkbox(OTHER));
		await click(button('Merge'));
		expect(isChecked(TWIN)).toBe(false);
		expect(isChecked(OTHER)).toBe(false);
	});

	it('imports only what is checked and closes', async () => {
		const {importing, onClose, store, ids} = await openSelection();
		expect(pageText()).not.toContain('New image data to store: 0 B');

		await click(checkbox(OTHER));
		// The other two share an image this library already holds.
		expect(pageText()).toContain('New image data to store: 0 B');
		await click(checkbox('Settings (Theme, Compare mode)'));
		await click(button('Import'));
		await until(() => {
			expect(onClose).toHaveBeenCalledOnce();
		});

		expect(importing.mock.calls[0][1]).toStrictEqual({
			mode: 'merge',
			projectIds: [ids.edited],
			presets: true,
			settings: false,
		});
		expect(store.getState().notice).toBe('Imported 1 project.');
		expect(store.getState().projects.map((project) => project.name)).toContain(
			'Night Drive (imported)',
		);
	});

	it('disables Import when nothing is checked', async () => {
		await openSelection();
		for (const name of [
			NIGHT,
			OTHER,
			'User presets (2)',
			'Settings (Theme, Compare mode)',
		]) {
			await click(checkbox(name));
		}

		expect(button('Import').disabled).toBe(true);
	});

	it('asks before a Replace and imports only on confirmation', async () => {
		const {importing, onClose, store, ids} = await openSelection();
		await click(button('Replace'));
		await click(button('Import'));

		const confirmation = () => document.querySelector('[role="alertdialog"]');
		expect(confirmation()?.textContent).toContain(
			'Replace all local data?This deletes 2 existing project(s) and 2 user preset(s) on this device before importing.',
		);
		const cancel = [...confirmation()!.querySelectorAll('button')].find(
			(element) => element.textContent === 'Cancel',
		)!;
		await click(cancel);
		expect(confirmation()).toBeNull();
		expect(importing).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();

		await click(button('Import'));
		await click(
			[...confirmation()!.querySelectorAll('button')].find(
				(element) => element.textContent === 'Replace',
			)!,
		);
		await until(() => {
			expect(onClose).toHaveBeenCalledOnce();
		});
		expect(importing.mock.calls[0][1].mode).toBe('replace');
		expect(
			store
				.getState()
				.projects.map((project) => project.id)
				.toSorted(),
		).toStrictEqual(Object.values(ids).toSorted());
	});

	it('shows the exact error for a damaged file and writes nothing', async () => {
		const context = setupStore();
		const {onClose} = await open(context, new Blob(['not a zip']));
		await until(() => {
			expect(alertText()).toBeDefined();
		});

		expect(alertText()).toBe(backupImportMessage('damaged'));
		expect(context.store.getState().projects).toStrictEqual([]);
		await click(button('Close'));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it('starts over when it gets another file', async () => {
		const context = setupStore();
		const view = await open(context, new Blob(['not a zip']));
		await until(() => {
			expect(alertText()).toBeDefined();
		});
		const {blob} = await exportedBackup();

		view.render(<ImportBackupDialog file={blob} onClose={view.onClose} />);

		expect(alertText()).toBeUndefined();
		await until(() => {
			expect(isChecked(TWIN)).toBe(true);
		});
	});

	it('cancels the check and closes', async () => {
		const context = setupStore();
		let signal: AbortSignal | undefined;
		vi.spyOn(context.repository, 'inspectBackup').mockImplementation(
			async (_file, options) => {
				signal = options?.signal;
				return new Promise(() => {});
			},
		);
		const {onClose} = await open(context, new Blob(['zip']));
		await until(() => {
			expect(signal).toBeDefined();
		});
		const bar = document.querySelector('[role="progressbar"]');
		expect(bar?.getAttribute('aria-label')).toBe('Validating');

		await click(button('Cancel'));

		expect(signal?.aborted).toBe(true);
		expect(onClose).toHaveBeenCalledOnce();
	});

	// An import the test finishes by hand.
	async function runningImport() {
		const view = await openSelection();
		const {promise, resolve, reject} =
			Promise.withResolvers<BackupImportResult>();
		let options: BackupOptions | undefined;
		view.importing.mockImplementation(async (_backup, _selection, next) => {
			options = next;
			return promise;
		});
		await click(button('Import'));
		await until(() => {
			expect(options).toBeDefined();
		});
		return {...view, options: options!, resolve, reject};
	}

	it('stays open after Cancel until the import has stopped', async () => {
		const {onClose, options, reject} = await runningImport();
		act(() => {
			options.onProgress?.({stage: 'importing', fraction: 0.5});
		});
		expect(pageText()).toContain('50%');

		await click(button('Cancel'));
		expect(options.signal?.aborted).toBe(true);
		expect(onClose).not.toHaveBeenCalled();

		await act(async () => {
			reject(options.signal!.reason);
		});
		expect(onClose).toHaveBeenCalledOnce();
		expect(alertText()).toBeUndefined();
	});

	it('closes for the storage-full dialog on a full quota', async () => {
		const {onClose, reject, store} = await runningImport();

		await act(async () => {
			reject(new StorageQuotaError());
		});

		expect(onClose).toHaveBeenCalledOnce();
		expect(store.getState().storage.quotaFull).toBe(true);
	});

	it('shows an error raised while importing', async () => {
		const {onClose, reject} = await runningImport();
		const message = backupImportMessage('damaged');

		await act(async () => {
			reject(new BackupError('damaged', message));
		});

		expect(alertText()).toBe(message);
		expect(onClose).not.toHaveBeenCalled();
	});
});
