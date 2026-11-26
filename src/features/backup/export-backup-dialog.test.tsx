// @vitest-environment happy-dom
import {act} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vite-plus/test';
import {entriesOf, jsonOf} from '../../../tests/storage/project-fixtures.ts';
import {SOURCE_SIZE} from '../../../tests/storage/project-transfer-fixtures.ts';
import {
	alertText,
	button,
	checkbox,
	click,
	endDialogTest,
	isChecked,
	mount,
	pageText,
	setupStore,
	startDialogTest,
	until,
} from '../../../tests/ui/backup-dialogs.ts';
import {ExportBackupDialog} from './export-backup-dialog.tsx';
import {BackupError, backupExportMessage} from '@/storage/backup-error.ts';
import type {
	BackupOutput,
	ExportBackupOptions,
} from '@/storage/backup-format.ts';

// Alpha and Beta share one 2 KB source; Gamma has its own of 1 KB.
async function setup() {
	const context = setupStore();
	const image = (letter: string, kilobytes: number) =>
		new Blob([letter.repeat(kilobytes * 1024)], {type: 'image/png'});
	const sources = [
		['Alpha', image('a', 2)],
		['Beta', image('a', 2)],
		['Gamma', image('g', 1)],
	] as const;
	for (const [name, blob] of sources) {
		await context.store
			.getState()
			.importImage({name: `${name}.png`, blob, ...SOURCE_SIZE});
	}

	const onOpenChange = vi.fn();
	const downloadFile = vi.fn<(blob: Blob, fileName: string) => void>();
	mount(
		context,
		<ExportBackupDialog
			open
			downloadFile={downloadFile}
			onOpenChange={onOpenChange}
		/>,
	);
	await until(() => {
		expect(pageText()).toContain('Estimated image data: 3.0 KB');
	});
	return {...context, onOpenChange, downloadFile};
}

// An export that ends only when the test says so.
function heldExport(context: Awaited<ReturnType<typeof setup>>) {
	const {promise, resolve, reject} = Promise.withResolvers<BackupOutput>();
	const calls: ExportBackupOptions[] = [];
	vi.spyOn(context.repository, 'exportBackup').mockImplementation(
		async (options = {}) => {
			calls.push(options);
			return promise;
		},
	);
	return {calls, resolve, reject};
}

beforeEach(startDialogTest);
afterEach(endDialogTest);

describe('export backup dialog', () => {
	it('starts with everything checked and counts a shared image once', async () => {
		await setup();

		for (const name of [/^Alpha/, /^Beta/, /^Gamma/, 'Include undo history']) {
			expect(isChecked(name)).toBe(true);
		}

		expect(isChecked('Include user presets (0)')).toBe(true);
		expect(isChecked('Include settings')).toBe(true);

		await click(checkbox(/^Gamma/));
		expect(pageText()).toContain('Estimated image data: 2.0 KB');
		await click(checkbox(/^Beta/));
		expect(pageText()).toContain('Estimated image data: 2.0 KB');
		await click(checkbox(/^Alpha/));
		expect(pageText()).toContain('Estimated image data: 0 B');
	});

	it('downloads only the chosen projects and parts, then closes', async () => {
		const {downloadFile, onOpenChange} = await setup();

		await click(button('Select none'));
		await click(checkbox(/^Gamma/));
		await click(checkbox('Include undo history'));
		await click(checkbox('Include settings'));
		await click(button('Export backup'));
		await until(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});

		const [blob, fileName] = downloadFile.mock.calls[0];
		expect(fileName).toMatch(/^glitch-backup-\d{8}-\d{6}\.zip$/);
		const entries = await entriesOf(blob);
		const manifest = jsonOf<{
			projects: Array<{name: string}>;
			includesHistory: boolean;
			includesPresets: boolean;
			includesSettings: boolean;
		}>(entries['manifest.json']);
		expect(manifest.projects.map((project) => project.name)).toStrictEqual([
			'Gamma',
		]);
		expect(manifest).toMatchObject({
			includesHistory: false,
			includesPresets: true,
			includesSettings: false,
		});
	});

	it('has nothing to export without a project, preset or setting', async () => {
		await setup();

		await click(button('Select none'));
		expect(button('Export backup').disabled).toBe(false);
		await click(checkbox('Include settings'));
		// No presets are stored, so including them writes nothing.
		expect(button('Export backup').disabled).toBe(true);
		await click(button('Select all'));
		expect(button('Export backup').disabled).toBe(false);
	});

	it('shows the size refusal until the choice changes', async () => {
		const context = await setup();
		const message = backupExportMessage('export-too-large');
		vi.spyOn(context.repository, 'exportBackup').mockRejectedValue(
			new BackupError('export-too-large', message),
		);

		await click(button('Export backup'));

		expect(alertText()).toBe(
			"Can't export backup: it is too large (limit is 4 GB, or 200 MB per image). Select fewer projects or leave out undo history.",
		);
		expect(context.downloadFile).not.toHaveBeenCalled();
		expect(context.onOpenChange).not.toHaveBeenCalled();
		await click(checkbox('Include undo history'));
		expect(alertText()).toBeUndefined();
	});

	it('shows the stage while running and Cancel returns to the choices', async () => {
		const context = await setup();
		const held = heldExport(context);
		await click(checkbox(/^Beta/));
		await click(button('Export backup'));
		act(() => {
			held.calls[0].onProgress?.({stage: 'packing', fraction: 0.4});
		});

		const bar = document.querySelector('[role="progressbar"]');
		expect(bar?.getAttribute('aria-label')).toBe('Packing');
		expect(pageText()).toContain('40%');
		expect(checkbox(/^Alpha/).disabled).toBe(true);

		await click(button('Cancel'));
		expect(held.calls[0].signal?.aborted).toBe(true);
		expect(document.querySelector('[role="progressbar"]')).toBeNull();
		expect(isChecked(/^Beta/)).toBe(false);
		expect(context.onOpenChange).not.toHaveBeenCalled();

		// A result that arrives late downloads nothing.
		await act(async () => {
			held.resolve({blob: new Blob(), fileName: 'late.zip'});
		});
		expect(context.downloadFile).not.toHaveBeenCalled();

		await click(button('Cancel'));
		expect(context.onOpenChange).toHaveBeenCalledWith(false);
	});
});
