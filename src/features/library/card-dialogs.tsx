import {useId, useState} from 'react';
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
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {validateProjectNameInput} from '@/features/library/library-format.ts';
import type {ProjectRecord} from '@/storage/types.ts';

export type RenameProjectDialogProps = {
	readonly project: ProjectRecord | null;
	readonly onClose: () => void;
	readonly onRename: (project: ProjectRecord, name: string) => void;
};

export function RenameProjectDialog({
	project,
	onClose,
	onRename,
}: RenameProjectDialogProps) {
	const inputId = useId();
	const errorId = useId();
	const [value, setValue] = useState(project?.name ?? '');
	const [error, setError] = useState<string | null>(null);

	const submit = (raw: string) => {
		if (!project) {
			return;
		}

		const validation = validateProjectNameInput(raw);
		if (validation.ok) {
			onRename(project, validation.name);
		} else {
			setError(validation.error);
		}
	};

	return (
		<Dialog
			open={project !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rename project</DialogTitle>
				</DialogHeader>
				<form
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						submit(value);
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={inputId}>Name</Label>
						<Input
							id={inputId}
							value={value}
							aria-invalid={error ? true : undefined}
							aria-describedby={error ? errorId : undefined}
							onChange={(event) => {
								setValue(event.target.value);
								setError(null);
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
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit">Rename</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export type DeleteProjectDialogProps = {
	readonly project: ProjectRecord | null;
	readonly onClose: () => void;
	readonly onConfirm: (project: ProjectRecord) => void;
};

export function DeleteProjectDialog({
	project,
	onClose,
	onConfirm,
}: DeleteProjectDialogProps) {
	return (
		<AlertDialog
			open={project !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete project</AlertDialogTitle>
					<AlertDialogDescription>
						{project
							? `Delete ${project.name}? This removes it from this device.`
							: null}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => {
							if (project) {
								onConfirm(project);
							}
						}}
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
