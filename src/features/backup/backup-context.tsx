import {createContext, use} from 'react';

export const IMPORT_BACKUP_LABEL = 'Import backup';
export const EXPORT_BACKUP_LABEL = 'Export backup';

/**
 Marks the app bar button that takes the focus when the control that opened a
 backup dialog is gone.
 */
export const BACKUP_FOCUS_FALLBACK = {'data-backup-focus': 'fallback'} as const;

export type BackupActions = {
	/**
	 `origin` takes the focus when the dialog closes.
	 */
	openExport(origin: HTMLElement | null): void;
	/**
	 Opens the file picker. Call it from the click that asked for it.
	 */
	chooseImport(origin: HTMLElement | null): void;
	/**
	 An import or a file check is running.
	 */
	readonly importDisabled: boolean;
	readonly dialogOpen: boolean;
};

export const BackupContext = createContext<BackupActions | null>(null);

/**
 `null` outside the app shell.
 */
export function useBackupActions(): BackupActions | null {
	return use(BackupContext);
}

export function useBackupDialogOpen(): boolean {
	return use(BackupContext)?.dialogOpen ?? false;
}
