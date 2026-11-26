import type {ReactNode, RefObject} from 'react';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from '@/components/ui/sheet';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';

export type BackupModalProps = {
	readonly title: string;
	readonly description: string;
	readonly children: ReactNode;
	readonly footer: ReactNode;
	/**
	 Whether a click outside leaves the dialog open.
	 */
	readonly keepOpen: boolean;
	/**
	 What `Escape` and, unless `keepOpen`, a click outside ask for.
	 */
	readonly onDismiss: () => void;
	readonly returnFocusTo?: RefObject<HTMLElement | null>;
};

/**
 The shell of both backup dialogs: a dialog, or a full-height sheet on phones,
 with the body scrolling between the title and the footer.
 */
export function BackupModal({
	title,
	description,
	children,
	footer,
	keepOpen,
	onDismiss,
	returnFocusTo,
}: BackupModalProps) {
	const isPhone = usePhoneLayout();
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			onDismiss();
		}
	};

	const contentProps = {
		onInteractOutside(event: Event) {
			if (keepOpen) {
				event.preventDefault();
			}
		},
		onCloseAutoFocus: returnFocusTo
			? (event: Event) => {
					event.preventDefault();
					returnFocusTo.current?.focus();
				}
			: undefined,
	};
	const body = (
		<ScrollArea
			tabStop={false}
			className="flex min-h-0 flex-1 flex-col"
			viewportClassName="min-h-0 flex-1 [&>div]:block!"
		>
			<div className="space-y-4 px-4 py-4 sm:px-6">{children}</div>
		</ScrollArea>
	);

	if (isPhone) {
		return (
			<Sheet open onOpenChange={handleOpenChange}>
				<SheetContent
					side="bottom"
					showCloseButton={false}
					className="h-dvh max-h-dvh gap-0 rounded-none p-0"
					{...contentProps}
				>
					<SheetHeader className="border-b border-border px-4 pt-[calc(0.875rem+env(safe-area-inset-top))] pb-3.5">
						<SheetTitle>{title}</SheetTitle>
						<SheetDescription>{description}</SheetDescription>
					</SheetHeader>
					{body}
					<SheetFooter className="flex-row justify-end border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
						{footer}
					</SheetFooter>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Dialog open onOpenChange={handleOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-md"
				{...contentProps}
			>
				<DialogHeader className="border-b border-border px-6 py-4">
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{body}
				<DialogFooter className="flex-row border-t border-border px-6 py-3">
					{footer}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
