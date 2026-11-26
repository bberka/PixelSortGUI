import {
	useEffect,
	useLayoutEffect,
	useRef,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent,
	type RefObject,
} from 'react';
import {
	arrowDelta,
	aspectRatio,
	CROP_HANDLES,
	moveCrop,
	resizeCrop,
	type CropHandle,
} from './crop-math.ts';
import {
	geometryController,
	onSavedGeometryChange,
} from './geometry-controller.ts';
import {announce} from '@/app/announcer.ts';
import {
	useAppRuntime,
	useAppStore,
	useTransientStore,
} from '@/app/runtime-context.tsx';
import type {CropRect} from '@/engine/transform.ts';
import {imageRect, type CanvasView, type Size} from '@/features/canvas/view.ts';
import {
	isEditableTarget,
	isModalDialogOpen,
} from '@/features/toolbar/shortcuts.ts';
import {cn} from '@/lib/utils';
import {draftCrop, projectOrientedDimensions} from '@/state/geometry.ts';

export type CropOverlayProps = {
	// The view the canvas is drawn with right now.
	readonly readView: () => {view: CanvasView; viewport: Size} | null;
	// The canvas calls this after every draw, so the box follows zoom and pan.
	readonly placeRef: RefObject<(() => void) | null>;
};

const HANDLES: Readonly<
	Record<CropHandle, {label: string; position: string; cursor: string}>
> = {
	nw: {
		label: 'Top left',
		position: 'top-0 left-0',
		cursor: 'cursor-nwse-resize',
	},
	n: {label: 'Top', position: 'top-0 left-1/2', cursor: 'cursor-ns-resize'},
	ne: {
		label: 'Top right',
		position: 'top-0 left-full',
		cursor: 'cursor-nesw-resize',
	},
	e: {
		label: 'Right',
		position: 'top-1/2 left-full',
		cursor: 'cursor-ew-resize',
	},
	se: {
		label: 'Bottom right',
		position: 'top-full left-full',
		cursor: 'cursor-nwse-resize',
	},
	s: {
		label: 'Bottom',
		position: 'top-full left-1/2',
		cursor: 'cursor-ns-resize',
	},
	sw: {
		label: 'Bottom left',
		position: 'top-full left-0',
		cursor: 'cursor-nesw-resize',
	},
	w: {label: 'Left', position: 'top-1/2 left-0', cursor: 'cursor-ew-resize'},
};

const GUIDES = [
	'inset-y-0 left-1/3 w-px',
	'inset-y-0 left-2/3 w-px',
	'inset-x-0 top-1/3 h-px',
	'inset-x-0 top-2/3 h-px',
];

type HandleDrag = {
	pointerId: number;
	clientX: number;
	clientY: number;
	start: CropRect;
};

function setPosition(
	element: HTMLElement | null,
	{
		left,
		top,
		width,
		height,
	}: {left: number; top: number; width: number; height: number},
): void {
	if (!element) {
		return;
	}

	element.style.left = `${left}px`;
	element.style.top = `${top}px`;
	element.style.width = `${width}px`;
	element.style.height = `${height}px`;
}

/**
 The crop box over the canvas in crop mode (DESIGN.md section 7.2): the dimmed
 outside, the border, and the focusable move control and handles. The box body
 ignores the pointer; the canvas moves it, so pan and pinch keep working.
 */
export function CropOverlay({readView, placeRef}: CropOverlayProps) {
	const {bundle} = useAppRuntime();
	const project = useAppStore((state) => state.activeProject);
	const draft = useTransientStore((state) => state.geometry.draft);
	const dragging = useTransientStore((state) => state.geometry.dragging);
	const maskRef = useRef<HTMLDivElement | null>(null);
	const shadeRef = useRef<HTMLDivElement | null>(null);
	const boxRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<HandleDrag | null>(null);

	useLayoutEffect(() => {
		const place = () => {
			const current = readView();
			if (!current || !project) {
				return;
			}

			const crop = draftCrop(
				project,
				bundle.transientStore.getState().geometry.draft,
			);
			const {view, viewport} = current;
			const image = imageRect(
				view,
				projectOrientedDimensions(project),
				viewport,
			);
			const box = {
				left: crop.x * view.zoom,
				top: crop.y * view.zoom,
				width: crop.width * view.zoom,
				height: crop.height * view.zoom,
			};
			setPosition(maskRef.current, image);
			setPosition(shadeRef.current, box);
			setPosition(boxRef.current, {
				...box,
				left: image.left + box.left,
				top: image.top + box.top,
			});
		};

		placeRef.current = place;
		place();
		return () => {
			placeRef.current = null;
		};
	}, [bundle, draft, placeRef, project, readView]);

	useEffect(
		() =>
			onSavedGeometryChange(bundle, () => {
				if (!dragRef.current) {
					return;
				}

				dragRef.current = null;
				geometryController(bundle).setDragging(false);
			}),
		[bundle],
	);

	// Escape cancels from anywhere that has no use for it; Enter applies from the
	// canvas. The box's own controls handle Enter themselves.
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				isEditableTarget(event.target) ||
				isModalDialogOpen(globalThis.document)
			) {
				return;
			}

			const controller = geometryController(bundle);
			if (event.key === 'Escape') {
				event.preventDefault();
				controller.cancelCrop();
				return;
			}

			const {target} = event;
			if (!(
				event.key === 'Enter' &&
				(target === globalThis.document.body ||
					target instanceof HTMLCanvasElement)
			)) {
				return;
			}

			event.preventDefault();
			void controller.applyCrop();
		};

		globalThis.addEventListener('keydown', handleKeyDown);
		return () => {
			globalThis.removeEventListener('keydown', handleKeyDown);
		};
	}, [bundle]);

	if (!project) {
		return null;
	}

	const bounds = projectOrientedDimensions(project);
	const currentBox = () =>
		draftCrop(project, bundle.transientStore.getState().geometry.draft);
	const lockedRatio = () =>
		aspectRatio(bundle.transientStore.getState().geometry.aspect, bounds);
	const handleKey = (
		event: ReactKeyboardEvent,
		change: (box: CropRect, delta: {dx: number; dy: number}) => CropRect,
	) => {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			void geometryController(bundle).applyCrop();
			return;
		}

		const delta = arrowDelta(event.key, event.shiftKey);
		if (!delta) {
			return;
		}

		event.preventDefault();
		const next = change(currentBox(), delta);
		geometryController(bundle).setBox(next);
		announce(`Crop ${next.width} × ${next.height} at ${next.x}, ${next.y}`);
	};

	const startHandleDrag = (event: PointerEvent<HTMLButtonElement>) => {
		if (event.pointerType === 'mouse' && event.button !== 0) {
			return;
		}

		event.preventDefault();
		event.currentTarget.focus({preventScroll: true});
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}

		dragRef.current = {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			start: currentBox(),
		};
		geometryController(bundle).setDragging(true);
	};

	const moveHandle = (
		event: PointerEvent<HTMLButtonElement>,
		handle: CropHandle,
	) => {
		const drag = dragRef.current;
		const current = readView();
		if (drag?.pointerId !== event.pointerId || !current) {
			return;
		}

		const {zoom} = current.view;
		geometryController(bundle).setBox(
			resizeCrop(
				drag.start,
				handle,
				{
					dx: (event.clientX - drag.clientX) / zoom,
					dy: (event.clientY - drag.clientY) / zoom,
				},
				lockedRatio(),
				bounds,
			),
		);
	};

	const endHandleDrag = (
		event: PointerEvent<HTMLButtonElement>,
		keep: boolean,
	) => {
		const drag = dragRef.current;
		if (drag?.pointerId !== event.pointerId) {
			return;
		}

		dragRef.current = null;
		if (!keep) {
			geometryController(bundle).setBox(drag.start);
		}

		geometryController(bundle).setDragging(false);
	};

	return (
		<div
			data-slot="crop-overlay"
			className="pointer-events-none absolute inset-0 overflow-clip"
		>
			<div ref={maskRef} aria-hidden="true" className="absolute overflow-clip">
				<div ref={shadeRef} className="crop-shade absolute" />
			</div>
			<div ref={boxRef} data-slot="crop-box" className="absolute">
				<div aria-hidden="true" className="crop-border absolute inset-0" />
				{dragging
					? GUIDES.map((guide) => (
							<div
								key={guide}
								aria-hidden="true"
								data-slot="crop-guide"
								className={cn('crop-guide absolute', guide)}
							/>
						))
					: null}
				<button
					type="button"
					aria-label="Move crop box"
					className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
					onKeyDown={(event) => {
						handleKey(event, (box, {dx, dy}) => moveCrop(box, dx, dy, bounds));
					}}
				/>
				{CROP_HANDLES.map((handle) => {
					const {label, position, cursor} = HANDLES[handle];
					return (
						<button
							key={handle}
							type="button"
							data-crop-handle={handle}
							aria-label={`${label} crop handle`}
							className={cn(
								'pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:size-11',
								position,
								cursor,
							)}
							onKeyDown={(event) => {
								handleKey(event, (box, delta) =>
									resizeCrop(box, handle, delta, lockedRatio(), bounds),
								);
							}}
							onPointerDown={startHandleDrag}
							onPointerMove={(event) => {
								moveHandle(event, handle);
							}}
							onPointerUp={(event) => {
								endHandleDrag(event, true);
							}}
							onPointerCancel={(event) => {
								endHandleDrag(event, false);
							}}
						>
							<span aria-hidden="true" className="crop-handle size-2.5" />
						</button>
					);
				})}
			</div>
		</div>
	);
}
