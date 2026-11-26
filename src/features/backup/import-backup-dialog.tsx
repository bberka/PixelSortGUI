import {useEffect, useRef, useState, type RefObject} from 'react';
import {BackupModal} from './backup-modal.tsx';
import {BackupErrorMessage, BackupProgressBar} from './backup-status.tsx';
import {CheckRow, ProjectRowText} from './check-row.tsx';
import {useAppStore} from '@/app/runtime-context.tsx';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {formatByteSize} from '@/features/export/export-helpers.ts';
import {formatDimensions} from '@/features/library/library-format.ts';
import {BackupError} from '@/storage/backup-error.ts';
import type {BackupProgress} from '@/storage/backup-format.ts';
import {
	backupNewBytes,
	type BackupInspection,
	type BackupProjectStatus,
	type BackupSelection,
} from '@/storage/backup-transfer.ts';
import {isQuotaExceededError} from '@/storage/types.ts';

export type ImportBackupDialogProps = {
	/**
	 The chosen backup; the dialog is open while there is one.
	 */
	readonly file: Blob | null;
	readonly onClose: () => void;
	/**
	 Takes the focus when the dialog closes.
	 */
	readonly returnFocusTo?: RefObject<HTMLElement | null>;
};

const fileKeys = new WeakMap<Blob, number>();
let lastFileKey = 0;

// Another file starts the dialog afresh.
function fileKey(file: Blob): number {
	let key = fileKeys.get(file);
	if (key === undefined) {
		key = ++lastFileKey;
		fileKeys.set(file, key);
	}

	return key;
}

/**
 The "Import backup" dialog (product.md F17): it checks the file, asks what to
 restore, and imports it. The app store raises the summary as a notice.
 */
export function ImportBackupDialog({file, ...props}: ImportBackupDialogProps) {
	return file ? (
		<ImportBackupFlow key={fileKey(file)} file={file} {...props} />
	) : null;
}

type Step =
	| {kind: 'validating'; progress: BackupProgress}
	| {kind: 'select'; inspection: BackupInspection}
	| {
			kind: 'importing';
			inspection: BackupInspection;
			progress: BackupProgress;
	  }
	| {kind: 'error'; message: string};

const STATUS_VARIANTS = {
	New: 'default',
	Unchanged: 'secondary',
	'Modified locally': 'outline',
} as const satisfies Record<BackupProjectStatus, string>;

const MODE_NOTES = {
	merge:
		'Merge with current library. A project changed on this device is imported as a copy.',
	replace:
		'Replace all local data. Every project and preset on this device is deleted first.',
} as const;

function errorMessage(error: unknown): string {
	return error instanceof BackupError
		? error.message
		: "Can't import backup. Try again.";
}

function ImportBackupFlow({
	file,
	onClose,
	returnFocusTo,
}: ImportBackupDialogProps & {readonly file: Blob}) {
	const inspectBackup = useAppStore((state) => state.inspectBackup);
	const importBackup = useAppStore((state) => state.importBackup);
	const [step, setStep] = useState<Step>({
		kind: 'validating',
		progress: {stage: 'validating', fraction: 0},
	});
	const jobRef = useRef<AbortController | null>(null);

	const [mode, setMode] = useState<BackupSelection['mode']>('merge');
	// The rows the user has set; the others follow the mode's default.
	const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
		() => new Map(),
	);
	const [presets, setPresets] = useState(true);
	const [settings, setSettings] = useState(true);
	const [confirming, setConfirming] = useState(false);
	const importButtonRef = useRef<HTMLButtonElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const job = new AbortController();
		jobRef.current = job;
		void inspectBackup(file, {
			signal: job.signal,
			onProgress(progress) {
				if (!job.signal.aborted) {
					setStep({kind: 'validating', progress});
				}
			},
		}).then(
			(inspection) => {
				if (!job.signal.aborted) {
					setStep({kind: 'select', inspection});
				}
			},
			(error: unknown) => {
				if (!job.signal.aborted) {
					setStep({kind: 'error', message: errorMessage(error)});
				}
			},
		);
		return () => {
			job.abort();
			// An import started later has its own controller.
			jobRef.current?.abort();
		};
	}, [file, inspectBackup]);

	// Kept while importing, so the closing confirmation keeps its counts.
	const preview = 'inspection' in step ? step.inspection.preview : null;
	const isChecked = (id: string, status: BackupProjectStatus) =>
		overrides.get(id) ?? !(mode === 'merge' && status === 'Unchanged');
	const projectIds =
		preview?.projects
			.filter((project) => isChecked(project.id, project.status))
			.map((project) => project.id) ?? [];
	const withPresets = presets && (preview?.presetCount ?? 0) > 0;
	const withSettings = settings && (preview?.hasSettings ?? false);
	const nothingChosen =
		projectIds.length === 0 && !withPresets && !withSettings;

	const runImport = async (inspection: BackupInspection) => {
		const job = new AbortController();
		jobRef.current = job;
		// The button that started the import is about to leave.
		cancelRef.current?.focus();
		setStep({
			kind: 'importing',
			inspection,
			progress: {stage: 'importing', fraction: 0},
		});
		try {
			await importBackup(
				inspection,
				{mode, projectIds, presets: withPresets, settings: withSettings},
				{
					signal: job.signal,
					onProgress(progress) {
						setStep({kind: 'importing', inspection, progress});
					},
				},
			);
			onClose();
		} catch (error) {
			// The shell shows "Storage is full" for a full quota.
			if (job.signal.aborted || isQuotaExceededError(error)) {
				onClose();
			} else {
				setStep({kind: 'error', message: errorMessage(error)});
			}
		}
	};

	// A running import closes the dialog itself: the abort may come too late to
	// stop the commit, and then the import still finishes.
	const dismiss = () => {
		jobRef.current?.abort();
		if (step.kind !== 'importing') {
			onClose();
		}
	};

	return (
		<>
			<BackupModal
				title="Import backup"
				description="Restore projects, presets and settings from a backup file."
				keepOpen={step.kind !== 'error'}
				returnFocusTo={returnFocusTo}
				footer={
					<>
						<Button
							ref={cancelRef}
							type="button"
							variant="outline"
							onClick={dismiss}
						>
							{step.kind === 'error' ? 'Close' : 'Cancel'}
						</Button>
						{step.kind === 'select' ? (
							<Button
								ref={importButtonRef}
								type="button"
								disabled={nothingChosen}
								onClick={() => {
									if (mode === 'replace') {
										setConfirming(true);
									} else {
										void runImport(step.inspection);
									}
								}}
							>
								Import
							</Button>
						) : null}
					</>
				}
				onDismiss={dismiss}
			>
				{step.kind === 'validating' || step.kind === 'importing' ? (
					<BackupProgressBar progress={step.progress} />
				) : null}
				{step.kind === 'error' ? (
					<BackupErrorMessage message={step.message} />
				) : null}
				{step.kind === 'select' ? (
					<>
						<div className="space-y-2">
							<ToggleGroup
								type="single"
								variant="outline"
								size="sm"
								value={mode}
								aria-label="Import mode"
								className="w-full"
								onValueChange={(value) => {
									if (value === 'merge' || value === 'replace') {
										setMode(value);
									}
								}}
							>
								<ToggleGroupItem value="merge" className="flex-1">
									Merge
								</ToggleGroupItem>
								<ToggleGroupItem value="replace" className="flex-1">
									Replace
								</ToggleGroupItem>
							</ToggleGroup>
							<p className="text-sm text-muted-foreground">
								{MODE_NOTES[mode]}
							</p>
						</div>

						{step.inspection.preview.projects.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								This backup holds no projects.
							</p>
						) : (
							<ul
								aria-label="Projects in the backup"
								className="rounded-md border border-border p-1"
							>
								{step.inspection.preview.projects.map((project) => (
									<li key={project.id}>
										<CheckRow
											checked={isChecked(project.id, project.status)}
											onCheckedChange={(checked) => {
												setOverrides(
													new Map(overrides).set(project.id, checked),
												);
											}}
										>
											<ProjectRowText
												name={project.name}
												details={`${formatDimensions(project.width, project.height)}, ${formatByteSize(project.sourceBytes)}`}
											/>
											<Badge variant={STATUS_VARIANTS[project.status]}>
												{project.status}
											</Badge>
										</CheckRow>
									</li>
								))}
							</ul>
						)}

						<div>
							{step.inspection.preview.presetCount === null ? null : (
								<CheckRow checked={presets} onCheckedChange={setPresets}>
									User presets ({step.inspection.preview.presetCount})
								</CheckRow>
							)}
							{step.inspection.preview.hasSettings ? (
								<CheckRow checked={settings} onCheckedChange={setSettings}>
									Settings (Theme, Compare mode)
								</CheckRow>
							) : null}
						</div>

						<p
							data-slot="backup-new-bytes"
							className="text-sm text-muted-foreground"
						>
							New image data to store:{' '}
							{formatByteSize(
								backupNewBytes(step.inspection.preview, projectIds),
							)}
						</p>
					</>
				) : null}
			</BackupModal>

			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						// A confirmed Replace has removed the Import button.
						(importButtonRef.current ?? cancelRef.current)?.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>Replace all local data?</AlertDialogTitle>
						<AlertDialogDescription>
							This deletes {preview?.localProjectCount} existing project(s) and{' '}
							{preview?.localPresetCount} user preset(s) on this device before
							importing.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						{/* Their slot names escape the coarse-pointer rule in app.css. */}
						<AlertDialogCancel className="pointer-coarse:min-h-11">
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="pointer-coarse:min-h-11"
							onClick={() => {
								if (step.kind === 'select') {
									void runImport(step.inspection);
								}
							}}
						>
							Replace
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
