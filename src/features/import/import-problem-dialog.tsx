import {problemDialogTitle, type ImportProblem} from './import-problems.ts';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 The rejection dialog from DESIGN.md section 9: the exact sentence per refused
 file, and a single Dismiss action. A file that fails these checks creates no
 project.
 */
export function ImportProblemDialog({
	problems,
	onDismiss,
	onCloseAutoFocus,
}: {
	readonly problems: readonly ImportProblem[];
	readonly onDismiss: () => void;
	readonly onCloseAutoFocus?: (event: Event) => void;
}) {
	return (
		<AlertDialog
			open={problems.length > 0}
			onOpenChange={(open) => {
				if (!open) {
					onDismiss();
				}
			}}
		>
			<AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
				<AlertDialogHeader>
					<AlertDialogTitle>{problemDialogTitle(problems)}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div>
							{problems.length === 1 ? (
								<p>{problems[0].message}</p>
							) : (
								<ul className="list-disc pl-4">
									{problems.map((problem, index) => (
										// Two chosen files may share a name.
										<li key={`${index} ${problem.fileName}`}>
											{problem.message}
										</li>
									))}
								</ul>
							)}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction onClick={onDismiss}>Dismiss</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
