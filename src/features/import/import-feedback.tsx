import {ImportProblemDialog} from './import-problem-dialog.tsx';
import {ImportProgressCard} from './import-progress-card.tsx';
import {LargeImageDialog} from './large-image-dialog.tsx';
import type {ImageImport} from './use-image-import.ts';

/**
 The states an import can show over the current screen: progress while a file
 is read, the 50 MP choice, and the rejection dialog.
 */
export function ImportFeedback({flow}: {readonly flow: ImageImport}) {
	return (
		<>
			{flow.progress ? <ImportProgressCard progress={flow.progress} /> : null}
			{flow.prompt ? (
				<LargeImageDialog prompt={flow.prompt} onDecide={flow.decide} />
			) : null}
			{flow.problems.length > 0 ? (
				<ImportProblemDialog
					problems={flow.problems}
					onDismiss={flow.dismissProblems}
				/>
			) : null}
		</>
	);
}
