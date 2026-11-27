import {useId, useState, type Ref} from 'react';
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
import {ScrollArea} from '@/components/ui/scroll-area';
import {listedEffects} from '@/engine/registry.ts';
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
			{listedEffects(registry).map((definition) => (
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
	/**
	On phones the button is the plus icon alone unless this asks for its words.
	*/
	readonly labelled?: boolean;
	readonly disabled: boolean;
	readonly describedBy?: string;
	readonly triggerRef?: Ref<HTMLButtonElement>;
	readonly onAdd: (type: string) => void;
};

export function AddEffectPicker({
	registry,
	compact,
	labelled = false,
	disabled,
	describedBy,
	triggerRef,
	onAdd,
}: AddEffectPickerProps) {
	const [open, setOpen] = useState(false);
	const titleId = useId();

	const trigger = (
		<Button
			ref={triggerRef}
			type="button"
			variant="outline"
			size="sm"
			aria-label="Add effect"
			aria-describedby={describedBy}
			disabled={disabled}
			className={cn(
				compact && 'h-11 min-w-11 shrink-0',
				compact && !labelled && 'w-11 px-0',
				!compact && 'w-full justify-start',
			)}
		>
			<PlusIcon aria-hidden="true" />
			{compact && !labelled ? null : <span>Add effect</span>}
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
					<ScrollArea tabStop={false} className="-mx-1 max-h-[60dvh]">
						<EffectOptions registry={registry} className="p-1" onAdd={add} />
					</ScrollArea>
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
				// The list outgrows short windows; it scrolls inside the space Radix
				// says is free below or above the trigger.
				className="flex max-h-(--radix-popover-content-available-height) w-72 flex-col p-1"
			>
				<p
					id={titleId}
					className="px-2 py-1.5 text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase"
				>
					Add effect
				</p>
				<ScrollArea
					tabStop={false}
					className="flex min-h-0 flex-col"
					viewportClassName="min-h-0 flex-1"
				>
					<EffectOptions registry={registry} className="p-0.5" onAdd={add} />
				</ScrollArea>
			</PopoverContent>
		</Popover>
	);
}
