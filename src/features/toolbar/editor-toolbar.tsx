import {useCallback, useEffect, useMemo} from 'react';
import {Redo2Icon, Undo2Icon} from 'lucide-react';
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
import {useAppRuntime, useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {
	selectCanRedo,
	selectCanUndo,
	selectRedoLabel,
	selectUndoLabel,
} from '@/state/app-store.ts';

export function EditorToolbar() {
	const {bundle} = useAppRuntime();
	const activeProjectId = useAppStore((state) => state.activeProjectId);
	const canUndo = useAppStore(selectCanUndo);
	const canRedo = useAppStore(selectCanRedo);
	const undoLabel = useAppStore(selectUndoLabel);
	const redoLabel = useAppStore(selectRedoLabel);

	const shortcuts = useMemo(() => getShortcutLabels(), []);

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
		if (!activeProjectId) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			const action = matchHistoryShortcut(event);
			if (
				!action ||
				isEditableTarget(event.target) ||
				isEditableTarget(globalThis.document?.activeElement ?? null) ||
				isModalDialogOpen(globalThis.document)
			) {
				return;
			}

			event.preventDefault();
			if (action === 'undo') {
				void runUndo();
			} else {
				void runRedo();
			}
		};

		globalThis.addEventListener('keydown', handleKeyDown);
		return () => {
			globalThis.removeEventListener('keydown', handleKeyDown);
		};
	}, [activeProjectId, runRedo, runUndo]);

	if (!activeProjectId) {
		return null;
	}

	const undoAriaLabel = formatUndoAriaLabel(undoLabel);
	const redoAriaLabel = formatRedoAriaLabel(redoLabel);
	const undoTooltip = formatUndoTooltip(undoLabel, shortcuts.undo);
	const redoTooltip = formatRedoTooltip(redoLabel, shortcuts.redo);

	return (
		<div
			role="toolbar"
			aria-label="Editor actions"
			className="flex h-full w-full min-w-0 items-center gap-1.5 px-2 lg:px-3"
		>
			<div className="flex shrink-0 items-center gap-1">
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
			<Separator orientation="vertical" className="mx-0.5 h-5" />
			<PresetsControl />
		</div>
	);
}
