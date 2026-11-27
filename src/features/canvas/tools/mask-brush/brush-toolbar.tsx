import {useRef, type ComponentType, type ReactNode} from 'react';
import {CheckIcon, BrushIcon, EraserIcon, EyeIcon} from 'lucide-react';
import {Toolbar} from 'radix-ui';
import type {CanvasToolbarProps} from '../types.ts';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {buttonVariants} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useShortcutHint} from '@/lib/keyboard-hints.ts';
import {cn} from '@/lib/utils';

const PRESSED =
	'aria-checked:bg-primary aria-checked:text-primary-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground';

function Item({
	label,
	tooltip,
	row,
	icon: Icon,
	children,
}: {
	readonly label: string;
	readonly tooltip: string;
	readonly row: boolean;
	readonly icon: ComponentType<{'aria-hidden': 'true'}>;
	// The toolbar part that makes the button a control.
	readonly children: (button: ReactNode, className: string) => ReactNode;
}) {
	const button = (
		<>
			<Icon aria-hidden="true" />
			{row ? <span>{label}</span> : null}
		</>
	);
	const className = cn(
		buttonVariants({variant: 'ghost', size: row ? 'default' : 'icon'}),
		PRESSED,
		row
			? 'h-11 min-w-11 flex-1 flex-col gap-0.5 px-0 py-0 text-[11px] leading-3 font-medium has-[>svg]:px-0'
			: 'size-9 pointer-coarse:size-11',
	);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{/* The wrapper carries the tooltip's state, so it cannot overwrite
				    the control's own. */}
				<span className={row ? 'flex min-w-0 flex-1' : 'inline-flex'}>
					{children(button, className)}
				</span>
			</TooltipTrigger>
			<TooltipContent side={row ? 'top' : 'right'}>{tooltip}</TooltipContent>
		</Tooltip>
	);
}

/**
 Paint or erase, the overlay switch and "Done" (DESIGN.md section 7.4): a
 vertical strip over the canvas, or a row in place of a phone's effect strip.
 */
export function BrushToolbar({layout}: CanvasToolbarProps) {
	const tool = useAppStore((state) => state.activeBrush?.tool);
	const setBrushTool = useAppStore((state) => state.setBrushTool);
	const setBrush = useAppStore((state) => state.setBrush);
	const visible = useAppStore((state) => state.maskOverlay.visible);
	const setMaskOverlay = useAppStore((state) => state.setMaskOverlay);
	const hint = useShortcutHint();
	const row = layout === 'row';
	const tabbingBackOutRef = useRef(false);
	const separator = (
		<Toolbar.Separator
			className={cn('shrink-0 bg-border', row ? 'h-6 w-px' : 'h-px w-full')}
		/>
	);

	return (
		<Toolbar.Root
			aria-label="Mask brush"
			data-slot="brush-toolbar"
			orientation={row ? 'horizontal' : 'vertical'}
			className={
				row
					? 'flex h-full w-full items-center gap-1 px-2'
					: 'flex flex-col items-center gap-1 rounded-md border border-border bg-card p-1'
			}
			// As in `ToggleGroup`: Radix updates the container's tab stop too late
			// for Firefox, which then traps Shift+Tab inside the toolbar.
			onKeyDownCapture={(event) => {
				if (!(
					event.key === 'Tab' &&
					event.shiftKey &&
					event.currentTarget.tabIndex === 0
				)) {
					return;
				}

				tabbingBackOutRef.current = true;
				event.currentTarget.tabIndex = -1;
			}}
			onBlur={(event) => {
				if (
					!tabbingBackOutRef.current ||
					event.currentTarget.contains(event.relatedTarget)
				) {
					return;
				}

				tabbingBackOutRef.current = false;
				event.currentTarget.tabIndex = 0;
			}}
		>
			<Toolbar.ToggleGroup
				type="single"
				aria-label="Tool"
				className={row ? 'flex flex-[2] gap-1' : 'flex flex-col gap-1'}
				value={tool ?? ''}
				onValueChange={(next) => {
					if (next === 'paint' || next === 'erase') {
						setBrushTool(next);
					}
				}}
			>
				<Item
					icon={BrushIcon}
					label="Paint"
					row={row}
					tooltip={hint('Paint', 'X')}
				>
					{(button, className) => (
						<Toolbar.ToggleItem
							aria-label="Paint"
							className={className}
							value="paint"
						>
							{button}
						</Toolbar.ToggleItem>
					)}
				</Item>
				<Item
					icon={EraserIcon}
					label="Erase"
					row={row}
					tooltip={hint('Erase', 'X')}
				>
					{(button, className) => (
						<Toolbar.ToggleItem
							aria-label="Erase"
							className={className}
							value="erase"
						>
							{button}
						</Toolbar.ToggleItem>
					)}
				</Item>
			</Toolbar.ToggleGroup>
			{separator}
			<Item
				icon={EyeIcon}
				label="Show mask"
				row={row}
				tooltip={hint('Show mask', 'M')}
			>
				{(button, className) => (
					<Toolbar.Button
						aria-label="Show mask"
						aria-pressed={visible}
						className={className}
						onClick={() => {
							setMaskOverlay({visible: !visible});
							announce(visible ? 'Mask hidden' : 'Mask shown');
						}}
					>
						{button}
					</Toolbar.Button>
				)}
			</Item>
			<Item icon={CheckIcon} label="Done" row={row} tooltip={hint('Done', 'B')}>
				{(button, className) => (
					<Toolbar.Button
						aria-label="Done"
						className={className}
						onClick={() => {
							setBrush(null);
						}}
					>
						{button}
					</Toolbar.Button>
				)}
			</Item>
		</Toolbar.Root>
	);
}
