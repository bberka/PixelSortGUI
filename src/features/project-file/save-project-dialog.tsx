import {useEffect, useId, useRef, useState} from 'react';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {Label} from '@/components/ui/label';
import {Progress} from '@/components/ui/progress';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from '@/components/ui/sheet';
import {downloadBlob} from '@/features/export/export-helpers.ts';
import {problemForStorageError} from '@/features/import/import-problems.ts';
import {formatDimensions} from '@/features/library/library-format.ts';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';
import type {ProjectRecord} from '@/storage/types.ts';

export const SAVE_PROJECT_LABEL = 'Save project file';

const DESCRIPTION =
	'Downloads one file with the photo, effects and settings of this project.';

export type SaveProjectDialogProps = {
	// The project to save; `null` closes the dialog.
	readonly project: ProjectRecord | null;
	readonly onClose: () => void;
	readonly returnFocus?: () => void;
	// Replaced by tests.
	readonly downloadFile?: (blob: Blob, fileName: string) => void;
};

/**
 The dialog that writes a `.glproj` file and downloads it (product.md F25,
 DESIGN.md section 7.2).
 */
export function SaveProjectDialog({
	project,
	onClose,
	returnFocus,
	downloadFile = downloadBlob,
}: SaveProjectDialogProps) {
	const exportProjectFile = useAppStore((state) => state.exportProjectFile);
	const isPhone = usePhoneLayout();
	const historyId = useId();
	const [includeHistory, setIncludeHistory] = useState(true);
	// 0 to 1 while a file is being written.
	const [progress, setProgress] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(
		() => () => {
			abortRef.current?.abort();
		},
		[],
	);

	if (!project) {
		return null;
	}

	const cancel = () => {
		abortRef.current?.abort();
		abortRef.current = null;
		setProgress(null);
	};

	const close = () => {
		cancel();
		setError(null);
		setIncludeHistory(true);
		onClose();
	};

	const save = async ({id, name}: ProjectRecord) => {
		const controller = new AbortController();
		const {signal} = controller;
		abortRef.current = controller;
		setError(null);
		setProgress(0);
		try {
			const {blob, fileName} = await exportProjectFile(id, {
				includeHistory,
				signal,
				onProgress({fraction}) {
					if (!signal.aborted) {
						setProgress(fraction);
					}
				},
			});
			if (signal.aborted) {
				return;
			}

			downloadFile(blob, fileName);
			announce(`Saved ${fileName}`);
			close();
		} catch (saveError) {
			if (signal.aborted) {
				return;
			}

			setProgress(null);
			setError(
				saveError instanceof Error && saveError.name === 'ProjectFileError'
					? saveError.message
					: problemForStorageError(name, saveError).message,
			);
		}
	};

	const saving = progress !== null;
	const percent = Math.round((progress ?? 0) * 100);
	const contentProps = {
		onCloseAutoFocus(event: Event) {
			if (!returnFocus) {
				return;
			}

			event.preventDefault();
			returnFocus();
		},
	};

	const body = (
		<div className="min-w-0 space-y-4">
			<div className="min-w-0 text-sm leading-5">
				<p className="truncate font-medium">{project.name}</p>
				<p className="text-xs leading-4 text-muted-foreground">
					{formatDimensions(project.effectiveWidth, project.effectiveHeight)}
				</p>
			</div>
			<div className="flex items-center gap-2">
				<Checkbox
					id={historyId}
					checked={includeHistory}
					disabled={saving}
					onCheckedChange={(checked) => {
						setIncludeHistory(checked === true);
					}}
				/>
				<Label htmlFor={historyId} className="pointer-coarse:min-h-11">
					Include undo history
				</Label>
			</div>
			{saving ? (
				<div className="space-y-1.5 rounded-md border border-border bg-card p-3">
					<div className="flex items-center justify-between gap-2 text-xs leading-4">
						<span className="font-medium text-foreground">Saving</span>
						<span className="font-mono text-muted-foreground tabular-nums">
							{percent}%
						</span>
					</div>
					<Progress value={percent} aria-label="Save progress" />
				</div>
			) : null}
			{error ? (
				<p
					role="alert"
					className="rounded-md border border-destructive bg-card p-3 text-sm break-words text-destructive-text"
				>
					{error}
				</p>
			) : null}
		</div>
	);

	// Keyed, so the button that replaces the focused one is not clicked by the
	// same key press.
	const action = saving ? (
		<Button key="cancel" type="button" variant="outline" onClick={cancel}>
			Cancel
		</Button>
	) : (
		<Button
			key="save"
			type="button"
			onClick={() => {
				void save(project);
			}}
		>
			Save
		</Button>
	);

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			close();
		}
	};

	if (isPhone) {
		return (
			<Sheet open onOpenChange={handleOpenChange}>
				<SheetContent
					{...contentProps}
					side="bottom"
					className="max-h-dvh gap-0 pb-[env(safe-area-inset-bottom)]"
				>
					<SheetHeader className="border-b border-border">
						<SheetTitle>{SAVE_PROJECT_LABEL}</SheetTitle>
						<SheetDescription className="sr-only">
							{DESCRIPTION}
						</SheetDescription>
					</SheetHeader>
					<div className="px-4 py-4">{body}</div>
					<SheetFooter className="flex-row justify-end border-t border-border px-4 py-3">
						{action}
					</SheetFooter>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Dialog open onOpenChange={handleOpenChange}>
			<DialogContent {...contentProps} className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>{SAVE_PROJECT_LABEL}</DialogTitle>
					<DialogDescription className="sr-only">
						{DESCRIPTION}
					</DialogDescription>
				</DialogHeader>
				{body}
				<DialogFooter>{action}</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
