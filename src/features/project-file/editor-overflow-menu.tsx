import {useRef, useState} from 'react';
import {ArchiveIcon, EllipsisVerticalIcon} from 'lucide-react';
import {SAVE_PROJECT_LABEL, SaveProjectDialog} from './save-project-dialog.tsx';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';

/**
 The phone editor's app bar overflow menu (DESIGN.md section 6.4).
 */
export function EditorOverflowMenu() {
	const project = useAppStore((state) => state.activeProject);
	const isPhone = usePhoneLayout();
	const [saving, setSaving] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);

	return (
		<>
			{isPhone ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							ref={triggerRef}
							type="button"
							variant="ghost"
							size="icon-sm"
							disabled={!project}
							aria-label="More actions"
						>
							<EllipsisVerticalIcon aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							onSelect={() => {
								setSaving(true);
							}}
						>
							<ArchiveIcon aria-hidden="true" />
							{SAVE_PROJECT_LABEL}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
			<SaveProjectDialog
				project={saving ? project : null}
				returnFocus={() => {
					triggerRef.current?.focus();
				}}
				onClose={() => {
					setSaving(false);
				}}
			/>
		</>
	);
}
