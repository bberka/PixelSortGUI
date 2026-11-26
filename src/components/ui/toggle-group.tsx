import * as React from 'react';
import type {VariantProps} from 'class-variance-authority';
import {ToggleGroup as ToggleGroupPrimitive} from 'radix-ui';
import {toggleVariants} from '@/components/ui/toggle';
import {cn} from '@/lib/utils';

const ToggleGroupContext = React.createContext<
	VariantProps<typeof toggleVariants> & {
		spacing?: number;
	}
>({
	size: 'default',
	variant: 'default',
	spacing: 0,
});

function ToggleGroup({
	className,
	variant,
	size,
	spacing = 0,
	children,
	onKeyDownCapture,
	onBlur,
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
	VariantProps<typeof toggleVariants> & {
		readonly spacing?: number;
	}) {
	const tabbingBackOutRef = React.useRef(false);
	const contextValue = React.useMemo(
		() => ({variant, size, spacing}),
		[variant, size, spacing],
	);

	return (
		<ToggleGroupPrimitive.Root
			data-slot="toggle-group"
			data-variant={variant}
			data-size={size}
			data-spacing={spacing}
			style={{'--gap': spacing} as React.CSSProperties}
			className={cn(
				'group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-md',
				className,
			)}
			onKeyDownCapture={(event) => {
				// Radix RovingFocusGroup updates the container tabIndex via React state,
				// which does not flush before Firefox resolves Shift+Tab focus traversal.
				if (
					event.key === 'Tab' &&
					event.shiftKey &&
					props.rovingFocus !== false &&
					event.currentTarget.tabIndex === 0
				) {
					tabbingBackOutRef.current = true;
					event.currentTarget.tabIndex = -1;
				}

				onKeyDownCapture?.(event);
			}}
			onBlur={(event) => {
				if (
					tabbingBackOutRef.current &&
					!event.currentTarget.contains(event.relatedTarget)
				) {
					tabbingBackOutRef.current = false;
					event.currentTarget.tabIndex = 0;
				}

				onBlur?.(event);
			}}
			{...props}
		>
			<ToggleGroupContext.Provider value={contextValue}>
				{children}
			</ToggleGroupContext.Provider>
		</ToggleGroupPrimitive.Root>
	);
}

function ToggleGroupItem({
	className,
	children,
	variant,
	size,
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
	VariantProps<typeof toggleVariants>) {
	const context = React.useContext(ToggleGroupContext);

	return (
		<ToggleGroupPrimitive.Item
			data-slot="toggle-group-item"
			data-variant={context.variant || variant}
			data-size={context.size || size}
			data-spacing={context.spacing}
			className={cn(
				toggleVariants({
					variant: context.variant || variant,
					size: context.size || size,
				}),
				'w-auto min-w-0 shrink-0 px-2.5 focus:z-10 focus-visible:z-10',
				'data-[spacing=0]:rounded-none data-[spacing=0]:first:rounded-l-md data-[spacing=0]:last:rounded-r-md data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l',
				className,
			)}
			{...props}
		>
			{children}
		</ToggleGroupPrimitive.Item>
	);
}

export {ToggleGroup, ToggleGroupItem};
