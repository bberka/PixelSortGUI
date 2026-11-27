import {useSyncExternalStore} from 'react';
import {Columns2Icon} from 'lucide-react';
import {formatHistoryTime} from './history-format.ts';
import {announce} from '@/app/announcer.ts';
import {useAppStore, useTransientStore} from '@/app/runtime-context.tsx';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {
	currentMinute,
	subscribeToMinute,
} from '@/features/library/library-format.ts';
import {cn} from '@/lib/utils';

export type HistoryPanelProps = {
	readonly onCompareStart?: () => void;
};

export function HistoryPanel({onCompareStart}: HistoryPanelProps = {}) {
	const history = useAppStore((state) => state.history);
	const projectId = useAppStore((state) => state.activeProject?.id ?? null);
	const headSeq = useAppStore(
		(state) => state.activeProject?.historyHeadSeq ?? 0,
	);
	const compareHistorySeq = useAppStore((state) => state.compareHistorySeq);
	const jumpToHistory = useAppStore((state) => state.jumpToHistory);
	const setCompareHistorySeq = useAppStore(
		(state) => state.setCompareHistorySeq,
	);
	const cropping = useTransientStore((state) => state.geometry.cropping);
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

	const toggleCompare = (seq: number, label: string) => {
		if (compareHistorySeq === seq) {
			setCompareHistorySeq(null);
			announce('Stopped comparing history step');
			return;
		}

		setCompareHistorySeq(seq);
		announce(`Comparing with Step #${seq}: ${label}`);
		onCompareStart?.();
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
					const isComparing = entry.seq === compareHistorySeq;
					return (
						<li
							key={entry.seq}
							data-comparing={isComparing ? '' : undefined}
							className="flex min-w-0 items-center gap-1"
						>
							<button
								type="button"
								data-history-jump=""
								aria-current={isCurrent ? 'step' : undefined}
								data-redo={isRedo ? '' : undefined}
								className={cn(
									'flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-sm border-l-2 border-transparent px-2 py-1 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11',
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
								{isComparing ? (
									<Badge variant="default">Comparing</Badge>
								) : null}
								{isCurrent ? <Badge variant="outline">Current</Badge> : null}
								<time
									dateTime={new Date(entry.createdAt).toISOString()}
									className="shrink-0 text-xs text-muted-foreground tabular-nums"
								>
									{formatHistoryTime(entry.createdAt, now)}
								</time>
							</button>
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="inline-flex shrink-0">
										<Button
											type="button"
											variant={isComparing ? 'default' : 'ghost'}
											size="icon-sm"
											aria-label={`Compare with this: ${entry.label}`}
											aria-pressed={isComparing}
											disabled={cropping}
											className="shrink-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
											onClick={() => {
												toggleCompare(entry.seq, entry.label);
											}}
										>
											<Columns2Icon aria-hidden="true" />
										</Button>
									</span>
								</TooltipTrigger>
								<TooltipContent>
									{isComparing ? 'Stop comparing' : 'Compare with this'}
								</TooltipContent>
							</Tooltip>
						</li>
					);
				})}
			</ol>
		</ScrollArea>
	);
}
