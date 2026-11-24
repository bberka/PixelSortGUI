import type {CodecError} from '@/codec/decode.ts';

/**
 A file the import flow refused, with the sentence the user sees. The wording
 for an unreadable file is the one in DESIGN.md section 9 and AC-F1.3; a size
 rejection reuses the codec's message, which is the one AC-F1.4 checks.
 */
export type ImportProblem = {
	readonly fileName: string;
	readonly kind: 'too-large' | 'unreadable';
	readonly message: string;
};

function lowerFirst(value: string): string {
	return value.length === 0
		? value
		: `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

export function problemForCodecError(
	fileName: string,
	error: CodecError,
): ImportProblem {
	if (error.code === 'too-large') {
		return {fileName, kind: 'too-large', message: error.message};
	}

	if (error.code === 'decode-failed' || error.code === 'unsupported-format') {
		return {
			fileName,
			kind: 'unreadable',
			message: `Can't open ${fileName}: the browser can't read this image format.`,
		};
	}

	return {
		fileName,
		kind: 'unreadable',
		message: `Can't open ${fileName}: ${lowerFirst(error.message)}`,
	};
}

export function problemForStorageError(
	fileName: string,
	error: unknown,
): ImportProblem {
	const detail =
		error instanceof Error && error.message.length > 0
			? lowerFirst(error.message)
			: 'the browser refused to store it.';
	return {
		fileName,
		kind: 'unreadable',
		message: `Can't save ${fileName}: ${detail}`,
	};
}

export function problemDialogTitle(problems: readonly ImportProblem[]): string {
	const allTooLarge = problems.every((problem) => problem.kind === 'too-large');
	if (problems.length === 1) {
		return allTooLarge ? 'Image too large' : "Can't open image";
	}

	return allTooLarge
		? `${problems.length} images are too large`
		: `Can't open ${problems.length} images`;
}
