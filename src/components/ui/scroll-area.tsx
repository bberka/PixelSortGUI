import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ComponentProps,
	type Ref,
} from 'react';
import {ScrollArea as ScrollAreaPrimitive} from 'radix-ui';
import {cn} from '@/lib/utils';

const SCROLLING_LINGER_MS = 800;

export type ScrollAreaProps = ComponentProps<
	typeof ScrollAreaPrimitive.Root
> & {
	/**
	 Which scrollbars can appear. A scrollbar only mounts on an axis that
	 overflows.
	 */
	readonly orientation?: 'vertical' | 'horizontal' | 'both';
	/**
	 Whether the viewport is an explicit tab stop. Pass `false` where the
	 browser's own rule for scrollers should decide, as it did for the plain
	 `overflow-auto` element this replaces.
	 */
	readonly tabStop?: boolean;
	readonly viewportRef?: Ref<HTMLDivElement>;
	readonly viewportClassName?: string;
};

/**
 The one scroll container of the app (DESIGN.md 5.4). Radix hides the native
 scrollbar, so the bar is the same overlay thumb in Chromium and Firefox.
 */
function ScrollArea({
	className,
	children,
	orientation = 'vertical',
	tabStop = true,
	viewportRef,
	viewportClassName,
	...props
}: ScrollAreaProps) {
	const [scrolling, setScrolling] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(
		() => () => {
			clearTimeout(timer.current);
		},
		[],
	);

	const handleScroll = useCallback(() => {
		setScrolling(true);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			setScrolling(false);
		}, SCROLLING_LINGER_MS);
	}, []);

	return (
		<ScrollAreaPrimitive.Root
			data-slot="scroll-area"
			data-scrolling={scrolling ? '' : undefined}
			type="auto"
			className={cn('group/scroll relative overflow-hidden', className)}
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				ref={viewportRef}
				data-slot="scroll-area-viewport"
				tabIndex={tabStop ? 0 : undefined}
				className={cn(
					'size-full max-h-[inherit] rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
					viewportClassName,
				)}
				onScroll={handleScroll}
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			{orientation === 'horizontal' ? null : <ScrollBar />}
			{orientation === 'vertical' ? null : (
				<ScrollBar orientation="horizontal" />
			)}
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	);
}

/**
 The scrollbar is a transparent 12 px strip, so the grab target stays wide, and
 the thumb is whatever the strip's padding leaves: 4 px at rest, 8 px while
 the pointer is on the strip or the thumb is held.
 */
function ScrollBar({
	className,
	orientation = 'vertical',
	...props
}: ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
	const [dragging, setDragging] = useState(false);
	const release = () => {
		setDragging(false);
	};

	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			data-slot="scroll-area-scrollbar"
			data-dragging={dragging ? '' : undefined}
			orientation={orientation}
			className={cn(
				'flex touch-none bg-transparent opacity-0 transition-[opacity,padding] duration-150 select-none group-focus-within/scroll:opacity-100 group-hover/scroll:opacity-100 group-data-[scrolling]/scroll:opacity-100 data-[dragging]:opacity-100 motion-reduce:transition-none',
				orientation === 'vertical' &&
					'h-full w-3 pr-0.5 pl-1.5 hover:pl-0.5 data-[dragging]:pl-0.5',
				orientation === 'horizontal' &&
					'h-3 flex-col pt-1.5 pb-0.5 hover:pt-0.5 data-[dragging]:pt-0.5',
				className,
			)}
			{...props}
			onPointerDown={(event) => {
				setDragging(true);
				props.onPointerDown?.(event);
			}}
			onPointerUp={(event) => {
				release();
				props.onPointerUp?.(event);
			}}
			onPointerCancel={(event) => {
				release();
				props.onPointerCancel?.(event);
			}}
			onLostPointerCapture={(event) => {
				release();
				props.onLostPointerCapture?.(event);
			}}
		>
			<ScrollAreaPrimitive.ScrollAreaThumb
				data-slot="scroll-area-thumb"
				className="relative flex-1 rounded-full bg-muted-foreground"
			/>
		</ScrollAreaPrimitive.ScrollAreaScrollbar>
	);
}

export {ScrollArea, ScrollBar};
