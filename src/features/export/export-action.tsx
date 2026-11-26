import {useRef, useState} from 'react';
import {DownloadIcon} from 'lucide-react';
import {ExportDialog} from './export-dialog.tsx';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';

export function ExportAction() {
	const hasProject = useAppStore((state) => state.activeProject !== null);
	const [open, setOpen] = useState(false);
	const [exporting, setExporting] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);

	return (
		<>
			<Button
				ref={triggerRef}
				type="button"
				variant="default"
				size="sm"
				disabled={!hasProject}
				aria-label={exporting ? 'Exporting' : 'Export'}
				className="max-sm:size-8 max-sm:px-0"
				onClick={() => {
					setOpen(true);
				}}
			>
				<DownloadIcon aria-hidden="true" />
				<span className="max-sm:hidden">
					{exporting ? 'Exporting…' : 'Export'}
				</span>
			</Button>
			<ExportDialog
				open={open}
				returnFocusTo={triggerRef}
				onOpenChange={setOpen}
				onBusyChange={setExporting}
			/>
		</>
	);
}
