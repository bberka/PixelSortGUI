import {useId, useRef, useState} from 'react';
import {
	BookmarkIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from 'lucide-react';
import {
	DeletePresetDialog,
	formatEffectCount,
	RenamePresetDialog,
	ReplaceEffectsDialog,
	SavePresetDialog,
} from './preset-dialogs.tsx';
import {PHONE_TOOL_CLASS} from './phone-tool.ts';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';
import {cn} from '@/lib/utils';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {Button} from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {MAX_STACK_INSTANCES} from '@/engine/types.ts';
import type {BuiltinPreset} from '@/presets/builtin.ts';
import type {UserPresetRecord} from '@/storage/types.ts';
import {
	selectEditingSide,
	selectEditingStack,
	sideLetter,
} from '@/state/split-sides.ts';

type PresetItem = BuiltinPreset | UserPresetRecord;

type PresetRowProps = {
	readonly preset: PresetItem;
	readonly isUserPreset: boolean;
	readonly canAddToStack: boolean;
	readonly onApply: (preset: PresetItem) => void;
	readonly onAddToStack: (preset: PresetItem) => void;
	readonly onRequestRename?: (preset: UserPresetRecord) => void;
	readonly onRequestDelete?: (preset: UserPresetRecord) => void;
};

function PresetRow({
	preset,
	isUserPreset,
	canAddToStack,
	onApply,
	onAddToStack,
	onRequestRename,
	onRequestDelete,
}: PresetRowProps) {
	const count = preset.stack.instances.length;

	return (
		<li className="flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-secondary/60">
			<button
				type="button"
				className="flex min-h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
				onClick={() => {
					onApply(preset);
				}}
			>
				<span className="truncate text-sm font-medium">{preset.name}</span>
				<span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
					{formatEffectCount(count)}
				</span>
			</button>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex shrink-0">
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={`Add ${preset.name} to stack`}
							disabled={!canAddToStack}
							className="size-7"
							onClick={() => {
								onAddToStack(preset);
							}}
						>
							<PlusIcon aria-hidden="true" />
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent>
					{canAddToStack
						? 'Add to stack'
						: `Exceeds ${MAX_STACK_INSTANCES}-effect limit`}
				</TooltipContent>
			</Tooltip>
			{isUserPreset && onRequestRename && onRequestDelete ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={`${preset.name} actions`}
							className="size-7 shrink-0"
						>
							<MoreHorizontalIcon aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							onSelect={() => {
								onRequestRename(preset as UserPresetRecord);
							}}
						>
							<PencilIcon aria-hidden="true" />
							Rename
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							onSelect={() => {
								onRequestDelete(preset as UserPresetRecord);
							}}
						>
							<Trash2Icon aria-hidden="true" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</li>
	);
}

type PresetListBodyProps = {
	readonly builtinPresets: readonly BuiltinPreset[];
	readonly userPresets: readonly UserPresetRecord[];
	readonly stackLength: number;
	readonly onApply: (preset: PresetItem) => void;
	readonly onAddToStack: (preset: PresetItem) => void;
	readonly onRequestSave: () => void;
	readonly onRequestRename: (preset: UserPresetRecord) => void;
	readonly onRequestDelete: (preset: UserPresetRecord) => void;
};

function PresetListBody({
	builtinPresets,
	userPresets,
	stackLength,
	onApply,
	onAddToStack,
	onRequestSave,
	onRequestRename,
	onRequestDelete,
}: PresetListBodyProps) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2 px-1">
				<span className="text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase">
					Built-in
				</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 px-2 text-xs"
					onClick={onRequestSave}
				>
					<PlusIcon aria-hidden="true" className="size-3.5" />
					Save as preset
				</Button>
			</div>
			<ScrollArea tabStop={false} className="max-h-80">
				<div className="flex flex-col gap-2 pr-0.5">
					<ul aria-label="Built-in presets" className="flex flex-col gap-0.5">
						{builtinPresets.map((preset) => (
							<PresetRow
								key={preset.id}
								preset={preset}
								isUserPreset={false}
								canAddToStack={
									stackLength + preset.stack.instances.length <=
									MAX_STACK_INSTANCES
								}
								onApply={onApply}
								onAddToStack={onAddToStack}
							/>
						))}
					</ul>
					<Separator />
					<div className="flex flex-col gap-1">
						<span className="px-1 text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase">
							Saved
						</span>
						{userPresets.length === 0 ? (
							<p className="px-2 py-1.5 text-xs text-muted-foreground">
								No saved presets yet
							</p>
						) : (
							<ul aria-label="Saved presets" className="flex flex-col gap-0.5">
								{userPresets.map((preset) => (
									<PresetRow
										key={preset.id}
										isUserPreset
										preset={preset}
										canAddToStack={
											stackLength + preset.stack.instances.length <=
											MAX_STACK_INSTANCES
										}
										onApply={onApply}
										onAddToStack={onAddToStack}
										onRequestRename={onRequestRename}
										onRequestDelete={onRequestDelete}
									/>
								))}
							</ul>
						)}
					</div>
				</div>
			</ScrollArea>
		</div>
	);
}

export function PresetsControl() {
	const builtinPresets = useAppStore((state) => state.builtinPresets);
	const userPresets = useAppStore((state) => state.presets);
	const stackLength = useAppStore(
		(state) => selectEditingStack(state)?.instances.length ?? 0,
	);
	// Named in the confirmation only while the split view shows two stacks.
	const sideName = useAppStore((state) =>
		state.compareMode === 'split'
			? sideLetter(selectEditingSide(state))
			: undefined,
	);
	const applyPreset = useAppStore((state) => state.applyPreset);
	const addPresetToStack = useAppStore((state) => state.addPresetToStack);
	const saveStackAsPreset = useAppStore((state) => state.saveStackAsPreset);
	const renameUserPreset = useAppStore((state) => state.renameUserPreset);
	const deleteUserPreset = useAppStore((state) => state.deleteUserPreset);

	const compact = usePhoneLayout();
	const titleId = useId();
	const [open, setOpen] = useState(false);
	const [saveOpen, setSaveOpen] = useState(false);
	const [renamingPreset, setRenamingPreset] = useState<UserPresetRecord | null>(
		null,
	);
	const [deletingPreset, setDeletingPreset] = useState<UserPresetRecord | null>(
		null,
	);

	const [replacing, setReplacing] = useState<{
		readonly preset: PresetItem;
		readonly effectCount: number;
	} | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const focusTriggerOnCloseRef = useRef(false);

	const runApply = (preset: PresetItem) => {
		void applyPreset(preset.id).then(() => {
			announce(`Applied preset ${preset.name}`);
		});
	};

	const handleApply = (preset: PresetItem) => {
		if (stackLength === 0) {
			setOpen(false);
			runApply(preset);
			return;
		}

		// On phones the list is a dialog: keep it open underneath so Cancel
		// returns to it. The desktop popover closes and focus goes to the trigger.
		focusTriggerOnCloseRef.current = !compact;
		if (!compact) {
			setOpen(false);
		}

		setReplacing({preset, effectCount: stackLength});
	};

	const handleConfirmReplace = () => {
		if (!replacing) {
			return;
		}

		focusTriggerOnCloseRef.current = true;
		setOpen(false);
		runApply(replacing.preset);
	};

	const handleAddToStack = (preset: PresetItem) => {
		setOpen(false);
		void addPresetToStack(preset.id).then(() => {
			announce(`Added preset ${preset.name} to stack`);
		});
	};

	const handleSave = async (name: string) => {
		const created = await saveStackAsPreset(name);
		announce(`Saved preset ${created.name}`);
	};

	const handleRename = async (id: string, name: string) => {
		const updated = await renameUserPreset(id, name);
		announce(`Renamed preset to ${updated.name}`);
	};

	const handleDelete = async (id: string) => {
		const name = deletingPreset?.name ?? 'preset';
		const deleted = await deleteUserPreset(id);
		if (deleted) {
			announce(`Deleted preset ${name}`);
		}
	};

	const trigger = (
		<Button
			ref={triggerRef}
			type="button"
			variant="ghost"
			size="sm"
			className={cn('h-8 gap-1.5 px-2.5', compact && PHONE_TOOL_CLASS)}
		>
			<BookmarkIcon aria-hidden="true" className="size-4" />
			<span>Presets</span>
		</Button>
	);

	const listBody = (
		<PresetListBody
			builtinPresets={builtinPresets}
			userPresets={userPresets}
			stackLength={stackLength}
			onApply={handleApply}
			onAddToStack={handleAddToStack}
			onRequestSave={() => {
				setOpen(false);
				setSaveOpen(true);
			}}
			onRequestRename={(preset) => {
				setOpen(false);
				setRenamingPreset(preset);
			}}
			onRequestDelete={(preset) => {
				setOpen(false);
				setDeletingPreset(preset);
			}}
		/>
	);

	return (
		<>
			{compact ? (
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>{trigger}</DialogTrigger>
					<DialogContent aria-describedby={undefined}>
						<DialogHeader>
							<DialogTitle>Presets</DialogTitle>
						</DialogHeader>
						{listBody}
					</DialogContent>
				</Dialog>
			) : (
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>{trigger}</PopoverTrigger>
					<PopoverContent
						align="start"
						aria-labelledby={titleId}
						className="w-80 p-2"
					>
						<p id={titleId} className="sr-only">
							Presets
						</p>
						{listBody}
					</PopoverContent>
				</Popover>
			)}

			<ReplaceEffectsDialog
				presetName={replacing?.preset.name ?? null}
				sideName={sideName}
				effectCount={replacing?.effectCount ?? 0}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) {
						setReplacing(null);
					}
				}}
				onConfirm={handleConfirmReplace}
				onCloseAutoFocus={(event) => {
					if (!focusTriggerOnCloseRef.current) {
						return;
					}

					event.preventDefault();
					triggerRef.current?.focus();
				}}
			/>
			<SavePresetDialog
				open={saveOpen}
				effectCount={stackLength}
				onOpenChange={setSaveOpen}
				onSave={handleSave}
			/>
			<RenamePresetDialog
				preset={renamingPreset}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) {
						setRenamingPreset(null);
					}
				}}
				onRename={handleRename}
			/>
			<DeletePresetDialog
				preset={deletingPreset}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) {
						setDeletingPreset(null);
					}
				}}
				onDelete={handleDelete}
			/>
		</>
	);
}
