import {useRef, useState} from 'react';
import {NoticeToasts} from '@/app/notices.tsx';
import {StorageFullDialog} from '@/app/storage-full-dialog.tsx';
import {Button} from '@/components/ui/button';
import {
	ExportBackupDialog,
	ImportBackupDialog,
} from '@/features/backup/index.ts';

/**
 Opens the backup dialogs on their own. The gallery has no app shell, so this
 mounts the shell parts they report to.
 */
export function BackupDemo() {
	const [exporting, setExporting] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const exportButtonRef = useRef<HTMLButtonElement>(null);
	const importButtonRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	return (
		<div className="flex flex-wrap gap-2">
			<Button
				ref={exportButtonRef}
				variant="outline"
				onClick={() => {
					setExporting(true);
				}}
			>
				Back up library
			</Button>
			<Button
				ref={importButtonRef}
				variant="outline"
				onClick={() => {
					inputRef.current?.click();
				}}
			>
				Restore from file
			</Button>
			<input
				ref={inputRef}
				hidden
				type="file"
				accept=".zip"
				data-testid="backup-file"
				onChange={(event) => {
					setFile(event.target.files?.[0] ?? null);
					// The same file can be chosen again.
					event.target.value = '';
				}}
			/>
			<ExportBackupDialog
				open={exporting}
				returnFocusTo={exportButtonRef}
				onOpenChange={setExporting}
			/>
			<ImportBackupDialog
				file={file}
				returnFocusTo={importButtonRef}
				onClose={() => {
					setFile(null);
				}}
			/>
			<StorageFullDialog />
			<NoticeToasts />
		</div>
	);
}
