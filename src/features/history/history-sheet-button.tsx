import {HistoryIcon} from 'lucide-react';
import {HistoryPanel} from './history-panel.tsx';
import {Button} from '@/components/ui/button';
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from '@/components/ui/sheet';
import {useEditorViewportClass} from '@/lib/use-phone-layout.ts';
import {cn} from '@/lib/utils';

export function HistorySheetButton() {
	const landscape = useEditorViewportClass() === 'phone-landscape';

	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="History"
				>
					<HistoryIcon aria-hidden="true" />
				</Button>
			</SheetTrigger>
			<SheetContent
				side={landscape ? 'right' : 'bottom'}
				aria-describedby={undefined}
				className={cn(
					'gap-0 pb-[env(safe-area-inset-bottom)]',
					!landscape && 'h-[60dvh]',
				)}
			>
				<SheetHeader className="shrink-0 border-b border-border">
					<SheetTitle>History</SheetTitle>
				</SheetHeader>
				<div className="min-h-0 flex-1">
					<HistoryPanel />
				</div>
			</SheetContent>
		</Sheet>
	);
}
