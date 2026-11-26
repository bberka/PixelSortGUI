import {useMemo, useRef, useState, type ReactNode, type RefObject} from 'react';
import {
	BACKUP_FOCUS_FALLBACK,
	BackupContext,
	type BackupActions,
} from './backup-context.tsx';
import {ExportBackupDialog} from './export-backup-dialog.tsx';
import {ImportBackupDialog} from './import-backup-dialog.tsx';
import {useSharedImportFlow} from '@/features/import/import-flow.tsx';
import {useImagePicker} from '@/features/import/use-image-picker.ts';

// The control that opened the dialog, or the app bar button that stands in once
// the screen that held it is gone.
function focusTarget(
	origin: HTMLElement | null,
): RefObject<HTMLElement | null> {
	return {
		get current() {
			const {document} = globalThis;
			if (origin?.isConnected && origin !== document.body) {
				return origin;
			}

			const [[name, value]] = Object.entries(BACKUP_FOCUS_FALLBACK);
			return document.querySelector<HTMLElement>(
				`[${CSS.escape(name)}="${CSS.escape(value)}"]`,
			);
		},
	};
}

/**
 Holds both backup dialogs above the screens, so a Replace that leaves the
 editor cannot unmount them (DESIGN.md section 7.2). It needs the shell's import
 flow, which sorts the chosen files.
 */
export function BackupProvider({children}: {readonly children: ReactNode}) {
	const flow = useSharedImportFlow()!;
	const [exporting, setExporting] = useState<{
		origin: HTMLElement | null;
	} | null>(null);
	const originRef = useRef<HTMLElement | null>(null);
	const picker = useImagePicker(([file]) => {
		flow.startBackup(file, originRef.current);
	});

	// A refused file of the same batch is reported first.
	const backup = flow.problems.length === 0 ? flow.backup : null;
	const importDisabled = flow.busy;
	const dialogOpen = exporting !== null || flow.backup !== null;
	const {inputRef} = picker;
	const actions = useMemo<BackupActions>(
		() => ({
			openExport(origin) {
				setExporting({origin});
			},
			chooseImport(origin) {
				originRef.current = origin;
				inputRef.current?.click();
			},
			importDisabled,
			dialogOpen,
		}),
		[inputRef, importDisabled, dialogOpen],
	);

	return (
		<BackupContext value={actions}>
			{children}
			<input
				ref={picker.inputRef}
				hidden
				type="file"
				accept=".zip"
				data-testid="import-backup-file"
				onChange={picker.onInputChange}
			/>
			<ExportBackupDialog
				open={exporting !== null}
				returnFocusTo={focusTarget(exporting?.origin ?? null)}
				onOpenChange={(open) => {
					if (!open) {
						setExporting(null);
					}
				}}
			/>
			<ImportBackupDialog
				file={backup?.file ?? null}
				returnFocusTo={focusTarget(backup?.origin ?? null)}
				onClose={flow.closeBackup}
			/>
		</BackupContext>
	);
}
