import type {ImportProgress} from './use-image-import.ts';
import {Progress} from '@/components/ui/progress';

/**
 Non-blocking progress for a check or a downscale that takes more than a
 moment. It carries no backdrop and traps no focus: the user can keep working
 while a large file is read.
 */
export function ImportProgressCard({
	progress,
}: {
	readonly progress: ImportProgress;
}) {
	return (
		<div
			role="status"
			className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
		>
			<div className="w-full max-w-xs rounded-lg border border-border bg-popover p-3 text-popover-foreground">
				<p className="mb-2 truncate text-xs leading-4">{progress.label}</p>
				<Progress
					aria-label="Import progress"
					className="h-1"
					value={Math.round(progress.fraction * 100)}
				/>
			</div>
		</div>
	);
}
