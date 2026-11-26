import type * as React from 'react';
import {Switch as SwitchPrimitive} from 'radix-ui';
import {cn} from '@/lib/utils';

function Switch({
	className,
	size = 'default',
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
	readonly size?: 'sm' | 'default';
}) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(
				'peer group/switch inline-flex shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:min-h-6 data-[size=default]:min-w-9 data-[size=sm]:min-h-6 data-[size=sm]:min-w-7',
				className,
			)}
			{...props}
		>
			<span
				data-slot="switch-track"
				className="inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors group-data-[size=default]/switch:h-5 group-data-[size=default]/switch:w-9 group-data-[size=sm]/switch:h-4 group-data-[size=sm]/switch:w-7 group-data-[state=checked]/switch:bg-accent group-data-[state=unchecked]/switch:bg-input"
			>
				<SwitchPrimitive.Thumb
					data-slot="switch-thumb"
					className="pointer-events-none block rounded-full transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=checked]:bg-accent-foreground data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-foreground"
				/>
			</span>
		</SwitchPrimitive.Root>
	);
}

export {Switch};
