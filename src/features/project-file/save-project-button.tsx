import {useRef, useState} from 'react';
import {ArchiveIcon} from 'lucide-react';
import {SAVE_PROJECT_LABEL, SaveProjectDialog} from './save-project-dialog.tsx';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';

/**
 The editor toolbar action on desktop and tablet. Phones use the app bar
 overflow menu. The dialog stays mounted if the layout changes while it is open.
 */
export function SaveProjectButton() {
	const project = useAppStore((state) => state.activeProject);
	const isPhone = usePhoneLayout();
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);

	return (
		<>
			{isPhone ? null : (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							ref={triggerRef}
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={SAVE_PROJECT_LABEL}
							onClick={() => {
								setOpen(true);
							}}
						>
							<ArchiveIcon aria-hidden="true" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>{SAVE_PROJECT_LABEL}</TooltipContent>
				</Tooltip>
			)}
			<SaveProjectDialog
				project={open ? project : null}
				returnFocus={() => {
					triggerRef.current?.focus();
				}}
				onClose={() => {
					setOpen(false);
				}}
			/>
		</>
	);
}
