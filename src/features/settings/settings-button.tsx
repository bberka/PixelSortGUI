import {useState} from 'react';
import {SettingsIcon} from 'lucide-react';
import {SettingsContent} from './settings-content.tsx';
import {usePhoneLayout} from './use-phone-layout.ts';
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
};

export function SettingsDialog({
	open,
	onOpenChange,
	storageManager,
}: SettingsDialogProps) {
	const isPhone = usePhoneLayout();

	if (isPhone) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="bottom"
					className="h-[100dvh] gap-0 rounded-none p-0"
				>
					<SheetHeader className="border-b border-border px-4 py-3.5">
						<SheetTitle>Settings</SheetTitle>
						<SheetDescription className="sr-only">
							Appearance, browser storage, and application notices
						</SheetDescription>
					</SheetHeader>
					<ScrollArea className="min-h-0 flex-1">
						<div className="p-4">
							<SettingsContent open={open} storageManager={storageManager} />
						</div>
					</ScrollArea>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
				<DialogHeader className="border-b border-border px-6 py-4">
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription className="sr-only">
						Appearance, browser storage, and application notices
					</DialogDescription>
				</DialogHeader>
				<ScrollArea className="min-h-0 flex-1">
					<div className="p-6">
						<SettingsContent open={open} storageManager={storageManager} />
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

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Settings"
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
				storageManager={storageManager}
				onOpenChange={setOpen}
			/>
		</>
	);
}
