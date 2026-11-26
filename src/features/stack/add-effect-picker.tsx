import {useId, useState} from 'react';
import {PlusIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import type {EffectRegistry} from '@/engine/types.ts';
import {cn} from '@/lib/utils';

export type EffectOptionsProps = {
	readonly registry: EffectRegistry;
	readonly onAdd: (type: string) => void;
	readonly className?: string;
};

/**
 Built from the registry so an effect type registered later appears here with
 no change to this file (AC-F4.1).
 */
export function EffectOptions({
	registry,
	onAdd,
	className,
}: EffectOptionsProps) {
	return (
		<ul className={cn('flex flex-col gap-0.5', className)}>
			{registry.list().map((definition) => (
				<li key={definition.type}>
					<button
						type="button"
						className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						onClick={() => {
							onAdd(definition.type);
						}}
					>
						<span className="text-sm font-medium">{definition.label}</span>
						<span className="text-xs text-muted-foreground">
							{definition.description}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

export type AddEffectPickerProps = {
	readonly registry: EffectRegistry;
	readonly compact: boolean;
	readonly disabled: boolean;
	readonly describedBy?: string;
	readonly onAdd: (type: string) => void;
};

export function AddEffectPicker({
	registry,
	compact,
	disabled,
	describedBy,
	onAdd,
}: AddEffectPickerProps) {
	const [open, setOpen] = useState(false);
	const titleId = useId();

	const trigger = (
		<Button
			type="button"
			variant="outline"
			size="sm"
			aria-label="Add effect"
			aria-describedby={describedBy}
			disabled={disabled}
			className={compact ? 'h-11 w-11 px-0' : 'w-full justify-start'}
		>
			<PlusIcon aria-hidden="true" />
			{compact ? null : <span>Add effect</span>}
		</Button>
	);

	const add = (type: string) => {
		onAdd(type);
		setOpen(false);
	};

	if (compact) {
		return (
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger asChild>{trigger}</DialogTrigger>
				<DialogContent aria-describedby={undefined}>
					<DialogHeader>
						<DialogTitle>Add effect</DialogTitle>
					</DialogHeader>
					<EffectOptions registry={registry} onAdd={add} />
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				align="start"
				aria-labelledby={titleId}
				className="w-72 p-1"
			>
				<p
					id={titleId}
					className="px-2 py-1.5 text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase"
				>
					Add effect
				</p>
				<EffectOptions registry={registry} onAdd={add} />
			</PopoverContent>
		</Popover>
	);
}
