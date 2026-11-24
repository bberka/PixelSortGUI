import {useAppStore} from './runtime-context.tsx';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 The store sets `storage.quotaFull` when a write fails on a full quota, so any
 feature that saves gets the same dialog: the shell owns it, not the caller.
 */
export function StorageFullDialog() {
	const quotaFull = useAppStore((state) => state.storage.quotaFull);
	const clearQuotaFull = useAppStore((state) => state.clearQuotaFull);
	const closeProject = useAppStore((state) => state.closeProject);

	return (
		<AlertDialog
			open={quotaFull}
			onOpenChange={(open) => {
				if (!open) {
					clearQuotaFull();
				}
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Storage is full</AlertDialogTitle>
					<AlertDialogDescription>
						This browser's storage does not have enough free space. Nothing
						partial was saved: the last saved state is intact.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						onClick={() => {
							clearQuotaFull();
							void closeProject();
						}}
					>
						Manage library
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
