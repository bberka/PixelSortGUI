import {useCallback, useEffect, useMemo, useRef} from 'react';
import {
	Columns2Icon,
	EyeIcon,
	Redo2Icon,
	RotateCwSquareIcon,
	Rows2Icon,
	Undo2Icon,
} from 'lucide-react';
import {PresetsControl} from './presets-control.tsx';
import {
	formatRedoAriaLabel,
	formatRedoTooltip,
	formatUndoAriaLabel,
	formatUndoTooltip,
	getShortcutLabels,
	isEditableTarget,
	isModalDialogOpen,
	matchHistoryShortcut,
} from './shortcuts.ts';
import {announce} from '@/app/announcer.ts';
import {
	useAppRuntime,
	useAppStore,
	useTransientStore,
} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {HistorySheetButton} from '@/features/history/history-sheet-button.tsx';
import {TransformToggle} from '@/features/transform/transform-toggle.tsx';
import {createCompareHoldController} from '@/features/canvas/compare-logic.ts';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';
import {cn} from '@/lib/utils';
import {
	selectCanRedo,
	selectCanUndo,
	selectRedoLabel,
	selectUndoLabel,
} from '@/state/app-store.ts';
import {selectShowingOriginal} from '@/state/transient.ts';
import {selectSplitOrientation} from '@/state/split-sides.ts';

export function EditorToolbar() {
	const {bundle} = useAppRuntime();
	const activeProjectId = useAppStore((state) => state.activeProjectId);
	const canUndo = useAppStore(selectCanUndo);
	const canRedo = useAppStore(selectCanRedo);
	const undoLabel = useAppStore(selectUndoLabel);
	const redoLabel = useAppStore(selectRedoLabel);
	const compareMode = useAppStore((state) => state.compareMode);
	const showingOriginal = useTransientStore(selectShowingOriginal);
	const orientation = useAppStore(selectSplitOrientation);
	// Crop mode suspends Compare and the split view (DESIGN.md section 7.2).
	const cropping = useTransientStore((state) => state.geometry.cropping);
	const compact = usePhoneLayout();

	const shortcuts = useMemo(() => getShortcutLabels(), []);
	const suppressCompareClickRef = useRef(false);
	const clearSuppressTimerRef = useRef<unknown>(null);

	const compareController = useMemo(
		() =>
			createCompareHoldController({
				getLatched: () => bundle.transientStore.getState().compareLatched,
				setHolding(holding) {
					bundle.transientStore.setState({compareHolding: holding});
				},
				setLatched(latched) {
					const previous = bundle.transientStore.getState().compareLatched;
					bundle.transientStore.setState({compareLatched: latched});
					if (latched && bundle.store.getState().compareMode === 'split') {
						void bundle.store.getState().setCompareMode('toggle');
					}

					if (latched !== previous) {
						announce(latched ? 'Showing original' : 'Showing edited result');
					}
				},
			}),
		[bundle],
	);

	const toggleSplit = useCallback(() => {
		const state = bundle.store.getState();
		const nextMode = state.compareMode === 'split' ? 'toggle' : 'split';
		if (nextMode === 'split') {
			compareController.cancel();
			bundle.transientStore.setState({
				compareLatched: false,
				compareHolding: false,
			});
		}

		void state.setCompareMode(nextMode);
		announce(nextMode === 'split' ? 'Split view on' : 'Split view off');
	}, [bundle, compareController]);

	// Also turns the split view on, so the change is always visible.
	const toggleOrientation = useCallback(() => {
		const state = bundle.store.getState();
		const next =
			selectSplitOrientation(state) === 'vertical' ? 'horizontal' : 'vertical';
		state.setSplitOrientation(next);
		if (
			state.compareMode !== 'split' ||
			selectShowingOriginal(bundle.transientStore.getState())
		) {
			compareController.cancel();
			bundle.transientStore.setState({
				compareLatched: false,
				compareHolding: false,
			});
			void state.setCompareMode('split');
		}

		announce(
			next === 'vertical'
				? 'Split view left and right'
				: 'Split view top and bottom',
		);
	}, [bundle, compareController]);

	const runUndo = useCallback(async () => {
		const state = bundle.store.getState();
		if (!selectCanUndo(state)) {
			return;
		}

		const label = selectUndoLabel(state);
		const changed = await state.undo();
		if (changed) {
			announce(label ? `Undid ${label}` : 'Undid last change');
		}
	}, [bundle.store]);

	const runRedo = useCallback(async () => {
		const state = bundle.store.getState();
		if (!selectCanRedo(state)) {
			return;
		}

		const label = selectRedoLabel(state);
		const changed = await state.redo();
		if (changed) {
			announce(label ? `Redid ${label}` : 'Redid change');
		}
	}, [bundle.store]);

	useEffect(() => {
		if (cropping) {
			compareController.cancel();
		}
	}, [compareController, cropping]);

	useEffect(() => {
		if (!activeProjectId) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				isEditableTarget(event.target) ||
				isEditableTarget(globalThis.document?.activeElement ?? null) ||
				isModalDialogOpen(globalThis.document)
			) {
				return;
			}

			const action = matchHistoryShortcut(event);
			if (action) {
				event.preventDefault();
				if (action === 'undo') {
					void runUndo();
				} else {
					void runRedo();
				}

				return;
			}

			if (
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				bundle.transientStore.getState().geometry.cropping
			) {
				return;
			}

			if (event.key === '\\') {
				event.preventDefault();
				if (event.repeat) {
					return;
				}

				compareController.pressStart();
				return;
			}

			if (event.key !== 's' && event.key !== 'S') {
				return;
			}

			event.preventDefault();
			if (event.repeat) {
				return;
			}

			if (event.shiftKey) {
				toggleOrientation();
			} else {
				toggleSplit();
			}
		};

		const handleKeyUp = (event: KeyboardEvent) => {
			if (event.key !== '\\' || !compareController.isPressed()) {
				return;
			}

			event.preventDefault();
			compareController.pressEnd();
		};

		const handleBlur = () => {
			compareController.cancel();
		};

		globalThis.addEventListener('keydown', handleKeyDown);
		globalThis.addEventListener('keyup', handleKeyUp);
		globalThis.addEventListener('blur', handleBlur);
		return () => {
			globalThis.removeEventListener('keydown', handleKeyDown);
			globalThis.removeEventListener('keyup', handleKeyUp);
			globalThis.removeEventListener('blur', handleBlur);
			compareController.cancel();
			if (clearSuppressTimerRef.current === null) {
				return;
			}

			globalThis.clearTimeout(clearSuppressTimerRef.current as number);
			clearSuppressTimerRef.current = null;
		};
	}, [
		activeProjectId,
		bundle,
		compareController,
		runRedo,
		runUndo,
		toggleOrientation,
		toggleSplit,
	]);

	if (!activeProjectId) {
		return null;
	}

	const undoAriaLabel = formatUndoAriaLabel(undoLabel);
	const redoAriaLabel = formatRedoAriaLabel(redoLabel);
	const undoTooltip = formatUndoTooltip(undoLabel, shortcuts.undo);
	const redoTooltip = formatRedoTooltip(redoLabel, shortcuts.redo);
	const splitActive = compareMode === 'split' && !showingOriginal && !cropping;
	// Eight 44 px targets only fit a phone with tighter spacing.
	const groupClass = cn(
		'flex shrink-0 items-center gap-1',
		compact && 'pointer-coarse:gap-0',
	);
	const separatorClass = cn('mx-0.5 h-5', compact && 'pointer-coarse:mx-0');
	const SplitIcon = orientation === 'vertical' ? Columns2Icon : Rows2Icon;
	const orientationLabel =
		orientation === 'vertical'
			? 'Switch to top/bottom view'
			: 'Switch to left/right view';

	const handleComparePointerDown = (
		event: React.PointerEvent<HTMLButtonElement>,
	) => {
		if (event.pointerType === 'mouse' && event.button !== 0) {
			return;
		}

		suppressCompareClickRef.current = false;
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}

		compareController.pressStart();
	};

	const handleComparePointerUp = (
		event: React.PointerEvent<HTMLButtonElement>,
	) => {
		if (!compareController.isPressed()) {
			return;
		}

		suppressCompareClickRef.current = true;
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {}

		compareController.pressEnd();
		if (clearSuppressTimerRef.current !== null) {
			globalThis.clearTimeout(clearSuppressTimerRef.current as number);
		}

		clearSuppressTimerRef.current = globalThis.setTimeout(() => {
			clearSuppressTimerRef.current = null;
			suppressCompareClickRef.current = false;
		}, 0);
	};

	const handleComparePointerCancel = (
		event: React.PointerEvent<HTMLButtonElement>,
	) => {
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {}

		compareController.cancel();
	};

	const handleCompareClick = () => {
		if (suppressCompareClickRef.current) {
			suppressCompareClickRef.current = false;
			return;
		}

		compareController.toggle();
	};

	return (
		// A button used as a trigger takes the trigger's `data-slot`, so the
		// coarse-pointer rule in app.css misses it.
		<div
			role="toolbar"
			aria-label="Editor actions"
			className={cn(
				'flex h-full w-full min-w-0 items-center gap-1.5 px-2 lg:px-3 pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11',
				compact && 'pointer-coarse:gap-0.5 pointer-coarse:px-1',
			)}
		>
			<div className={groupClass}>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={undoAriaLabel}
								disabled={!canUndo}
								onClick={() => {
									void runUndo();
								}}
							>
								<Undo2Icon aria-hidden="true" />
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent>{undoTooltip}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={redoAriaLabel}
								disabled={!canRedo}
								onClick={() => {
									void runRedo();
								}}
							>
								<Redo2Icon aria-hidden="true" />
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent>{redoTooltip}</TooltipContent>
				</Tooltip>
			</div>
			<Separator orientation="vertical" className={separatorClass} />
			<div className={groupClass}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant={showingOriginal ? 'default' : 'ghost'}
							size={compact ? 'icon-sm' : 'sm'}
							aria-label="Compare"
							aria-pressed={showingOriginal}
							disabled={cropping}
							onPointerDown={handleComparePointerDown}
							onPointerUp={handleComparePointerUp}
							onPointerCancel={handleComparePointerCancel}
							onClick={handleCompareClick}
						>
							<EyeIcon aria-hidden="true" />
							{compact ? null : <span>Compare</span>}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Compare original (\, hold to peek)</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant={splitActive ? 'default' : 'ghost'}
							size={compact ? 'icon-sm' : 'sm'}
							aria-label="Split"
							aria-pressed={splitActive}
							disabled={cropping}
							onClick={toggleSplit}
						>
							<SplitIcon aria-hidden="true" />
							{compact ? null : <span>Split</span>}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Split view (S)</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						{/* The wrapper keeps the button's own slot, and with it the
						    44 px coarse-pointer size. */}
						<span className="inline-flex">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={orientationLabel}
								disabled={cropping}
								onClick={toggleOrientation}
							>
								<RotateCwSquareIcon aria-hidden="true" />
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent>{orientationLabel} (Shift+S)</TooltipContent>
				</Tooltip>
			</div>
			<Separator orientation="vertical" className={separatorClass} />
			<TransformToggle compact={compact} />
			<PresetsControl />
			{compact ? <HistorySheetButton /> : null}
		</div>
	);
}
