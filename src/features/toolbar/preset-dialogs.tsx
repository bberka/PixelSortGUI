import {useId, useState, type SubmitEvent} from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
	MAX_PRESET_NAME_LENGTH,
	type UserPresetRecord,
} from '@/storage/types.ts';

function validateNameInput(raw: string): string | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return 'Enter a preset name.';
	}

	return trimmed.length > MAX_PRESET_NAME_LENGTH
		? `Preset name must be at most ${MAX_PRESET_NAME_LENGTH} characters.`
		: null;
}

export type SavePresetDialogProps = {
	readonly open: boolean;
	readonly effectCount: number;
	readonly onOpenChange: (open: boolean) => void;
	readonly onSave: (name: string) => Promise<void>;
};

export function SavePresetDialog({
	open,
	effectCount,
	onOpenChange,
	onSave,
}: SavePresetDialogProps) {
	const [name, setName] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const inputId = useId();
	const errorId = useId();

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setName('');
			setError(null);
			setBusy(false);
		}

		onOpenChange(nextOpen);
	};

	const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const validationError = validateNameInput(name);
		if (validationError) {
			setError(validationError);
			return;
		}

		setBusy(true);
		setError(null);
		try {
			await onSave(name.trim());
			handleOpenChange(false);
		} catch (caught: unknown) {
			setError(
				caught instanceof Error ? caught.message : 'Could not save preset.',
			);
			setBusy(false);
		}
	};

	const summary =
		effectCount === 1
			? 'Saves the current stack (1 effect) for reuse on any project.'
			: `Saves the current stack (${effectCount} effects) for reuse on any project.`;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Save as preset</DialogTitle>
					<DialogDescription>{summary}</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						void handleSubmit(event);
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={inputId}>Preset name</Label>
						<Input
							autoFocus
							id={inputId}
							value={name}
							maxLength={MAX_PRESET_NAME_LENGTH}
							aria-invalid={error !== null}
							aria-describedby={error ? errorId : undefined}
							placeholder="My preset"
							onChange={(event) => {
								setName(event.target.value);
								if (error) {
									setError(null);
								}
							}}
						/>
						{error ? (
							<p
								id={errorId}
								role="alert"
								className="text-xs text-destructive-text"
							>
								{error}
							</p>
						) : null}
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => {
								handleOpenChange(false);
							}}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy}>
							Save preset
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export type RenamePresetDialogProps = {
	readonly preset: UserPresetRecord | null;
	readonly onOpenChange: (open: boolean) => void;
	readonly onRename: (id: string, name: string) => Promise<void>;
};

export function RenamePresetDialog({
	preset,
	onOpenChange,
	onRename,
}: RenamePresetDialogProps) {
	return (
		<Dialog open={preset !== null} onOpenChange={onOpenChange}>
			{preset ? (
				<RenamePresetDialogBody
					key={preset.id}
					preset={preset}
					onCancel={() => {
						onOpenChange(false);
					}}
					onRename={onRename}
				/>
			) : null}
		</Dialog>
	);
}

function RenamePresetDialogBody({
	preset,
	onCancel,
	onRename,
}: {
	readonly preset: UserPresetRecord;
	readonly onCancel: () => void;
	readonly onRename: (id: string, name: string) => Promise<void>;
}) {
	const [name, setName] = useState(preset.name);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const inputId = useId();
	const errorId = useId();

	const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const validationError = validateNameInput(name);
		if (validationError) {
			setError(validationError);
			return;
		}

		setBusy(true);
		setError(null);
		try {
			await onRename(preset.id, name.trim());
			onCancel();
		} catch (caught: unknown) {
			setError(
				caught instanceof Error ? caught.message : 'Could not rename preset.',
			);
			setBusy(false);
		}
	};

	return (
		<DialogContent aria-describedby={undefined}>
			<DialogHeader>
				<DialogTitle>Rename preset</DialogTitle>
			</DialogHeader>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					void handleSubmit(event);
				}}
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={inputId}>Preset name</Label>
					<Input
						autoFocus
						id={inputId}
						value={name}
						maxLength={MAX_PRESET_NAME_LENGTH}
						aria-invalid={error !== null}
						aria-describedby={error ? errorId : undefined}
						onChange={(event) => {
							setName(event.target.value);
							if (error) {
								setError(null);
							}
						}}
					/>
					{error ? (
						<p
							id={errorId}
							role="alert"
							className="text-xs text-destructive-text"
						>
							{error}
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={onCancel}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={busy}>
						Save
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}

export type DeletePresetDialogProps = {
	readonly preset: UserPresetRecord | null;
	readonly onOpenChange: (open: boolean) => void;
	readonly onDelete: (id: string) => Promise<void>;
};

export function DeletePresetDialog({
	preset,
	onOpenChange,
	onDelete,
}: DeletePresetDialogProps) {
	const [busy, setBusy] = useState(false);

	const handleConfirm = async () => {
		if (!preset) {
			return;
		}

		setBusy(true);
		try {
			await onDelete(preset.id);
			onOpenChange(false);
		} finally {
			setBusy(false);
		}
	};

	return (
		<AlertDialog open={preset !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete preset?</AlertDialogTitle>
					<AlertDialogDescription>
						{preset
							? `Delete "${preset.name}"? This removes it from this device.`
							: ''}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={busy}
						onClick={(event) => {
							event.preventDefault();
							void handleConfirm();
						}}
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function formatEffectCount(count: number): string {
	return count === 1 ? '1 effect' : `${count} effects`;
}

export type ReplaceEffectsDialogProps = {
	readonly presetName: string | null;
	readonly effectCount: number;
	readonly sideName?: string;
	readonly onOpenChange: (open: boolean) => void;
	readonly onConfirm: () => void;
	readonly onCloseAutoFocus: (event: Event) => void;
};

export function ReplaceEffectsDialog({
	presetName,
	effectCount,
	sideName,
	onOpenChange,
	onConfirm,
	onCloseAutoFocus,
}: ReplaceEffectsDialogProps) {
	const place = sideName ? `on side ${sideName}` : 'in this project';
	return (
		<AlertDialog open={presetName !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
				<AlertDialogHeader>
					<AlertDialogTitle>Replace current effects?</AlertDialogTitle>
					<AlertDialogDescription>
						{presetName === null
							? ''
							: `Applying "${presetName}" removes the ${formatEffectCount(effectCount)} ${place}. You can undo this.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>Replace</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
