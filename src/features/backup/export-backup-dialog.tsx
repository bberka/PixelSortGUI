import {useEffect, useRef, useState, type RefObject} from 'react';
import {DownloadIcon} from 'lucide-react';
import {toast} from 'sonner';
import {BackupModal} from './backup-modal.tsx';
import {BackupErrorMessage, BackupProgressBar} from './backup-status.tsx';
import {CheckRow, ProjectRowText} from './check-row.tsx';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {
	downloadBlob,
	formatByteSize,
} from '@/features/export/export-helpers.ts';
import {formatDimensions} from '@/features/library/library-format.ts';
import {projectDimensions} from '@/render/render-source.ts';
import {BackupError} from '@/storage/backup-error.ts';
import {
	estimateBackupBytes,
	type BackupProgress,
} from '@/storage/backup-format.ts';

export type ExportBackupDialogProps = {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	/**
	 Takes the focus when the dialog closes.
	 */
	readonly returnFocusTo?: RefObject<HTMLElement | null>;
	/**
	 Test seam.
	 */
	readonly downloadFile?: (blob: Blob, fileName: string) => void;
};

/**
 The "Export backup" dialog (product.md F17). Each opening starts afresh.
 */
export function ExportBackupDialog({open, ...props}: ExportBackupDialogProps) {
	return open ? <ExportBackupForm {...props} /> : null;
}

function ExportBackupForm({
	onOpenChange,
	returnFocusTo,
	downloadFile = downloadBlob,
}: Omit<ExportBackupDialogProps, 'open'>) {
	const projects = useAppStore((state) => state.projects);
	const presetCount = useAppStore((state) => state.presets.length);
	const exportBackup = useAppStore((state) => state.exportBackup);
	const getSourceSizes = useAppStore((state) => state.getSourceSizes);

	const [excluded, setExcluded] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [includeHistory, setIncludeHistory] = useState(true);
	const [includePresets, setIncludePresets] = useState(true);
	const [includeSettings, setIncludeSettings] = useState(true);
	// `null` until read; `'unknown'` when the read fails.
	const [sizes, setSizes] = useState<Record<string, number> | 'unknown' | null>(
		null,
	);
	const [progress, setProgress] = useState<BackupProgress | null>(null);
	const [error, setError] = useState<string | null>(null);
	const jobRef = useRef<AbortController | null>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		let stale = false;
		void getSourceSizes().then(
			(result) => {
				if (!stale) {
					setSizes(result);
				}
			},
			() => {
				if (!stale) {
					setSizes('unknown');
				}
			},
		);
		return () => {
			stale = true;
		};
	}, [getSourceSizes]);

	useEffect(
		() => () => {
			jobRef.current?.abort();
			jobRef.current = null;
		},
		[],
	);

	const chosen = projects.filter((project) => !excluded.has(project.id));
	const busy = progress !== null;
	const nothingToWrite =
		chosen.length === 0 &&
		!(includePresets && presetCount > 0) &&
		!includeSettings;
	const estimate =
		sizes === null
			? 'calculating'
			: sizes === 'unknown'
				? 'unknown'
				: formatByteSize(estimateBackupBytes(chosen, sizes, includeHistory));

	// A refusal no longer applies once the choice changes.
	const change = <Value,>(set: (value: Value) => void, value: Value) => {
		setError(null);
		set(value);
	};

	const cancel = () => {
		jobRef.current?.abort();
		jobRef.current = null;
		setProgress(null);
	};

	const dismiss = () => {
		if (busy) {
			cancel();
		} else {
			onOpenChange(false);
		}
	};

	const start = async () => {
		const job = new AbortController();
		jobRef.current = job;
		// The button that started the job is about to be disabled.
		cancelRef.current?.focus();
		setError(null);
		setProgress({stage: 'reading', fraction: 0});
		try {
			const {blob, fileName} = await exportBackup({
				projectIds: chosen.map((project) => project.id),
				includeHistory,
				includePresets,
				includeSettings,
				signal: job.signal,
				onProgress(next) {
					if (jobRef.current === job) {
						setProgress(next);
					}
				},
			});
			if (jobRef.current !== job) {
				return;
			}

			jobRef.current = null;
			downloadFile(blob, fileName);
			toast(`Downloaded ${fileName}.`);
			onOpenChange(false);
		} catch (error_) {
			// A cancelled job has already let go of the dialog.
			if (jobRef.current !== job) {
				return;
			}

			jobRef.current = null;
			setProgress(null);
			setError(
				error_ instanceof BackupError
					? error_.message
					: "Can't export backup. Try again.",
			);
		}
	};

	return (
		<BackupModal
			title="Export backup"
			description="Save projects, presets and settings to one ZIP file."
			keepOpen={busy}
			returnFocusTo={returnFocusTo}
			footer={
				<>
					<Button
						ref={cancelRef}
						type="button"
						variant="outline"
						onClick={dismiss}
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={busy || nothingToWrite}
						onClick={() => {
							void start();
						}}
					>
						<DownloadIcon aria-hidden="true" />
						Export backup
					</Button>
				</>
			}
			onDismiss={dismiss}
		>
			{progress ? <BackupProgressBar progress={progress} /> : null}
			{error ? <BackupErrorMessage message={error} /> : null}

			<fieldset className="min-w-0 space-y-2" disabled={busy}>
				<legend className="sr-only">Projects</legend>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span aria-hidden="true" className="text-sm font-medium">
						Projects ({chosen.length} of {projects.length})
					</span>
					<span className="flex gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => {
								change(setExcluded, new Set<string>());
							}}
						>
							Select all
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => {
								change(
									setExcluded,
									new Set(projects.map((project) => project.id)),
								);
							}}
						>
							Select none
						</Button>
					</span>
				</div>
				{projects.length === 0 ? (
					<p className="text-sm text-muted-foreground">No projects yet.</p>
				) : (
					<ul className="rounded-md border border-border p-1">
						{projects.map((project) => {
							const {width, height} = projectDimensions(project);
							return (
								<li key={project.id}>
									<CheckRow
										checked={!excluded.has(project.id)}
										disabled={busy}
										onCheckedChange={(checked) => {
											const next = new Set(excluded);
											if (checked) {
												next.delete(project.id);
											} else {
												next.add(project.id);
											}

											change(setExcluded, next);
										}}
									>
										<ProjectRowText
											name={project.name}
											details={formatDimensions(width, height)}
										/>
									</CheckRow>
								</li>
							);
						})}
					</ul>
				)}
			</fieldset>

			<div>
				<CheckRow
					checked={includeHistory}
					disabled={busy}
					onCheckedChange={(checked) => {
						change(setIncludeHistory, checked);
					}}
				>
					Include undo history
				</CheckRow>
				<CheckRow
					checked={includePresets}
					disabled={busy}
					onCheckedChange={(checked) => {
						change(setIncludePresets, checked);
					}}
				>
					Include user presets ({presetCount})
				</CheckRow>
				<CheckRow
					checked={includeSettings}
					disabled={busy}
					onCheckedChange={(checked) => {
						change(setIncludeSettings, checked);
					}}
				>
					Include settings
				</CheckRow>
			</div>

			<p data-slot="backup-estimate" className="text-sm text-muted-foreground">
				Estimated image data: {estimate}
			</p>
		</BackupModal>
	);
}
