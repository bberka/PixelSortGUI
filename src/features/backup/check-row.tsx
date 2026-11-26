import type {ReactNode} from 'react';
import {Checkbox} from '@/components/ui/checkbox';

/**
 A checkbox in a label that spans the row, so the touch target is the row.
 */
export function CheckRow({
	checked,
	onCheckedChange,
	disabled,
	children,
}: {
	readonly checked: boolean;
	readonly onCheckedChange: (checked: boolean) => void;
	readonly disabled?: boolean;
	readonly children: ReactNode;
}) {
	return (
		<label
			data-slot="check-row"
			className="flex min-h-9 w-full items-center gap-3 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-secondary has-disabled:pointer-events-none has-disabled:opacity-50 pointer-coarse:min-h-11"
		>
			<Checkbox
				checked={checked}
				disabled={disabled}
				onCheckedChange={(value) => {
					onCheckedChange(value === true);
				}}
			/>
			{children}
		</label>
	);
}

/**
 A project row: the name over its size.
 */
export function ProjectRowText({
	name,
	details,
}: {
	readonly name: string;
	readonly details: string;
}) {
	return (
		<span className="flex min-w-0 flex-1 flex-col">
			<span className="truncate font-medium">{name}</span>
			<span className="font-mono text-xs text-muted-foreground tabular-nums">
				{details}
			</span>
		</span>
	);
}
