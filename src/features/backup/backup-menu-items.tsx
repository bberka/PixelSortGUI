import type {RefObject} from 'react';
import {DownloadIcon, UploadIcon} from 'lucide-react';
import {
	EXPORT_BACKUP_LABEL,
	IMPORT_BACKUP_LABEL,
	useBackupActions,
} from './backup-context.tsx';
import {DropdownMenuItem} from '@/components/ui/dropdown-menu';

/**
 The two backup items of an app bar overflow menu. `triggerRef` gets the focus
 back when the dialog closes.
 */
export function BackupMenuItems({
	triggerRef,
}: {
	readonly triggerRef: RefObject<HTMLElement | null>;
}) {
	const backup = useBackupActions();
	if (!backup) {
		return null;
	}

	return (
		<>
			<DropdownMenuItem
				className="pointer-coarse:min-h-11"
				onSelect={() => {
					backup.openExport(triggerRef.current);
				}}
			>
				<DownloadIcon aria-hidden="true" />
				{EXPORT_BACKUP_LABEL}
			</DropdownMenuItem>
			<DropdownMenuItem
				className="pointer-coarse:min-h-11"
				disabled={backup.importDisabled}
				onSelect={() => {
					backup.chooseImport(triggerRef.current);
				}}
			>
				<UploadIcon aria-hidden="true" />
				{IMPORT_BACKUP_LABEL}
			</DropdownMenuItem>
		</>
	);
}
