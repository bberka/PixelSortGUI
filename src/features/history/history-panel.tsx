import {useSyncExternalStore} from 'react';
import {formatHistoryTime} from './history-format.ts';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Badge} from '@/components/ui/badge';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
	currentMinute,
	subscribeToMinute,
} from '@/features/library/library-format.ts';
import {cn} from '@/lib/utils';

export function HistoryPanel() {
	const history = useAppStore((state) => state.history);
	const projectId = useAppStore((state) => state.activeProject?.id ?? null);
	const headSeq = useAppStore(
		(state) => state.activeProject?.historyHeadSeq ?? 0,
	);
	const jumpToHistory = useAppStore((state) => state.jumpToHistory);
	const minute = useSyncExternalStore(subscribeToMinute, currentMinute);
	// The end of the current minute, so a new entry never dates from the future.
	const now = (minute + 1) * 60_000 - 1;

	const jump = async (seq: number, label: string) => {
		try {
			if (projectId && (await jumpToHistory(projectId, seq))) {
				announce(`Jumped to ${label}`);
			}
		} catch {
			announce(`Could not jump to ${label}`);
		}
	};

	return (
		<ScrollArea
			tabStop={false}
			className="h-full min-h-0 w-full"
			// Radix wraps the content in a table, which would stop labels truncating.
			viewportClassName="[&>div]:!block"
		>
			<ol aria-label="Project history" className="flex flex-col gap-0.5 p-2">
				{history.toReversed().map((entry) => {
					const isCurrent = entry.seq === headSeq;
					const isRedo = entry.seq > headSeq;
					return (
						<li key={entry.seq}>
							<button
								type="button"
								aria-current={isCurrent ? 'step' : undefined}
								data-redo={isRedo ? '' : undefined}
								className={cn(
									'flex min-h-9 w-full min-w-0 items-center gap-2 rounded-sm border-l-2 border-transparent px-2 py-1 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11',
									isCurrent && 'border-accent bg-secondary',
								)}
								onClick={() => {
									if (!isCurrent) {
										void jump(entry.seq, entry.label);
									}
								}}
							>
								<span
									title={entry.label}
									className={cn(
										'min-w-0 flex-1 truncate text-[13px] font-medium',
										isRedo ? 'text-muted-foreground' : 'text-foreground',
									)}
								>
									{entry.label}
								</span>
								{isRedo ? <span className="sr-only">Redo step</span> : null}
								{isCurrent ? <Badge variant="outline">Current</Badge> : null}
								<time
									dateTime={new Date(entry.createdAt).toISOString()}
									className="shrink-0 text-xs text-muted-foreground tabular-nums"
								>
									{formatHistoryTime(entry.createdAt, now)}
								</time>
							</button>
						</li>
					);
				})}
			</ol>
		</ScrollArea>
	);
}
