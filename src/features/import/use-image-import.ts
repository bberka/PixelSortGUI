import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {downscaleToPixelCap, type DownscaledSource} from './downscale.ts';
import {
	firstFrameNotice,
	problemForCodecError,
	problemForRefusedFormat,
	problemForStorageError,
	type ImportProblem,
} from './import-problems.ts';
import {isSvgFile, rasterizeSvg} from './rasterize-svg.ts';
import {announce} from '@/app/announcer.ts';
import {useAppStore} from '@/app/runtime-context.tsx';
import {
	checkDimensionLimits,
	checkFileSizeLimit,
	inspectImageFormat,
	probeImageDimensions,
	type CodecResult,
	type ImageDimensions,
} from '@/codec/decode.ts';
import {
	isQuotaExceededError,
	type CreateProjectInput,
} from '@/storage/types.ts';

export type ImportProbe = (blob: Blob) => Promise<CodecResult<ImageDimensions>>;
export type ImportDownscale = (
	blob: Blob,
	width: number,
	height: number,
) => Promise<CodecResult<DownscaledSource>>;

export type LargeImageChoice = 'downscale' | 'keep' | 'cancel';

export type LargeImagePrompt = {
	readonly fileName: string;
	readonly width: number;
	readonly height: number;
};

export type ImportProgress = {
	readonly label: string;
	/**
	0 to 1, for the progress bar.
	*/
	readonly fraction: number;
};

export type ImageImportOptions = {
	readonly probe?: ImportProbe;
	readonly downscale?: ImportDownscale;
};

export type ImageImport = {
	readonly busy: boolean;
	readonly progress: ImportProgress | null;
	readonly problems: readonly ImportProblem[];
	readonly prompt: LargeImagePrompt | null;
	start(files: readonly File[]): void;
	decide(choice: LargeImageChoice): void;
	dismissProblems(): void;
};

const SAVE_FRACTION = 0.95;

type AcceptedImage = {
	readonly input: CreateProjectInput;
	/**
	Set for an animated file: the name to announce after it is saved.
	*/
	readonly animatedFileName?: string;
};

/**
 The import flow: every chosen file is read and checked (size, decodability,
 pixel dimensions) before any of them is stored, then the accepted files are
 stored together so the first one becomes the open project (F1).
 */
export function useImageImport(options: ImageImportOptions = {}): ImageImport {
	const importImages = useAppStore((state) => state.importImages);
	const probe = options.probe ?? probeImageDimensions;
	const downscale = options.downscale ?? downscaleToPixelCap;
	const [progress, setProgress] = useState<ImportProgress | null>(null);
	const [problems, setProblems] = useState<readonly ImportProblem[]>([]);
	const [prompt, setPrompt] = useState<LargeImagePrompt | null>(null);
	const busyRef = useRef(false);
	const aliveRef = useRef(true);
	const decisionRef = useRef<((choice: LargeImageChoice) => void) | null>(null);

	useEffect(() => {
		aliveRef.current = true;
		return () => {
			aliveRef.current = false;
			decisionRef.current?.('cancel');
			decisionRef.current = null;
		};
	}, []);

	const update = (next: ImportProgress | null) => {
		if (aliveRef.current) {
			setProgress(next);
		}
	};

	const askLargeImage = async (
		next: LargeImagePrompt,
	): Promise<LargeImageChoice> =>
		new Promise<LargeImageChoice>((resolve) => {
			decisionRef.current = resolve;
			if (aliveRef.current) {
				setPrompt(next);
			}
		});

	const decide = (choice: LargeImageChoice) => {
		const resolve = decisionRef.current;
		decisionRef.current = null;
		if (aliveRef.current) {
			setPrompt(null);
		}

		resolve?.(choice);
	};

	// The raster is already within the size limits, so it needs no probe.
	const readSvg = async (
		file: File,
	): Promise<AcceptedImage | ImportProblem> => {
		const raster = await rasterizeSvg(file);
		if (!raster.ok) {
			return problemForCodecError(file.name, raster.error);
		}

		return {
			input: {
				name: file.name,
				blob: raster.value.blob,
				mimeType: raster.value.blob.type,
				width: raster.value.width,
				height: raster.value.height,
				stripExtension: true,
			},
		};
	};

	const readOne = async (
		file: File,
		index: number,
		total: number,
	): Promise<AcceptedImage | ImportProblem | null> => {
		const sizeError = checkFileSizeLimit(file.size);
		if (sizeError) {
			return problemForCodecError(file.name, sizeError);
		}

		update({
			label: `Checking ${file.name} (${index + 1} of ${total})`,
			fraction: (index + 0.5) / total,
		});
		const format = await inspectImageFormat(file, file.name);
		if (format.refused) {
			return problemForRefusedFormat(file.name, format.refused);
		}

		if (isSvgFile(file)) {
			return readSvg(file);
		}

		const probed = await probe(file);
		if (!probed.ok) {
			return problemForCodecError(file.name, probed.error);
		}

		const {width, height} = probed.value;
		const limits = checkDimensionLimits(width, height);
		if (limits.hardError) {
			return problemForCodecError(file.name, limits.hardError);
		}

		let blob: Blob = file;
		let mimeType = file.type;
		let sourceWidth = width;
		let sourceHeight = height;

		if (probed.value.exceedsGuaranteedArea) {
			update(null);
			const choice = await askLargeImage({
				fileName: file.name,
				width,
				height,
			});
			if (choice === 'cancel') {
				return null;
			}

			if (choice === 'downscale') {
				update({
					label: `Downscaling ${file.name} (${index + 1} of ${total})`,
					fraction: (index + 0.5) / total,
				});
				const scaled = await downscale(file, width, height);
				if (!scaled.ok) {
					return problemForCodecError(file.name, scaled.error);
				}

				blob = scaled.value.blob;
				mimeType = scaled.value.blob.type;
				sourceWidth = scaled.value.width;
				sourceHeight = scaled.value.height;
			}
		}

		return {
			input: {
				name: file.name,
				blob,
				mimeType: mimeType || undefined,
				width: sourceWidth,
				height: sourceHeight,
				stripExtension: true,
			},
			animatedFileName: format.animated ? file.name : undefined,
		};
	};

	const start = (files: readonly File[]) => {
		if (busyRef.current || files.length === 0) {
			return;
		}

		busyRef.current = true;
		void (async () => {
			const accepted: AcceptedImage[] = [];
			const found: ImportProblem[] = [];
			try {
				for (const [index, file] of files.entries()) {
					if (!aliveRef.current) {
						return;
					}

					const result = await readOne(file, index, files.length);
					if (result === null) {
						continue;
					}

					if ('kind' in result) {
						found.push(result);
						continue;
					}

					accepted.push(result);
				}

				if (accepted.length === 0) {
					return;
				}

				update({
					label:
						accepted.length === 1
							? 'Saving image'
							: `Saving ${accepted.length} images`,
					fraction: SAVE_FRACTION,
				});

				try {
					await importImages(accepted.map((image) => image.input));
					for (const {animatedFileName} of accepted) {
						if (animatedFileName !== undefined) {
							toast.message(firstFrameNotice(animatedFileName));
						}
					}

					announce(
						accepted.length === 1
							? 'Imported 1 image'
							: `Imported ${accepted.length} images`,
					);
				} catch (error) {
					if (!isQuotaExceededError(error)) {
						found.push(problemForStorageError(accepted[0].input.name, error));
					}
				}
			} finally {
				busyRef.current = false;
				if (aliveRef.current) {
					setProgress(null);
					if (found.length > 0) {
						setProblems(found);
					}
				}
			}
		})();
	};

	const dismissProblems = () => {
		if (aliveRef.current) {
			setProblems([]);
		}
	};

	return {
		busy: progress !== null || prompt !== null,
		progress,
		problems,
		prompt,
		start,
		decide,
		dismissProblems,
	};
}
