import {useId, type ReactNode} from 'react';
import {
	ArrowLeftRightIcon,
	ArrowUpDownIcon,
	CopyIcon,
	RotateCwSquareIcon,
} from 'lucide-react';
import {announce} from '@/app/announcer.ts';
import {useAppStore, useTransientStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useShortcutHint} from '@/lib/keyboard-hints.ts';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';
import {cn} from '@/lib/utils';
import {
	orientationAnnouncement,
	orientationSwitchLabel,
	otherSide,
	selectEditingSide,
	selectEditingStack,
	selectSplitOrientation,
	sideLetter,
	sideOptionLabel,
} from '@/state/split-sides.ts';

function SideAction({
	label,
	tooltip,
	disabled,
	onClick,
	children,
}: {
	readonly label: string;
	readonly tooltip: string;
	readonly disabled: boolean;
	readonly onClick: () => void;
	readonly children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex shrink-0">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={label}
						disabled={disabled}
						onClick={onClick}
					>
						{children}
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}

/**
 Chooses which split side the stack, parameters and presets act on, and copies
 or swaps the two stacks. Present only while the split view is on.
 */
export function SplitSideSwitcher() {
	const visible = useAppStore(
		(state) => state.compareMode === 'split' && state.activeProject !== null,
	);
	const side = useAppStore(selectEditingSide);
	const orientation = useAppStore(selectSplitOrientation);
	const editingEmpty = useAppStore(
		(state) => (selectEditingStack(state)?.instances.length ?? 0) === 0,
	);
	const bothEmpty = useAppStore(
		(state) =>
			(state.activeProject?.stack.instances.length ?? 0) +
				(state.activeProject?.stackA?.instances.length ?? 0) ===
			0,
	);
	const setEditSide = useAppStore((state) => state.setEditSide);
	const copyToOtherSide = useAppStore((state) => state.copyToOtherSide);
	const swapSides = useAppStore((state) => state.swapSides);
	const setSplitOrientation = useAppStore((state) => state.setSplitOrientation);
	const cropping = useTransientStore((state) => state.geometry.cropping);
	const compact = usePhoneLayout();
	const hint = useShortcutHint();
	const labelId = useId();

	if (!visible) {
		return null;
	}

	const from = sideLetter(side);
	const to = sideLetter(otherSide(side));
	const SwapIcon =
		orientation === 'vertical' ? ArrowLeftRightIcon : ArrowUpDownIcon;

	return (
		<div
			data-slot="split-side-switcher"
			className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-2"
		>
			<span
				id={labelId}
				className={cn(
					'shrink-0 text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase',
					compact && 'sr-only',
				)}
			>
				Editing
			</span>
			<ToggleGroup
				type="single"
				variant="outline"
				size="sm"
				aria-labelledby={labelId}
				className="min-w-0 flex-1"
				value={side}
				onValueChange={(next) => {
					if (next !== 'a' && next !== 'b') {
						return;
					}

					void setEditSide(next).then(() => {
						announce(`Editing side ${sideLetter(next)}`);
					});
				}}
			>
				<ToggleGroupItem value="a" className="flex-1">
					{sideOptionLabel('a', orientation)}
				</ToggleGroupItem>
				<ToggleGroupItem value="b" className="flex-1">
					{sideOptionLabel('b', orientation)}
				</ToggleGroupItem>
			</ToggleGroup>
			<SideAction
				label="Copy to other side"
				tooltip={`Copy ${from} to ${to}`}
				disabled={editingEmpty}
				onClick={() => {
					void copyToOtherSide().then(() => {
						announce(`Copied side ${from} to side ${to}`);
					});
				}}
			>
				<CopyIcon aria-hidden="true" />
			</SideAction>
			<SideAction
				label="Swap sides"
				tooltip="Swap sides"
				disabled={bothEmpty}
				onClick={() => {
					void swapSides().then(() => {
						announce('Swapped sides');
					});
				}}
			>
				<SwapIcon aria-hidden="true" />
			</SideAction>
			{compact ? (
				<SideAction
					label={orientationSwitchLabel(orientation)}
					tooltip={hint(orientationSwitchLabel(orientation), 'Shift+S')}
					disabled={cropping}
					onClick={() => {
						const next = orientation === 'vertical' ? 'horizontal' : 'vertical';
						setSplitOrientation(next);
						announce(orientationAnnouncement(next));
					}}
				>
					<RotateCwSquareIcon aria-hidden="true" />
				</SideAction>
			) : null}
		</div>
	);
}
