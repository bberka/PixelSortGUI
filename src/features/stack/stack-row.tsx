import type {KeyboardEvent} from 'react';
import {
	EyeOffIcon,
	GripVerticalIcon,
	MoreVerticalIcon,
	VenetianMaskIcon,
} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Switch} from '@/components/ui/switch';
import type {EffectInstance} from '@/engine/types.ts';
import {cn} from '@/lib/utils';

export type StackRowProps = {
	readonly instance: EffectInstance;
	readonly index: number;
	readonly total: number;
	readonly label: string;
	readonly isSelected: boolean;
	readonly isUnsupported: boolean;
	readonly isDragging: boolean;
	readonly compact: boolean;
	readonly onSelect: () => void;
	readonly onToggleEnabled: (enabled: boolean) => void;
	readonly onMove: (toIndex: number) => void;
	readonly onDuplicate: () => void;
	readonly onRemove: () => void;
};

export function StackRow({
	instance,
	index,
	total,
	label,
	isSelected,
	isUnsupported,
	isDragging,
	compact,
	onSelect,
	onToggleEnabled,
	onMove,
	onDuplicate,
	onRemove,
}: StackRowProps) {
	const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
		if (
			!event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			(event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
		) {
			return;
		}

		event.preventDefault();
		onMove(index + (event.key === 'ArrowUp' ? -1 : 1));
	};

	// Phone chips stay narrow: only the selected one carries its controls.
	const showControls = !compact || isSelected || isUnsupported;
	const moveUpLabel = compact ? 'Move left' : 'Move up';
	const moveDownLabel = compact ? 'Move right' : 'Move down';
	const maskBadge = instance.mask ? (
		<span className="flex shrink-0 items-center text-muted-foreground">
			<VenetianMaskIcon aria-hidden="true" className="size-3.5" />
			<span className="sr-only">Has mask</span>
		</span>
	) : null;

	return (
		<li
			data-index={index}
			data-state={isSelected ? 'selected' : 'default'}
			data-unsupported={isUnsupported ? '' : undefined}
			className={cn(
				'flex shrink-0 items-center gap-1 rounded-md border bg-card px-1',
				// 44 px switch and menu leave a tablet row no room for gaps.
				!compact && 'pointer-coarse:gap-0 pointer-coarse:px-0.5',
				compact ? 'min-h-11' : 'min-h-9',
				isSelected ? 'border-accent' : 'border-border',
				isUnsupported && 'border-dashed border-input',
				isDragging && 'opacity-60',
			)}
			onKeyDown={handleKeyDown}
		>
			{compact ? null : (
				<span
					data-drag-handle=""
					aria-hidden="true"
					className="flex cursor-grab touch-none items-center px-0.5 text-muted-foreground select-none active:cursor-grabbing"
				>
					<GripVerticalIcon className="size-4" />
				</span>
			)}
			{isUnsupported ? (
				<span className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-sm text-muted-foreground">
					<span className="min-w-0 truncate">{label}</span>
					{maskBadge}
				</span>
			) : (
				<button
					type="button"
					aria-current={isSelected ? 'true' : undefined}
					className={cn(
						'flex min-h-9 min-w-0 flex-1 pointer-coarse:min-h-11 items-center gap-1.5 rounded-sm px-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
						compact && 'min-h-10 px-2',
						!showControls && 'min-w-11 justify-center',
					)}
					onClick={onSelect}
				>
					<span className="min-w-0 truncate">{label}</span>
					{maskBadge}
					{instance.enabled ? null : (
						<Badge variant="outline">
							<EyeOffIcon aria-hidden="true" />
							Off
						</Badge>
					)}
				</button>
			)}
			{isUnsupported || !showControls ? null : (
				<Switch
					aria-label={label}
					checked={instance.enabled}
					onCheckedChange={onToggleEnabled}
				/>
			)}
			{showControls ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={`${label} actions`}
							className={compact ? 'h-11 w-11' : undefined}
						>
							<MoreVerticalIcon aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							disabled={index === 0}
							onSelect={() => {
								onMove(index - 1);
							}}
						>
							{moveUpLabel}
							<DropdownMenuShortcut>Alt+Up</DropdownMenuShortcut>
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={index >= total - 1}
							onSelect={() => {
								onMove(index + 1);
							}}
						>
							{moveDownLabel}
							<DropdownMenuShortcut>Alt+Down</DropdownMenuShortcut>
						</DropdownMenuItem>
						{isUnsupported ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive" onSelect={onRemove}>
									Remove
								</DropdownMenuItem>
							</>
						) : (
							<>
								<DropdownMenuItem onSelect={onDuplicate}>
									Duplicate
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive" onSelect={onRemove}>
									Remove
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</li>
	);
}
