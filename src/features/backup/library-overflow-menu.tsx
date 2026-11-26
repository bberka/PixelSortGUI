import {useRef} from 'react';
import {EllipsisVerticalIcon} from 'lucide-react';
import {BackupMenuItems} from './backup-menu-items.tsx';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 The Library app bar's overflow menu (DESIGN.md section 7.2).
 */
export function LibraryOverflowMenu() {
	const triggerRef = useRef<HTMLButtonElement>(null);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					ref={triggerRef}
					type="button"
					variant="ghost"
					size="icon-sm"
					// The trigger's slot name escapes the coarse-pointer rule in app.css.
					className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
					aria-label="Library actions"
				>
					<EllipsisVerticalIcon aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<BackupMenuItems triggerRef={triggerRef} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
