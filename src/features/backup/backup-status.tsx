import {useEffect} from 'react';
import {announce} from '@/app/announcer.ts';
import {Progress} from '@/components/ui/progress';
import type {BackupProgress, BackupStage} from '@/storage/backup-format.ts';

const STAGE_LABELS: Record<BackupStage, string> = {
	reading: 'Reading',
	packing: 'Packing',
	validating: 'Validating',
	importing: 'Importing',
};

export function BackupProgressBar({
	progress: {stage, fraction},
}: {
	readonly progress: BackupProgress;
}) {
	const label = STAGE_LABELS[stage];
	const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);

	useEffect(() => {
		announce(label);
	}, [label]);

	return (
		<div data-slot="backup-progress" className="space-y-2">
			<div className="flex items-baseline justify-between gap-2 text-sm">
				<span className="font-medium">{label}</span>
				<span className="font-mono text-xs text-muted-foreground tabular-nums">
					{percent}%
				</span>
			</div>
			<Progress value={percent} aria-label={label} />
		</div>
	);
}

export function BackupErrorMessage({message}: {readonly message: string}) {
	return (
		<p
			role="alert"
			className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
		>
			{message}
		</p>
	);
}
