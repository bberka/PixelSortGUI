import * as React from 'react';
import {Slider as SliderPrimitive} from 'radix-ui';
import {cn} from '@/lib/utils';

export const SLIDER_VARIANTS = ['fader', 'fill-bar', 'stepped'] as const;

export type SliderVariant = (typeof SLIDER_VARIANTS)[number];

/**
 Default slider presentation used across the parameter panel and export dialog.
 Change this single constant to switch the app-wide slider style.
 */
export const DEFAULT_SLIDER_VARIANT: SliderVariant = 'fader';

const STEPPED_CELLS = 16;

function isSliderVariant(value: string | undefined): value is SliderVariant {
	return (
		value !== undefined &&
		(SLIDER_VARIANTS as readonly string[]).includes(value)
	);
}

function resolveVariant(explicit?: SliderVariant): SliderVariant {
	if (explicit !== undefined) {
		return explicit;
	}

	if (typeof document !== 'undefined') {
		const override = document.documentElement.dataset.sliderVariant;
		if (isSliderVariant(override)) {
			return override;
		}
	}

	return DEFAULT_SLIDER_VARIANT;
}

function percentOf(value: number, min: number, max: number): number {
	if (max <= min) {
		return 0;
	}

	const ratio = (value - min) / (max - min);
	return Math.max(0, Math.min(100, ratio * 100));
}

function normalizeMarks(
	defaultMark: number | readonly [number, number] | undefined,
): readonly number[] {
	if (defaultMark === undefined) {
		return [];
	}

	return typeof defaultMark === 'number' ? [defaultMark] : defaultMark;
}

export type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
	readonly thumbLabels?: readonly string[];
	readonly variant?: SliderVariant;
	readonly defaultMark?: number | readonly [number, number];
};

function Slider({
	className,
	defaultValue,
	value,
	min = 0,
	max = 100,
	thumbLabels,
	variant,
	defaultMark,
	...props
}: SliderProps) {
	const activeVariant = resolveVariant(variant);
	const values = React.useMemo(
		() =>
			Array.isArray(value)
				? value
				: Array.isArray(defaultValue)
					? defaultValue
					: [min],
		[value, defaultValue, min],
	);
	const marks = React.useMemo(
		() => normalizeMarks(defaultMark).map((mark) => percentOf(mark, min, max)),
		[defaultMark, min, max],
	);

	const lowPct = values.length >= 2 ? percentOf(values[0] ?? min, min, max) : 0;
	const highPct = percentOf(
		values.length >= 2 ? (values[1] ?? max) : (values[0] ?? min),
		min,
		max,
	);

	return (
		<SliderPrimitive.Root
			data-slot="slider"
			data-variant={activeVariant}
			defaultValue={defaultValue}
			value={value}
			min={min}
			max={max}
			className={cn(
				// A swipe up or down that starts on a slider scrolls the panel; the
				// cancelled pointer drops the dragged value (DESIGN.md section 5.1).
				'relative flex w-full touch-none items-center select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 pointer-coarse:touch-pan-y',
				activeVariant === 'stepped' ? 'h-7' : 'h-8',
				'pointer-coarse:h-11',
				className,
			)}
			{...props}
		>
			{activeVariant === 'fader' ? (
				<>
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between"
					>
						<span className="h-4 w-px bg-input" />
						<span className="h-4 w-px bg-input" />
					</span>
					<SliderPrimitive.Track
						data-slot="slider-track"
						className="relative h-2.5 w-full grow overflow-hidden rounded-sm border border-input bg-muted"
					>
						<SliderPrimitive.Range
							data-slot="slider-range"
							className="absolute h-full bg-accent"
						/>
					</SliderPrimitive.Track>
					{marks.map((pct, index) => (
						<span
							key={`mark-${index}`}
							aria-hidden="true"
							data-slot="slider-default-mark"
							className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70"
							style={{left: `${pct}%`}}
						/>
					))}
				</>
			) : null}

			{activeVariant === 'fill-bar' ? (
				<>
					<SliderPrimitive.Track
						data-slot="slider-track"
						className="relative h-8 w-full grow overflow-hidden rounded-md border border-input bg-muted"
					>
						<SliderPrimitive.Range
							data-slot="slider-range"
							className="absolute h-full bg-accent"
						/>
					</SliderPrimitive.Track>
					{marks.map((pct, index) => (
						<span
							key={`mark-${index}`}
							aria-hidden="true"
							data-slot="slider-default-mark"
							className="pointer-events-none absolute top-0.5 h-2 w-0.5 -translate-x-1/2 rounded-full bg-foreground/80"
							style={{left: `${pct}%`}}
						/>
					))}
				</>
			) : null}

			{activeVariant === 'stepped' ? (
				<>
					<SliderPrimitive.Track
						data-slot="slider-track"
						className="relative flex h-7 w-full grow items-center gap-0.5"
					>
						<SliderPrimitive.Range
							data-slot="slider-range"
							className="pointer-events-none absolute h-full opacity-0"
						/>
						{Array.from({length: STEPPED_CELLS}, (_, cellIndex) => {
							const cellCenter = ((cellIndex + 0.5) / STEPPED_CELLS) * 100;
							const lit = cellCenter >= lowPct && cellCenter <= highPct;
							return (
								<span
									key={cellIndex}
									aria-hidden="true"
									data-cell-lit={lit ? 'true' : 'false'}
									className={cn(
										'h-5 flex-1 rounded-[2px] border transition-colors',
										lit ? 'border-accent bg-accent' : 'border-input bg-muted',
									)}
								/>
							);
						})}
					</SliderPrimitive.Track>
					{marks.map((pct, index) => (
						<span
							key={`mark-${index}`}
							aria-hidden="true"
							data-slot="slider-default-mark"
							className="pointer-events-none absolute bottom-0 h-1.5 w-1 -translate-x-1/2 rounded-xs bg-foreground"
							style={{left: `${pct}%`}}
						/>
					))}
				</>
			) : null}

			{Array.from({length: values.length}, (_, index) => (
				<SliderPrimitive.Thumb
					key={index}
					data-slot="slider-thumb"
					aria-label={thumbLabels?.[index]}
					className={cn(
						'group/thumb flex shrink-0 cursor-grab items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing disabled:pointer-events-none',
						activeVariant === 'fill-bar'
							? 'h-8 w-6 rounded-md'
							: 'h-7 w-6 rounded-sm',
						'pointer-coarse:h-11 pointer-coarse:w-11',
					)}
				>
					{activeVariant === 'fader' ? (
						<span
							aria-hidden="true"
							className="flex h-6 w-3 items-center justify-center rounded-sm border-2 border-foreground bg-card transition-colors group-hover/thumb:border-accent"
						>
							<span className="h-3 w-0.5 rounded-full bg-foreground transition-colors group-hover/thumb:bg-accent" />
						</span>
					) : null}
					{activeVariant === 'fill-bar' ? (
						<span
							aria-hidden="true"
							className="h-5 w-1.5 rounded-full border border-foreground bg-card transition-colors group-hover/thumb:border-accent"
						/>
					) : null}
					{activeVariant === 'stepped' ? (
						<span
							aria-hidden="true"
							className="h-6 w-2.5 rounded-[2px] border-2 border-card bg-foreground transition-colors group-hover/thumb:bg-accent"
						/>
					) : null}
				</SliderPrimitive.Thumb>
			))}
		</SliderPrimitive.Root>
	);
}

export {Slider};
