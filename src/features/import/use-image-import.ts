import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {downscaleToPixelCap, type DownscaledSource} from './downscale.ts';
import {
	firstFrameNotice,
	problemForArchive,
	problemForCodecError,
	problemForProjectFile,
	problemForRefusedFormat,
	problemForStorageError,
	type ImportProblem,
} from './import-problems.ts';
import {isSvgFile, rasterizeSvg} from './rasterize-svg.ts';
import {isProjectFileName, isZipFileName} from './use-image-picker.ts';
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
import type {ArchiveKind} from '@/storage/archive-kind.ts';
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

export type ImportReadKind = (
	file: Blob,
	options: {signal: AbortSignal},
) => Promise<ArchiveKind>;

export type ImageImportOptions = {
	readonly probe?: ImportProbe;
	readonly downscale?: ImportDownscale;
	readonly readKind?: ImportReadKind;
};

/**
 A backup waiting for its "Import backup" dialog.
 */
export type PendingBackup = {
	readonly file: File;
	/**
	 What had the focus when the file was chosen.
	 */
	readonly origin: HTMLElement | null;
};

// Loaded on first use, like the rest of the archive code.
const readKindInWorker: ImportReadKind = async (file, options) => {
	const {openArchiveKind} = await import('@/storage/archive-client.ts');
	return openArchiveKind(file, options);
};

export type ImageImport = {
	readonly busy: boolean;
	readonly progress: ImportProgress | null;
	readonly problems: readonly ImportProblem[];
	readonly prompt: LargeImagePrompt | null;
	readonly backup: PendingBackup | null;
	start(files: readonly File[]): void;
	/**
	 The file chosen with "Import backup": a project file is opened, everything
	 else goes to the backup dialog, which says what is wrong with it.
	 */
	startBackup(file: File, origin: HTMLElement | null): void;
	closeBackup(): void;
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
 The import flow: every chosen image is read and checked (size, decodability,
 pixel dimensions) before any of them is stored, then the accepted images are
 stored together (F1). Project files (F25) are opened one by one as they come.
 The first chosen file that opened becomes the open project. A `.zip` goes by
 its manifest; a backup (F17) is handed on once the other files are done.
 */
export function useImageImport(options: ImageImportOptions = {}): ImageImport {
	const importImages = useAppStore((state) => state.importImages);
	const importProjectFile = useAppStore((state) => state.importProjectFile);
	const openProject = useAppStore((state) => state.openProject);
	const probe = options.probe ?? probeImageDimensions;
	const downscale = options.downscale ?? downscaleToPixelCap;
	const readKind = options.readKind ?? readKindInWorker;
	const [progress, setProgress] = useState<ImportProgress | null>(null);
	const [problems, setProblems] = useState<readonly ImportProblem[]>([]);
	const [prompt, setPrompt] = useState<LargeImagePrompt | null>(null);
	const [backup, setBackup] = useState<PendingBackup | null>(null);
	const busyRef = useRef(false);
	const backupRef = useRef<PendingBackup | null>(null);
	const aliveRef = useRef(true);
	const decisionRef = useRef<((choice: LargeImageChoice) => void) | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		aliveRef.current = true;
		return () => {
			aliveRef.current = false;
			abortRef.current?.abort();
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

	// The id of the new project, or why there is none. A full quota has its own
	// dialog.
	const readProject = async (
		file: File,
		index: number,
		total: number,
	): Promise<ImportProblem | {projectId: string} | null> => {
		const label = `Opening ${file.name} (${index + 1} of ${total})`;
		update({label, fraction: index / total});
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const {project} = await importProjectFile(file, file.name, {
				setActive: false,
				signal: controller.signal,
				onProgress({fraction}) {
					update({label, fraction: (index + fraction) / total});
				},
			});
			announce(`Opened ${project.name}`);
			return {projectId: project.id};
		} catch (error) {
			return isQuotaExceededError(error) || controller.signal.aborted
				? null
				: problemForProjectFile(file.name, error);
		}
	};

	// What a `.zip` is, or why it cannot be told. `null` once the flow is gone.
	const sortArchive = async (
		file: File,
		index: number,
		total: number,
	): Promise<ArchiveKind | ImportProblem | null> => {
		update({
			label: `Opening ${file.name} (${index + 1} of ${total})`,
			fraction: index / total,
		});
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			return await readKind(file, {signal: controller.signal});
		} catch (error) {
			return controller.signal.aborted
				? null
				: problemForStorageError(file.name, error);
		}
	};

	const closeBackup = () => {
		backupRef.current = null;
		if (aliveRef.current) {
			setBackup(null);
		}
	};

	const run = (
		files: readonly File[],
		// Set for a file chosen with "Import backup".
		asBackup: boolean,
		origin: HTMLElement | null,
	) => {
		// A backup dialog in progress must not be swapped for another file.
		if (busyRef.current || backupRef.current || files.length === 0) {
			return;
		}

		busyRef.current = true;
		void (async () => {
			const accepted: AcceptedImage[] = [];
			const found: ImportProblem[] = [];
			// Set when a project file comes before every accepted image.
			let firstProjectId: string | undefined;
			let chosenBackup: PendingBackup | null = null;
			try {
				for (const [index, file] of files.entries()) {
					if (!aliveRef.current) {
						return;
					}

					let isProject = isProjectFileName(file.name);
					if (asBackup || isZipFileName(file.name)) {
						const kind = await sortArchive(file, index, files.length);
						if (kind === null) {
							continue;
						}

						if (typeof kind === 'object') {
							found.push(kind);
							continue;
						}

						isProject = kind === 'project';
						if (kind !== 'project') {
							if (asBackup || kind === 'backup') {
								if (chosenBackup) {
									found.push(problemForArchive(file.name, 'second-backup'));
								} else {
									chosenBackup = {file, origin};
								}
							} else {
								found.push(problemForArchive(file.name, kind));
							}

							continue;
						}
					}

					if (isProject) {
						const opened = await readProject(file, index, files.length);
						if (opened && 'kind' in opened) {
							found.push(opened);
						} else if (opened && accepted.length === 0) {
							firstProjectId ??= opened.projectId;
						}

						continue;
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
					if (firstProjectId !== undefined) {
						await openProject(firstProjectId);
					}

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
					if (firstProjectId !== undefined) {
						await openProject(firstProjectId);
					}

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

					if (chosenBackup) {
						backupRef.current = chosenBackup;
						setBackup(chosenBackup);
					}
				}
			}
		})();
	};

	const start = (files: readonly File[]) => {
		const focused = globalThis.document.activeElement;
		run(files, false, focused instanceof HTMLElement ? focused : null);
	};

	const startBackup = (file: File, origin: HTMLElement | null) => {
		run([file], true, origin);
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
		backup,
		start,
		startBackup,
		closeBackup,
		decide,
		dismissProblems,
	};
}
