import {useRef, useState, type RefObject} from 'react';
import {SettingsIcon} from 'lucide-react';
import {SettingsContent} from './settings-content.tsx';
import {
	BACKUP_FOCUS_FALLBACK,
	useBackupActions,
} from '@/features/backup/backup-context.tsx';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';
import {Button} from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from '@/components/ui/sheet';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import type {StorageManagerLike} from '@/storage/quota.ts';

export type SettingsDialogProps = {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly storageManager?: StorageManagerLike;
	readonly returnFocusTo?: RefObject<HTMLElement | null>;
};

export function SettingsDialog({
	open,
	onOpenChange,
	storageManager,
	returnFocusTo,
}: SettingsDialogProps) {
	const isPhone = usePhoneLayout();
	const backup = useBackupActions();
	// Export opens once Settings has closed and given the focus back, so the two
	// dialogs never fight over it.
	const exportNextRef = useRef(false);
	const handleCloseAutoFocus = (event: Event) => {
		if (returnFocusTo) {
			event.preventDefault();
			returnFocusTo.current?.focus();
		}

		if (!exportNextRef.current) {
			return;
		}

		exportNextRef.current = false;
		backup?.openExport(returnFocusTo?.current ?? null);
	};

	const backupHandlers = backup
		? {
				onExportBackup() {
					exportNextRef.current = true;
					onOpenChange(false);
				},
				onImportBackup() {
					// The picker opens only from the click itself.
					backup.chooseImport(returnFocusTo?.current ?? null);
					onOpenChange(false);
				},
				importBackupDisabled: backup.importDisabled,
			}
		: undefined;

	if (isPhone) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="bottom"
					className="h-[100dvh] gap-0 rounded-none p-0"
					onCloseAutoFocus={handleCloseAutoFocus}
				>
					<SheetHeader className="border-b border-border px-4 py-3.5">
						<SheetTitle>Settings</SheetTitle>
						<SheetDescription className="sr-only">
							Appearance, browser storage, and application notices
						</SheetDescription>
					</SheetHeader>
					<ScrollArea className="min-h-0 flex-1">
						<div className="p-4">
							<SettingsContent
								open={open}
								backup={backupHandlers}
								storageManager={storageManager}
								onOpenGuide={() => {
									onOpenChange(false);
								}}
							/>
						</div>
					</ScrollArea>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
				onCloseAutoFocus={handleCloseAutoFocus}
			>
				<DialogHeader className="border-b border-border px-6 py-4">
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription className="sr-only">
						Appearance, browser storage, and application notices
					</DialogDescription>
				</DialogHeader>
				<ScrollArea className="min-h-0 flex-1">
					<div className="p-6">
						<SettingsContent
							open={open}
							backup={backupHandlers}
							storageManager={storageManager}
							onOpenGuide={() => {
								onOpenChange(false);
							}}
						/>
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}

export type SettingsButtonProps = {
	readonly storageManager?: StorageManagerLike;
};

export function SettingsButton({storageManager}: SettingsButtonProps = {}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						ref={triggerRef}
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Settings"
						{...BACKUP_FOCUS_FALLBACK}
						onClick={() => {
							setOpen(true);
						}}
					>
						<SettingsIcon className="size-4" aria-hidden="true" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Settings</TooltipContent>
			</Tooltip>
			<SettingsDialog
				open={open}
				returnFocusTo={triggerRef}
				storageManager={storageManager}
				onOpenChange={setOpen}
			/>
		</>
	);
}
