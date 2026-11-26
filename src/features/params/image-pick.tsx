import {createContext, use, useRef, useState, type ReactNode} from 'react';
import {toast} from 'sonner';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {probeImageDimensions} from '@/codec/decode.ts';
import {downscaleToPixelCap} from '@/features/import/downscale.ts';
import {ImportFeedback} from '@/features/import/import-feedback.tsx';
import {
	firstFrameNotice,
	type ImportProblem,
} from '@/features/import/import-problems.ts';
import {
	readImageFile,
	type ImportDownscale,
	type ImportProbe,
} from '@/features/import/read-image-file.ts';
import {useLargeImagePrompt} from '@/features/import/use-large-image-prompt.ts';
import type {ImportProgress} from '@/features/import/use-image-import.ts';
import {
	IMAGE_ACCEPT,
	useImagePicker,
} from '@/features/import/use-image-picker.ts';
import type {ImageChoice} from '@/state/app-store.ts';
import {
	EXTRA_SOURCE_LIMIT_MESSAGE,
	missingSourceError,
} from '@/storage/extra-sources.ts';
import {isQuotaExceededError} from '@/storage/types.ts';

// The `image` parameter a choice is for.
export type ImageTarget = {
	readonly projectId: string;
	readonly instanceId: string;
	readonly paramKey: string;
	readonly label: string;
	// The id of the button the focus returns to after a dialog.
	readonly triggerId: string;
};

export type ImagePick = {
	// A chosen file is being read or stored.
	readonly busy: boolean;
	// Why the latest choice was refused.
	readonly failure: {
		readonly target: ImageTarget;
		readonly message: string;
	} | null;
	// Opens the system file picker. Call it from the user's own event.
	pickFile(target: ImageTarget): void;
	// Uses a stored image, or none for `''`.
	choose(target: ImageTarget, sha256: string): void;
};

const SAVE_FRACTION = 0.95;
const FAILED_MESSAGE = "Couldn't use that image.";
const GONE_MESSAGE = 'That image is no longer stored on this device.';

// `null` when another dialog reports it.
function failureMessage(error: unknown, choice: ImageChoice): string | null {
	if (isQuotaExceededError(error)) {
		return null;
	}

	const message = error instanceof Error ? error.message : '';
	if (message === EXTRA_SOURCE_LIMIT_MESSAGE) {
		return message;
	}

	return 'sha256' in choice &&
		message === missingSourceError(choice.sha256).message
		? GONE_MESSAGE
		: FAILED_MESSAGE;
}

const ImagePickContext = createContext<ImagePick | null>(null);

export type ImagePickProviderProps = {
	readonly children: ReactNode;
	// Test seams for the codec calls.
	readonly probe?: ImportProbe;
	readonly downscale?: ImportDownscale;
};

// The state of a choice, and what has to be rendered for it.
function useImagePickState({
	probe = probeImageDimensions,
	downscale = downscaleToPixelCap,
}: Omit<ImagePickProviderProps, 'children'>): {
	readonly pick: ImagePick;
	readonly feedback: ReactNode;
} {
	const commitImageParam = useAppStore((state) => state.commitImageParam);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<ImportProgress | null>(null);
	const [problems, setProblems] = useState<readonly ImportProblem[]>([]);
	const [failure, setFailure] = useState<ImagePick['failure']>(null);
	const {prompt, ask, decide} = useLargeImagePrompt();
	const busyRef = useRef(false);
	const targetRef = useRef<ImageTarget | null>(null);

	// `false` when the choice was refused.
	const commit = async (target: ImageTarget, choice: ImageChoice) => {
		try {
			const changed = await commitImageParam(
				target.projectId,
				target.instanceId,
				target.paramKey,
				choice,
			);
			if (changed) {
				const cleared = 'sha256' in choice && choice.sha256 === '';
				announce(`${target.label} ${cleared ? 'cleared' : 'chosen'}`);
			}

			return true;
		} catch (error) {
			const message = failureMessage(error, choice);
			if (message !== null) {
				setFailure({target, message});
			}

			return false;
		}
	};

	const readFile = async (target: ImageTarget, file: File) => {
		const result = await readImageFile(file, {
			probe,
			downscale,
			askLargeImage: ask,
			onStage(stage) {
				setProgress(
					stage === undefined
						? null
						: {label: `${stage} ${file.name}`, fraction: 0.5},
				);
			},
		});
		if (result === null) {
			return;
		}

		if ('kind' in result) {
			setProblems([result]);
			return;
		}

		setProgress({label: 'Saving image', fraction: SAVE_FRACTION});
		const {animated, blob, mimeType, width, height} = result;
		const stored = await commit(target, {
			image: {
				blob,
				mimeType: mimeType ?? (blob.type || 'application/octet-stream'),
				width,
				height,
			},
		});
		if (stored && animated) {
			toast.message(firstFrameNotice(file.name));
		}
	};

	const picker = useImagePicker(([file]) => {
		const target = targetRef.current;
		if (!target || busyRef.current) {
			return;
		}

		busyRef.current = true;
		setBusy(true);
		void readFile(target, file)
			.catch(() => {
				setFailure({target, message: FAILED_MESSAGE});
			})
			.finally(() => {
				busyRef.current = false;
				setBusy(false);
				setProgress(null);
			});
	});

	return {
		pick: {
			busy,
			failure,
			pickFile(target) {
				targetRef.current = target;
				setFailure(null);
				picker.open();
			},
			choose(target, sha256) {
				setFailure(null);
				void commit(target, {sha256});
			},
		},
		feedback: (
			<>
				<input
					ref={picker.inputRef}
					hidden
					type="file"
					accept={IMAGE_ACCEPT}
					data-slot="image-param-input"
					onChange={picker.onInputChange}
				/>
				<ImportFeedback
					flow={{
						progress,
						prompt,
						decide,
						problems,
						dismissProblems() {
							setProblems([]);
						},
					}}
					onDialogCloseAutoFocus={(event) => {
						// A param id starts with a letter, so it needs no escaping.
						const id = targetRef.current?.triggerId;
						const trigger = id
							? globalThis.document.querySelector<HTMLElement>(`#${id}`)
							: null;
						if (!trigger) {
							return;
						}

						event.preventDefault();
						trigger.focus();
					}}
				/>
			</>
		),
	};
}

/**
 Choosing the image of an `image` parameter. It lives above the parameter
 panel, so its file input, progress and dialogs survive a layout change that
 remounts the control while a file is being read.
 */
export function ImagePickProvider({
	children,
	...options
}: ImagePickProviderProps) {
	const {pick, feedback} = useImagePickState(options);

	return (
		<ImagePickContext value={pick}>
			{children}
			{feedback}
		</ImagePickContext>
	);
}

export function useImagePick(): ImagePick {
	const pick = use(ImagePickContext);
	if (!pick) {
		throw new Error('useImagePick must be called under ImagePickProvider');
	}

	return pick;
}
