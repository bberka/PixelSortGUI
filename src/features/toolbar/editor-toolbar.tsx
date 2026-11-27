import {useCallback, useEffect, useMemo, useRef} from 'react';
import {
	Columns2Icon,
	EyeIcon,
	Redo2Icon,
	RotateCwSquareIcon,
	Rows2Icon,
	Undo2Icon,
} from 'lucide-react';
import {PHONE_TOOL_CLASS, PHONE_TOOL_SLOT_CLASS} from './phone-tool.ts';
import {PresetsControl} from './presets-control.tsx';
import {
	formatRedoAriaLabel,
	formatUndoAriaLabel,
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
import {SaveProjectButton} from '@/features/project-file/save-project-button.tsx';
import {TransformToggle} from '@/features/transform/transform-toggle.tsx';
import {createCompareHoldController} from '@/features/canvas/compare-logic.ts';
import {useShortcutHint} from '@/lib/keyboard-hints.ts';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';
import {cn} from '@/lib/utils';
import {
	selectCanRedo,
	selectCanUndo,
	selectCompareHistoryEntry,
	selectRedoLabel,
	selectUndoLabel,
} from '@/state/app-store.ts';
import {selectShowingOriginal} from '@/state/transient.ts';
import {
	orientationAnnouncement,
	orientationSwitchLabel,
	selectSplitOrientation,
} from '@/state/split-sides.ts';

export function EditorToolbar() {
	const {bundle} = useAppRuntime();
	const activeProjectId = useAppStore((state) => state.activeProjectId);
	const canUndo = useAppStore(selectCanUndo);
	const canRedo = useAppStore(selectCanRedo);
	const undoLabel = useAppStore(selectUndoLabel);
	const redoLabel = useAppStore(selectRedoLabel);
	const compareMode = useAppStore((state) => state.compareMode);
	const comparingHistory = useAppStore(
		(state) => state.compareHistorySeq !== null,
	);
	const showingOriginal = useTransientStore(selectShowingOriginal);
	const orientation = useAppStore(selectSplitOrientation);
	// Crop mode suspends Compare and the split view (DESIGN.md section 7.2).
	const cropping = useTransientStore((state) => state.geometry.cropping);
	const compact = usePhoneLayout();

	const shortcuts = useMemo(() => getShortcutLabels(), []);
	const hint = useShortcutHint();
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

					if (latched === previous) {
						return;
					}

					const pinned = selectCompareHistoryEntry(bundle.store.getState());
					const reference = pinned
						? `Step #${pinned.seq}: ${pinned.label}`
						: 'original';
					announce(latched ? `Showing ${reference}` : 'Showing edited result');
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

		announce(orientationAnnouncement(next));
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

			if (
				event.key === 'Escape' &&
				bundle.store.getState().compareHistorySeq !== null
			) {
				event.preventDefault();
				bundle.store.getState().clearCompareHistory();
				announce('Stopped comparing history step');
				return;
			}

			if (event.key === 'm' || event.key === 'M') {
				if (event.repeat) {
					return;
				}

				const visible = bundle.store.getState().toggleMaskOverlay();
				if (visible !== null) {
					event.preventDefault();
					announce(visible ? 'Mask shown' : 'Mask hidden');
				}

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
	const undoTooltip = hint(undoAriaLabel, shortcuts.undo);
	const redoTooltip = hint(redoAriaLabel, shortcuts.redo);
	const splitActive = compareMode === 'split' && !showingOriginal && !cropping;
	// On phones the groups dissolve so the seven buttons share the row equally.
	const groupClass = compact ? 'contents' : 'flex shrink-0 items-center gap-1';
	const separatorClass = cn('mx-0.5 h-5', compact && 'hidden');
	const slotClass = compact ? PHONE_TOOL_SLOT_CLASS : 'inline-flex';
	const labelledSize = compact ? 'default' : 'sm';
	const iconSize = compact ? 'default' : 'icon-sm';
	const toolClass = compact ? PHONE_TOOL_CLASS : undefined;
	const SplitIcon = orientation === 'vertical' ? Columns2Icon : Rows2Icon;
	const orientationLabel = orientationSwitchLabel(orientation);

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
				compact && 'gap-0 px-0.5 lg:px-0.5',
			)}
		>
			<div className={groupClass}>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className={slotClass}>
							<Button
								type="button"
								variant="ghost"
								size={iconSize}
								className={toolClass}
								aria-label={undoAriaLabel}
								disabled={!canUndo}
								onClick={() => {
									void runUndo();
								}}
							>
								<Undo2Icon aria-hidden="true" />
								{compact ? <span>Undo</span> : null}
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent>{undoTooltip}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className={slotClass}>
							<Button
								type="button"
								variant="ghost"
								size={iconSize}
								className={toolClass}
								aria-label={redoAriaLabel}
								disabled={!canRedo}
								onClick={() => {
									void runRedo();
								}}
							>
								<Redo2Icon aria-hidden="true" />
								{compact ? <span>Redo</span> : null}
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
							size={labelledSize}
							className={toolClass}
							aria-label="Compare"
							aria-pressed={showingOriginal}
							disabled={cropping}
							onPointerDown={handleComparePointerDown}
							onPointerUp={handleComparePointerUp}
							onPointerCancel={handleComparePointerCancel}
							onClick={handleCompareClick}
						>
							<EyeIcon aria-hidden="true" />
							<span>Compare</span>
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						{hint(
							comparingHistory ? 'Compare pinned step' : 'Compare original',
							'\\',
							'hold to peek',
						)}
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant={splitActive ? 'default' : 'ghost'}
							size={labelledSize}
							className={toolClass}
							aria-label="Split"
							aria-pressed={splitActive}
							disabled={cropping}
							onClick={toggleSplit}
						>
							<SplitIcon aria-hidden="true" />
							<span>Split</span>
						</Button>
					</TooltipTrigger>
					<TooltipContent>{hint('Split view', 'S')}</TooltipContent>
				</Tooltip>
				{/* Phones switch orientation in the split side switcher. */}
				{compact ? null : (
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
						<TooltipContent>{hint(orientationLabel, 'Shift+S')}</TooltipContent>
					</Tooltip>
				)}
			</div>
			<Separator orientation="vertical" className={separatorClass} />
			<TransformToggle compact={compact} />
			<PresetsControl />
			<SaveProjectButton />
			{compact ? <HistorySheetButton /> : null}
		</div>
	);
}
