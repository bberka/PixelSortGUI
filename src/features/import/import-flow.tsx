import {createContext, use, type ReactNode} from 'react';
import {ImportFeedback} from './import-feedback.tsx';
import {
	useImageImport,
	type ImageImport,
	type ImageImportOptions,
} from './use-image-import.ts';

const ImportFlowContext = createContext<ImageImport | null>(null);

/**
 One import flow for the whole shell, so its progress and dialogs stay on
 screen when an opened file replaces the screen that held the trigger.
 */
export function ImportFlowProvider({children}: {readonly children: ReactNode}) {
	const flow = useImageImport();

	return (
		<ImportFlowContext value={flow}>
			{children}
			<ImportFeedback flow={flow} />
		</ImportFlowContext>
	);
}

/**
 The shell's flow, where there is one.
 */
export function useSharedImportFlow(): ImageImport | null {
	return use(ImportFlowContext);
}

/**
 The shell's flow, or the caller's own where no provider holds one (tests).
 `feedback` is what the caller has to render for it.
 */
export function useImportFlow(options: ImageImportOptions): {
	readonly flow: ImageImport;
	readonly feedback: ReactNode;
} {
	const shared = use(ImportFlowContext);
	const own = useImageImport(options);
	return shared
		? {flow: shared, feedback: null}
		: {flow: own, feedback: <ImportFeedback flow={own} />};
}
