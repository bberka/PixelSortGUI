// Binds the mask brush to the canvas (product.md F29, DESIGN.md section 7.4):
// pointers and keys become strokes, and the overlay and cursor follow them.
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
} from 'react';
import {toast} from 'sonner';
import type {CanvasToolHandle, ToolStage} from '../types.ts';
import {
	createBrushSession,
	type BrushSession,
	type BrushSessionOptions,
	type MaskWorkerPort,
} from './session.ts';
import {placeCursor} from './cursor-geometry.ts';
import {announce} from '@/app/announcer.ts';
import {useAppRuntime, useAppStore} from '@/app/runtime-context.tsx';
import {brushSample, pressureFactor} from '@/engine/mask/coords.ts';
import {validateMask} from '@/engine/mask/validate.ts';
import {clamp} from '@/engine/math.ts';
import {clampSplitPosition} from '@/features/canvas/compare-logic.ts';
import type {MaskOverlayImage} from '@/features/canvas/draw.ts';
import {tintMask} from '@/features/canvas/mask-tint.ts';
import {sourceAt, type Point} from '@/features/canvas/view.ts';
import {
	isEditableTarget,
	isModalDialogOpen,
} from '@/features/toolbar/shortcuts.ts';
import {projectDimensions} from '@/render/render-source.ts';
import {BRUSH_LIMITS, stepBrushSize} from '@/state/brush.ts';
import {
	selectEditingSelectedId,
	selectEditingSide,
	selectEditingStack,
	selectSplitOrientation,
} from '@/state/split-sides.ts';
import {selectShowingOriginal} from '@/state/transient.ts';
import {DEFAULT_SPLIT_POSITION} from '@/storage/types.ts';
import type {MaskWorkerResponse} from '@/worker/protocol.ts';

// The direction of each arrow key.
const ARROWS = new Map<string, Point>([
	['ArrowLeft', {x: -1, y: 0}],
	['ArrowRight', {x: 1, y: 0}],
	['ArrowUp', {x: 0, y: -1}],
	['ArrowDown', {x: 0, y: 1}],
]);

function createMaskWorker(
	handlers: Parameters<BrushSessionOptions['createWorker']>[0],
): MaskWorkerPort {
	const worker = new Worker(
		new URL('../../../../worker/mask.worker.ts', import.meta.url),
		{type: 'module'},
	);
	worker.addEventListener(
		'message',
		(event: MessageEvent<MaskWorkerResponse>) => {
			handlers.message(event.data);
		},
	);
	worker.addEventListener('error', handlers.error);
	worker.addEventListener('messageerror', handlers.error);
	return {
		post(message) {
			worker.postMessage(message);
		},
		terminate() {
			worker.terminate();
		},
	};
}

// Who draws the stroke in progress.
type Drawer = number | 'keyboard';

type Cursor = {
	// In effective-image pixels.
	point: Point | null;
	visible: boolean;
	// The pressure factor of the stroke in progress.
	factor: number;
};

export function useMaskBrush(stage: ToolStage): CanvasToolHandle {
	const {bundle} = useAppRuntime();
	const {store, transientStore, repository} = bundle;
	const instanceId = useAppStore(
		(state) => state.activeBrush?.instanceId ?? null,
	);

	const stageRef = useRef(stage);
	stageRef.current = stage;
	const overlayRef = useRef<MaskOverlayImage | null>(null);
	const cursorRef = useRef<HTMLDivElement | null>(null);
	const sessionRef = useRef<BrushSession | null>(null);
	const drawerRef = useRef<Drawer | null>(null);
	// Pointers the brush took; their moves never pan, even after a cancel.
	const ownedRef = useRef(new Set<number>());
	const penDownRef = useRef(new Set<number>());
	const penNearRef = useRef(false);
	const spaceRef = useRef(false);
	const cursorStateRef = useRef<Cursor>({
		point: null,
		visible: false,
		factor: 1,
	});
	const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const patchedRef = useRef(false);

	// Compare, crop mode and history comparison suspend the brush.
	const engaged = useCallback((): boolean => {
		const state = store.getState();
		const transient = transientStore.getState();
		return (
			state.activeBrush !== null &&
			state.compareHistorySeq === null &&
			!selectShowingOriginal(transient) &&
			!transient.geometry.cropping
		);
	}, [store, transientStore]);

	const getTarget = useCallback(() => {
		const state = store.getState();
		const {activeBrush, activeProject} = state;
		if (!activeBrush || !activeProject || !engaged()) {
			return null;
		}

		const instance = selectEditingStack(state)?.instances.find(
			(item) => item.id === activeBrush.instanceId,
		);
		const mask = instance?.mask && validateMask(instance.mask);
		const {source} =
			selectEditingSide(state) === 'a' ? state.renderA : state.render;
		const size = projectDimensions(activeProject);
		// The photo, or its new geometry, is still loading.
		if (
			mask?.kind !== 'paint' ||
			source?.key !== activeProject.sourceHash ||
			source.width !== size.width ||
			source.height !== size.height
		) {
			return null;
		}

		const {sourceWidth, sourceHeight, transform} = activeProject;
		return {
			asset: mask.asset,
			invert: mask.invert,
			geometry: {sourceWidth, sourceHeight, transform},
			overlay: source.settle,
		};
	}, [engaged, store]);

	const place = useCallback(() => {
		const element = cursorRef.current;
		if (!element) {
			return;
		}

		const {point, visible, factor} = cursorStateRef.current;
		const read = stageRef.current.readView();
		const target = visible && point && read ? getTarget() : null;
		const {activeBrush, brushSettings} = store.getState();
		placeCursor(
			element,
			target && point && read && activeBrush
				? {
						...read,
						geometry: target.geometry,
						point,
						factor,
						size: brushSettings.size,
						hardness: brushSettings.hardness,
						tool: activeBrush.tool,
					}
				: null,
		);
	}, [getTarget, store]);

	// Shows the overlay while "Show mask" is on, and always during a stroke.
	const refresh = useCallback(() => {
		const state = store.getState();
		const canvas = overlayCanvasRef.current;
		const {visible, opacity} = state.maskOverlay;
		overlayRef.current =
			canvas &&
			patchedRef.current &&
			engaged() &&
			(visible || sessionRef.current?.stroking)
				? {
						bitmap: canvas,
						width: canvas.width,
						height: canvas.height,
						side: selectEditingSide(state),
						opacity: opacity / 100,
					}
				: null;
		stageRef.current.redraw();
		place();
	}, [engaged, place, store]);

	const setCanvasCursor = useCallback((value: 'none' | '') => {
		const canvas = stageRef.current.canvas();
		if (canvas) {
			canvas.style.cursor = value;
		}
	}, []);

	// One session, and with it one mask worker, while the brush is on.
	useEffect(() => {
		if (instanceId === null) {
			return undefined;
		}

		const session = createBrushSession({
			createWorker: createMaskWorker,
			getTarget,
			loadMask: async (sha256) => repository.getMask(sha256),
			commit: async (mode, asset) =>
				store.getState().commitStroke(instanceId, mode, asset),
			onOpened({width, height}) {
				const previous = overlayCanvasRef.current;
				if (previous?.width === width && previous.height === height) {
					return;
				}

				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				overlayCanvasRef.current = canvas;
				patchedRef.current = false;
			},
			onPatch({x, y, width, height, data}) {
				const surface = overlayCanvasRef.current?.getContext('2d');
				if (!surface) {
					return;
				}

				surface.putImageData(tintMask(data, width, height), x, y);
				patchedRef.current = true;
				refresh();
			},
			onCommitted() {
				announce('Stroke added');
			},
			onProblem(problem) {
				drawerRef.current = null;
				if (problem === 'missing') {
					patchedRef.current = false;
					toast.error('Missing mask. Fill or Clear it to paint again.');
					refresh();
					return;
				}

				store.getState().setBrush(null);
				toast.error('The brush stopped unexpectedly.');
			},
		});
		sessionRef.current = session;
		cursorStateRef.current = {point: null, visible: false, factor: 1};
		let interrupt = store.getState().brushInterrupt;
		const update = () => {
			const {brushInterrupt} = store.getState();
			if (brushInterrupt !== interrupt) {
				interrupt = brushInterrupt;
				session.cancel();
			}

			session.sync();
			if (!session.stroking) {
				drawerRef.current = null;
				cursorStateRef.current.factor = 1;
			}

			refresh();
		};

		const unsubscribe = store.subscribe(update);
		const unsubscribeTransient = transientStore.subscribe(update);
		update();
		return () => {
			unsubscribe();
			unsubscribeTransient();
			session.dispose();
			sessionRef.current = null;
			drawerRef.current = null;
			overlayCanvasRef.current = null;
			overlayRef.current = null;
			patchedRef.current = false;
			cursorStateRef.current.visible = false;
			setCanvasCursor('');
			stageRef.current.redraw();
			place();
		};
	}, [
		getTarget,
		instanceId,
		place,
		refresh,
		repository,
		setCanvasCursor,
		store,
		transientStore,
	]);

	// Speaks the brush turning on or off and switching tools.
	useEffect(
		() =>
			store.subscribe(({activeBrush}, {activeBrush: previous}) => {
				if (activeBrush === previous) {
					return;
				}

				if (!activeBrush) {
					announce('Brush off');
				} else if (!previous) {
					announce('Brush on');
				} else if (activeBrush.tool !== previous.tool) {
					announce(activeBrush.tool === 'paint' ? 'Paint' : 'Erase');
				}
			}),
		[store],
	);

	// Whether a canvas position lies on the split side the brush edits.
	const onEditingSide = useCallback(
		(position: Point): boolean => {
			const state = store.getState();
			const read = stageRef.current.readView();
			if (state.compareMode !== 'split' || !read) {
				return true;
			}

			const ratio = clampSplitPosition(
				transientStore.getState().splitPosition ??
					state.activeProject?.viewState.splitPosition ??
					DEFAULT_SPLIT_POSITION,
			);
			const horizontal = selectSplitOrientation(state) === 'horizontal';
			const before = horizontal
				? position.y < ratio * read.viewport.height
				: position.x < ratio * read.viewport.width;
			return before === (selectEditingSide(state) === 'a');
		},
		[store, transientStore],
	);

	const imagePoint = useCallback((position: Point): Point | null => {
		const read = stageRef.current.readView();
		return read ? sourceAt(read.view, position, read.viewport) : null;
	}, []);

	const sampleAt = useCallback(
		(point: Point, pointerType: string, pressure: number) => {
			const target = getTarget();
			if (!target) {
				return null;
			}

			const {size, penPressure} = store.getState().brushSettings;
			const factor = pressureFactor(pointerType, pressure, penPressure);
			cursorStateRef.current = {point, visible: true, factor};
			return brushSample(target.geometry, point, size, factor);
		},
		[getTarget, store],
	);

	const begin = useCallback(
		(drawer: Drawer, point: Point, pointerType: string, pressure: number) => {
			const sample = sampleAt(point, pointerType, pressure);
			const {activeBrush, brushSettings} = store.getState();
			const session = sessionRef.current;
			if (!sample || !activeBrush || !session) {
				return false;
			}

			const {hardness, strength} = brushSettings;
			if (!session.begin(activeBrush.tool, {hardness, strength}, sample)) {
				return false;
			}

			drawerRef.current = drawer;
			refresh();
			return true;
		},
		[refresh, sampleAt, store],
	);

	const finish = useCallback(
		(commit: boolean) => {
			drawerRef.current = null;
			cursorStateRef.current.factor = 1;
			if (commit) {
				sessionRef.current?.end();
			} else {
				sessionRef.current?.cancel();
			}

			refresh();
		},
		[refresh],
	);

	// Keys that work from anywhere in the editor.
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === ' ') {
				spaceRef.current = true;
				const canvas = stageRef.current.canvas();
				// Elsewhere Space presses the focused control.
				if (
					engaged() &&
					(event.target === canvas || event.target === document.body)
				) {
					event.preventDefault();
					cursorStateRef.current.visible = false;
					setCanvasCursor('');
					place();
				}

				return;
			}

			const state = store.getState();
			if (
				event.defaultPrevented ||
				state.route.screen !== 'editor' ||
				// AltGr types the brackets on many layouts.
				(!event.getModifierState('AltGraph') &&
					(event.ctrlKey || event.metaKey || event.altKey)) ||
				isEditableTarget(event.target) ||
				isEditableTarget(document.activeElement) ||
				isModalDialogOpen(document) ||
				transientStore.getState().geometry.cropping
			) {
				return;
			}

			const {activeBrush, brushSettings, setBrushSettings} = state;
			if (event.key === 'b' || event.key === 'B') {
				const selected = selectEditingSelectedId(state);
				if (!event.repeat && (activeBrush || selected)) {
					event.preventDefault();
					state.setBrush(activeBrush ? null : selected);
				}

				return;
			}

			if (!activeBrush || !engaged()) {
				return;
			}

			if (event.key === 'x' || event.key === 'X') {
				event.preventDefault();
				if (!event.repeat) {
					state.setBrushTool(activeBrush.tool === 'paint' ? 'erase' : 'paint');
				}

				return;
			}

			if (['[', ']', '{', '}'].includes(event.key)) {
				event.preventDefault();
				const direction = event.key === ']' || event.key === '}' ? 1 : -1;
				if (event.shiftKey || event.key === '{' || event.key === '}') {
					const {min, max} = BRUSH_LIMITS.hardness;
					const hardness = clamp(
						brushSettings.hardness + 10 * direction,
						min,
						max,
					);
					setBrushSettings({hardness});
					announce(`Hardness ${hardness}%`);
					return;
				}

				const size = stepBrushSize(brushSettings.size, direction);
				setBrushSettings({size});
				announce(`Brush size ${size} px`);
				return;
			}

			if (event.key !== 'Escape') {
				return;
			}

			event.preventDefault();
			if (sessionRef.current?.stroking) {
				finish(false);
				announce('Stroke canceled');
			} else {
				state.setBrush(null);
			}
		};

		const releaseSpace = (event: KeyboardEvent) => {
			if (event.key === ' ') {
				spaceRef.current = false;
			}
		};

		const handleBlur = () => {
			spaceRef.current = false;
		};

		globalThis.addEventListener('keydown', handleKeyDown);
		globalThis.addEventListener('keyup', releaseSpace);
		globalThis.addEventListener('blur', handleBlur);
		return () => {
			globalThis.removeEventListener('keydown', handleKeyDown);
			globalThis.removeEventListener('keyup', releaseSpace);
			globalThis.removeEventListener('blur', handleBlur);
		};
	}, [engaged, finish, place, setCanvasCursor, store, transientStore]);

	return useMemo<CanvasToolHandle>(
		() => ({
			overlayRef,
			cursorRef,
			engaged,
			place,

			pointerDown(
				event: ReactPointerEvent<HTMLCanvasElement>,
				position: Point,
				others: number,
			) {
				const {pointerId, pointerType, button} = event;
				if (pointerType === 'pen') {
					penDownRef.current.add(pointerId);
				}

				if (!engaged()) {
					return 'canvas';
				}

				const touch = pointerType === 'touch';
				// While a pen is in use, touches are ignored.
				if (touch && (penDownRef.current.size > 0 || penNearRef.current)) {
					return 'ignore';
				}

				if (pointerType === 'mouse' && button === 1) {
					return 'canvas';
				}

				if (button !== 0) {
					return 'ignore';
				}

				// A second finger drops the stroke; both fingers then pan and zoom.
				if (touch && others > 0) {
					const drawer = drawerRef.current;
					if (typeof drawer === 'number') {
						ownedRef.current.delete(drawer);
						cursorStateRef.current.visible = false;
						finish(false);
					}

					return 'canvas';
				}

				if (spaceRef.current || !onEditingSide(position)) {
					return 'canvas';
				}

				if (drawerRef.current !== null) {
					finish(false);
				}

				const point = imagePoint(position);
				if (!point || !begin(pointerId, point, pointerType, event.pressure)) {
					return 'ignore';
				}

				ownedRef.current.add(pointerId);
				return 'tool';
			},

			pointerMove(
				event: ReactPointerEvent<HTMLCanvasElement>,
				position: Point,
			) {
				const {pointerId, pointerType} = event;
				if (pointerType === 'pen') {
					penNearRef.current = true;
				}

				if (ownedRef.current.has(pointerId)) {
					if (drawerRef.current === pointerId) {
						const rect = event.currentTarget.getBoundingClientRect();
						const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
						const samples = (
							coalesced.length > 0 ? coalesced : [event.nativeEvent]
						).flatMap((moved) => {
							const point = imagePoint({
								x: moved.clientX - rect.left,
								y: moved.clientY - rect.top,
							});
							return (
								(point && sampleAt(point, pointerType, moved.pressure)) ?? []
							);
						});
						sessionRef.current?.move(samples);
						place();
					}

					return true;
				}

				if (!engaged() || pointerType === 'touch') {
					return false;
				}

				const point = imagePoint(position);
				const paintable =
					!spaceRef.current &&
					event.buttons === 0 &&
					drawerRef.current === null &&
					onEditingSide(position);
				if (drawerRef.current === null) {
					cursorStateRef.current = {point, visible: paintable, factor: 1};
					setCanvasCursor(paintable ? 'none' : '');
					place();
				}

				return false;
			},

			pointerUp(pointerId: number, commit: boolean, pointerType: string) {
				penDownRef.current.delete(pointerId);
				if (!ownedRef.current.delete(pointerId)) {
					return false;
				}

				if (drawerRef.current === pointerId) {
					if (pointerType === 'touch') {
						cursorStateRef.current.visible = false;
					}

					finish(commit);
				}

				return true;
			},

			pointerLeave(pointerType: string) {
				if (pointerType === 'pen') {
					penNearRef.current = false;
				}

				if (drawerRef.current !== null) {
					return;
				}

				cursorStateRef.current.visible = false;
				place();
			},

			keyDown(event: ReactKeyboardEvent<HTMLCanvasElement>) {
				const state = store.getState();
				const read = stageRef.current.readView();
				const project = state.activeProject;
				if (
					!engaged() ||
					!read ||
					!project ||
					event.ctrlKey ||
					event.metaKey ||
					event.altKey
				) {
					return false;
				}

				const arrow = ARROWS.get(event.key);
				if (!arrow && event.key !== 'Enter') {
					return false;
				}

				event.preventDefault();
				// A pointer is drawing: keys leave it alone.
				if (typeof drawerRef.current === 'number') {
					return true;
				}

				const size = projectDimensions(project);
				const from = cursorStateRef.current.point ?? {
					x: clamp(read.view.centerX, 0, size.width),
					y: clamp(read.view.centerY, 0, size.height),
				};
				if (arrow) {
					const step = state.brushSettings.size / (event.shiftKey ? 1 : 4);
					const point = {
						x: clamp(from.x + arrow.x * step, 0, size.width),
						y: clamp(from.y + arrow.y * step, 0, size.height),
					};
					cursorStateRef.current = {point, visible: true, factor: 1};
					if (drawerRef.current === 'keyboard') {
						const sample = sampleAt(point, 'mouse', 0);
						sessionRef.current?.move(sample ? [sample] : []);
					}

					place();
					return true;
				}

				if (!event.repeat) {
					if (drawerRef.current === 'keyboard') {
						finish(true);
					} else if (begin('keyboard', from, 'mouse', 0)) {
						announce('Stroke started');
					}
				}

				return true;
			},
		}),
		[
			begin,
			engaged,
			finish,
			imagePoint,
			onEditingSide,
			place,
			sampleAt,
			setCanvasCursor,
			store,
		],
	);
}
