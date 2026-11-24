import type * as React from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {Toggle as TogglePrimitive} from 'radix-ui';
import {cn} from '@/lib/utils';

const toggleVariants = cva(
	"inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive data-[state=on]:bg-primary data-[state=on]:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: 'bg-transparent text-foreground',
				outline:
					'border border-input bg-card text-foreground hover:bg-secondary hover:text-secondary-foreground',
			},
			size: {
				default: 'h-9 min-w-9 px-2.5',
				sm: 'h-8 min-w-8 px-2 text-xs',
				lg: 'h-10 min-w-10 px-3',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

function Toggle({
	className,
	variant,
	size,
	...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
	VariantProps<typeof toggleVariants>) {
	return (
		<TogglePrimitive.Root
			data-slot="toggle"
			className={cn(toggleVariants({variant, size, className}))}
			{...props}
		/>
	);
}

export {Toggle, toggleVariants};
