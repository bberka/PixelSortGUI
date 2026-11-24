import * as React from 'react';
import {Slider as SliderPrimitive} from 'radix-ui';
import {cn} from '@/lib/utils';

function Slider({
	className,
	defaultValue,
	value,
	min = 0,
	max = 100,
	thumbLabels,
	...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
	readonly thumbLabels?: readonly string[];
}) {
	const values = React.useMemo(
		() =>
			Array.isArray(value)
				? value
				: Array.isArray(defaultValue)
					? defaultValue
					: [min, max],
		[value, defaultValue, min, max],
	);

	return (
		<SliderPrimitive.Root
			data-slot="slider"
			defaultValue={defaultValue}
			value={value}
			min={min}
			max={max}
			className={cn(
				'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
				className,
			)}
			{...props}
		>
			<SliderPrimitive.Track
				data-slot="slider-track"
				className="relative grow overflow-hidden rounded-full bg-muted border border-border data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2"
			>
				<SliderPrimitive.Range
					data-slot="slider-range"
					className="absolute bg-accent data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
				/>
			</SliderPrimitive.Track>
			{Array.from({length: values.length}, (_, index) => (
				<SliderPrimitive.Thumb
					key={index}
					data-slot="slider-thumb"
					aria-label={thumbLabels?.[index]}
					className="block size-4 shrink-0 rounded-full border-2 border-card bg-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
				/>
			))}
		</SliderPrimitive.Root>
	);
}

export {Slider};
