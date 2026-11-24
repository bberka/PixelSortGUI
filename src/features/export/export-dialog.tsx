import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from 'react';
import {DownloadIcon, Share2Icon} from 'lucide-react';
import {
	buildDefaultFilename,
	canShareFiles,
	clampCustomLongestSide,
	clampQuality,
	computeOutputDimensions,
	computeOverallProgress,
	DEFAULT_SUPPORTED_FORMATS,
	downloadBlob,
	effectiveFormatFor,
	formatExportError,
	getSupportedEncodeFormats,
	replaceFilenameExtension,
	resolveDownloadFilename,
	stageLabel,
	toExportScale,
	type ExportErrorView,
} from './export-helpers.ts';
import {usePhoneLayout} from './use-phone-layout.ts';
import {announce} from '@/app/announcer.ts';
import {useAppRuntime, useAppStore} from '@/app/runtime-context.tsx';
import type {ExportFormat, SupportedEncodeFormats} from '@/codec/encode.ts';
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
import {Progress} from '@/components/ui/progress';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from '@/components/ui/sheet';
import {Slider} from '@/components/ui/slider';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import type {ExportTask} from '@/render/coordinator.ts';
import {
	MAX_EXPORT_QUALITY,
	MIN_EXPORT_QUALITY,
	type ExportSettings,
	type ExportSizeMode,
} from '@/storage/types.ts';
import type {ExportStage} from '@/worker/protocol.ts';

type ExportMode = 'download' | 'share';

type ExportProgress = {
	readonly stage: ExportStage;
	readonly percent: number;
};

export type ExportDialogProps = {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onBusyChange?: (busy: boolean) => void;
	readonly supportedFormats?: SupportedEncodeFormats;
	readonly canShare?: (format: ExportFormat) => boolean;
	readonly shareFile?: (file: File, title: string) => Promise<void>;
	readonly downloadFile?: (blob: Blob, filename: string) => () => void;
	readonly now?: () => Date;
};

async function defaultShareFile(file: File, title: string): Promise<void> {
	await navigator.share({files: [file], title});
}

function defaultNow(): Date {
	return new Date();
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

export function ExportDialog({
	open,
	onOpenChange,
	onBusyChange,
	supportedFormats: providedFormats,
	canShare = canShareFiles,
	shareFile = defaultShareFile,
	downloadFile = downloadBlob,
	now = defaultNow,
}: ExportDialogProps) {
	const {bundle} = useAppRuntime();
	const activeProject = useAppStore((state) => state.activeProject);
	const updateExportSettings = useAppStore(
		(state) => state.updateExportSettings,
	);
	const isPhone = usePhoneLayout();

	const formatLabelId = useId();
	const sizeLabelId = useId();
	const qualityInputId = useId();
	const longestSideInputId = useId();
	const filenameInputId = useId();

	const [probedFormats, setProbedFormats] = useState<SupportedEncodeFormats>(
		providedFormats ?? DEFAULT_SUPPORTED_FORMATS,
	);
	const supportedFormats = providedFormats ?? probedFormats;

	const [qualityDraft, setQualityDraft] = useState<string>('');
	const [qualityPreview, setQualityPreview] = useState<number | null>(null);
	const [longestSideDraft, setLongestSideDraft] = useState<string>('');
	const [filename, setFilename] = useState<string>('');
	const [exporting, setExporting] = useState(false);
	const [progress, setProgress] = useState<ExportProgress>({
		stage: 'decode',
		percent: 0,
	});
	const [error, setError] = useState<ExportErrorView | null>(null);

	const taskRef = useRef<ExportTask | null>(null);
	const revokersRef = useRef<Set<() => void>>(new Set());
	const mountedRef = useRef(true);
	const openRef = useRef(open);
	openRef.current = open;

	useEffect(() => {
		if (providedFormats) {
			return;
		}

		let cancelled = false;
		void getSupportedEncodeFormats().then((result) => {
			if (!cancelled) {
				setProbedFormats(result);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [providedFormats]);

	useEffect(() => {
		onBusyChange?.(exporting);
	}, [exporting, onBusyChange]);

	useEffect(() => {
		const revokers = revokersRef.current;
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			taskRef.current?.cancel();
			taskRef.current = null;
			for (const revoke of revokers) {
				revoke();
			}

			revokers.clear();
		};
	}, []);

	const projectId = activeProject?.id ?? null;
	useEffect(() => {
		taskRef.current?.cancel();
		taskRef.current = null;
		setExporting(false);
		setError(null);
	}, [projectId]);

	const rawSettings = activeProject?.exportSettings;
	const sourceWidth = activeProject?.sourceWidth ?? 1;
	const sourceHeight = activeProject?.sourceHeight ?? 1;
	const maxSourceSide = Math.max(sourceWidth, sourceHeight);

	const effectiveFormat = rawSettings
		? effectiveFormatFor(rawSettings.format, supportedFormats)
		: 'png';

	const currentSettings: ExportSettings | null = useMemo(() => {
		if (!rawSettings) {
			return null;
		}

		return {
			format: effectiveFormat,
			quality: qualityPreview ?? clampQuality(rawSettings.quality),
			sizeMode: rawSettings.sizeMode,
			customLongestSide: rawSettings.customLongestSide,
		};
	}, [rawSettings, effectiveFormat, qualityPreview]);

	const wasOpenRef = useRef(false);
	useEffect(() => {
		const justOpened = open && !wasOpenRef.current;
		wasOpenRef.current = open;
		if (!justOpened || !activeProject || !rawSettings) {
			return;
		}

		const format = effectiveFormatFor(rawSettings.format, supportedFormats);
		const quality = clampQuality(rawSettings.quality);
		const longestSide = clampCustomLongestSide(
			rawSettings.customLongestSide ?? maxSourceSide,
			sourceWidth,
			sourceHeight,
		);
		setQualityPreview(null);
		setQualityDraft(String(quality));
		setLongestSideDraft(String(longestSide));
		setFilename(buildDefaultFilename(activeProject.name, format, now()));
		if (!exporting) {
			setError(null);
		}
	}, [
		open,
		activeProject,
		rawSettings,
		supportedFormats,
		maxSourceSide,
		sourceWidth,
		sourceHeight,
		exporting,
		now,
	]);

	if (!activeProject || !currentSettings) {
		return null;
	}

	const liveSettings: ExportSettings = (() => {
		if (currentSettings.sizeMode !== 'custom') {
			return currentSettings;
		}

		const parsed = Number(longestSideDraft);
		const maxSide = clampCustomLongestSide(
			Number.isFinite(parsed)
				? parsed
				: (currentSettings.customLongestSide ?? maxSourceSide),
			sourceWidth,
			sourceHeight,
		);
		return {
			...currentSettings,
			customLongestSide: maxSide,
		};
	})();

	const outputDimensions = computeOutputDimensions(
		liveSettings,
		sourceWidth,
		sourceHeight,
	);
	const shareSupported = canShare(effectiveFormat);

	const persistSettings = (next: ExportSettings) => {
		setError(null);
		void updateExportSettings(next).catch(() => {
			// Quota errors are surfaced by the store's storage state.
		});
	};

	const handleFormatChange = (value: string) => {
		if (
			(value !== 'png' && value !== 'jpeg' && value !== 'webp') ||
			(value === 'webp' && !supportedFormats.webp)
		) {
			return;
		}

		setFilename((previous) =>
			previous.trim().length > 0
				? replaceFilenameExtension(previous, value)
				: buildDefaultFilename(activeProject.name, value, now()),
		);
		persistSettings({...liveSettings, format: value});
	};

	const handleQualitySliderChange = (values: number[]) => {
		const next = clampQuality(values[0] ?? liveSettings.quality);
		setQualityPreview(next);
		setQualityDraft(String(next));
		setError(null);
	};

	const handleQualitySliderCommit = (values: number[]) => {
		const next = clampQuality(values[0] ?? liveSettings.quality);
		setQualityPreview(null);
		setQualityDraft(String(next));
		persistSettings({...liveSettings, quality: next});
	};

	const commitQualityInput = () => {
		const parsed = Number(qualityDraft);
		const next = clampQuality(
			Number.isFinite(parsed) ? parsed : liveSettings.quality,
		);
		setQualityPreview(null);
		setQualityDraft(String(next));
		if (next !== activeProject.exportSettings.quality) {
			persistSettings({...liveSettings, quality: next});
		}
	};

	const handleSizeModeChange = (value: string) => {
		if (
			value !== 'full' &&
			value !== 'half' &&
			value !== 'quarter' &&
			value !== 'custom'
		) {
			return;
		}

		const nextSizeMode: ExportSizeMode = value;
		const nextCustomLongestSide =
			nextSizeMode === 'custom'
				? clampCustomLongestSide(
						liveSettings.customLongestSide ?? maxSourceSide,
						sourceWidth,
						sourceHeight,
					)
				: liveSettings.customLongestSide;
		if (nextSizeMode === 'custom' && nextCustomLongestSide !== null) {
			setLongestSideDraft(String(nextCustomLongestSide));
		}

		persistSettings({
			...liveSettings,
			sizeMode: nextSizeMode,
			customLongestSide: nextCustomLongestSide,
		});
	};

	const commitLongestSideInput = () => {
		const parsed = Number(longestSideDraft);
		const next = clampCustomLongestSide(
			Number.isFinite(parsed)
				? parsed
				: (currentSettings.customLongestSide ?? maxSourceSide),
			sourceWidth,
			sourceHeight,
		);
		setLongestSideDraft(String(next));
		if (next !== activeProject.exportSettings.customLongestSide) {
			persistSettings({
				...liveSettings,
				sizeMode: 'custom',
				customLongestSide: next,
			});
		}
	};

	const handleInputKeyDown = (
		event: KeyboardEvent<HTMLInputElement>,
		commit: () => void,
	) => {
		if (event.key !== 'Enter') {
			return;
		}

		event.preventDefault();
		commit();
	};

	const handleCancel = () => {
		taskRef.current?.cancel();
		taskRef.current = null;
		setExporting(false);
	};

	const startExport = (mode: ExportMode) => {
		if (exporting) {
			return;
		}

		const parsedQuality = Number(qualityDraft);
		const finalQuality = clampQuality(
			Number.isFinite(parsedQuality) ? parsedQuality : liveSettings.quality,
		);
		const parsedLongest = Number(longestSideDraft);
		const finalLongest =
			liveSettings.sizeMode === 'custom'
				? clampCustomLongestSide(
						Number.isFinite(parsedLongest) ? parsedLongest : maxSourceSide,
						sourceWidth,
						sourceHeight,
					)
				: liveSettings.customLongestSide;
		const finalSettings: ExportSettings = {
			format: effectiveFormat,
			quality: finalQuality,
			sizeMode: liveSettings.sizeMode,
			customLongestSide: finalLongest,
		};

		setQualityPreview(null);
		setQualityDraft(String(finalQuality));
		if (finalLongest !== null) {
			setLongestSideDraft(String(finalLongest));
		}

		persistSettings(finalSettings);

		const targetFilename = resolveDownloadFilename(
			filename,
			activeProject.name,
			effectiveFormat,
			now(),
		);
		setFilename(targetFilename);
		setError(null);
		setProgress({stage: 'decode', percent: 0});
		setExporting(true);

		let currentTask: ExportTask | null = null;
		const task = bundle.coordinator.exportImage({
			stack: activeProject.stack,
			scale: toExportScale(finalSettings, sourceWidth, sourceHeight),
			format: effectiveFormat,
			quality: finalQuality,
			onProgress(stage, fraction) {
				if (
					!mountedRef.current ||
					(currentTask !== null && taskRef.current !== currentTask)
				) {
					return;
				}

				const nextPercent = computeOverallProgress(stage, fraction);
				setProgress((previous) => ({
					stage,
					percent: Math.max(previous.percent, nextPercent),
				}));
			},
		});
		currentTask = task;
		taskRef.current = task;

		void task.result.then(async (outcome) => {
			if (!mountedRef.current || taskRef.current !== task) {
				return;
			}

			taskRef.current = null;

			if (outcome.status === 'cancelled') {
				setExporting(false);
				return;
			}

			if (outcome.status === 'error') {
				setExporting(false);
				setError(formatExportError(outcome.error));
				if (!openRef.current) {
					onOpenChange(true);
				}

				return;
			}

			setProgress({stage: 'encode', percent: 100});

			if (mode === 'share') {
				try {
					const file = new File([outcome.file], targetFilename, {
						type: outcome.mime,
					});
					await shareFile(file, activeProject.name);
					if (!mountedRef.current) {
						return;
					}

					setExporting(false);
					announce(`Export finished: ${targetFilename}`);
				} catch (shareError) {
					if (!mountedRef.current) {
						return;
					}

					setExporting(false);
					if (!isAbortError(shareError)) {
						setError({
							message: 'Could not open the share sheet. Use Download instead.',
							suggestSmallerSize: false,
						});
						if (!openRef.current) {
							onOpenChange(true);
						}
					}
				}

				return;
			}

			const revoke = downloadFile(outcome.file, targetFilename);
			const trackedRevoke = () => {
				revokersRef.current.delete(trackedRevoke);
				revoke();
			};

			revokersRef.current.add(trackedRevoke);
			setExporting(false);
			announce(`Export finished: ${targetFilename}`);
		});
	};

	const formBody = (
		<div className="space-y-4">
			<div className="space-y-2">
				<span
					id={formatLabelId}
					className="block text-sm leading-5 font-medium text-foreground"
				>
					Format
				</span>
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={effectiveFormat}
					disabled={exporting}
					aria-labelledby={formatLabelId}
					className="w-full"
					onValueChange={handleFormatChange}
				>
					<ToggleGroupItem value="png" className="flex-1">
						PNG
					</ToggleGroupItem>
					<ToggleGroupItem value="jpeg" className="flex-1">
						JPEG
					</ToggleGroupItem>
					{supportedFormats.webp ? (
						<ToggleGroupItem value="webp" className="flex-1">
							WebP
						</ToggleGroupItem>
					) : null}
				</ToggleGroup>
			</div>

			{effectiveFormat === 'png' ? null : (
				<div className="space-y-2">
					<div className="flex items-center justify-between gap-2">
						<Label htmlFor={qualityInputId}>Quality</Label>
						<Input
							id={qualityInputId}
							type="number"
							inputMode="numeric"
							min={MIN_EXPORT_QUALITY}
							max={MAX_EXPORT_QUALITY}
							step={1}
							disabled={exporting}
							value={qualityDraft}
							className="h-8 w-20 text-right font-mono text-[13px] tabular-nums"
							onChange={(event) => {
								setQualityDraft(event.target.value);
								const parsed = Number(event.target.value);
								if (
									Number.isFinite(parsed) &&
									parsed >= MIN_EXPORT_QUALITY &&
									parsed <= MAX_EXPORT_QUALITY
								) {
									setQualityPreview(Math.round(parsed));
								}
							}}
							onBlur={commitQualityInput}
							onKeyDown={(event) => {
								handleInputKeyDown(event, commitQualityInput);
							}}
						/>
					</div>
					<Slider
						min={MIN_EXPORT_QUALITY}
						max={MAX_EXPORT_QUALITY}
						step={1}
						disabled={exporting}
						value={[liveSettings.quality]}
						thumbLabels={['Quality']}
						onValueChange={handleQualitySliderChange}
						onValueCommit={handleQualitySliderCommit}
					/>
				</div>
			)}

			<div className="space-y-2">
				<div className="flex items-baseline justify-between gap-2">
					<span
						id={sizeLabelId}
						className="text-sm leading-5 font-medium text-foreground"
					>
						Size
					</span>
					<span
						data-slot="export-dimensions"
						className="font-mono text-xs leading-4 text-muted-foreground tabular-nums"
					>
						{outputDimensions.width} × {outputDimensions.height} px
					</span>
				</div>
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={liveSettings.sizeMode}
					disabled={exporting}
					aria-labelledby={sizeLabelId}
					className="w-full"
					onValueChange={handleSizeModeChange}
				>
					<ToggleGroupItem value="full" className="flex-1">
						Full
					</ToggleGroupItem>
					<ToggleGroupItem value="half" className="flex-1">
						1/2
					</ToggleGroupItem>
					<ToggleGroupItem value="quarter" className="flex-1">
						1/4
					</ToggleGroupItem>
					<ToggleGroupItem value="custom" className="flex-1">
						Custom
					</ToggleGroupItem>
				</ToggleGroup>

				{liveSettings.sizeMode === 'custom' ? (
					<div className="flex items-center justify-between gap-2 pt-1">
						<Label htmlFor={longestSideInputId}>Longest side (px)</Label>
						<Input
							id={longestSideInputId}
							type="number"
							inputMode="numeric"
							min={1}
							max={maxSourceSide}
							step={1}
							disabled={exporting}
							value={longestSideDraft}
							className="h-8 w-28 text-right font-mono text-[13px] tabular-nums"
							onChange={(event) => {
								setLongestSideDraft(event.target.value);
							}}
							onBlur={commitLongestSideInput}
							onKeyDown={(event) => {
								handleInputKeyDown(event, commitLongestSideInput);
							}}
						/>
					</div>
				) : null}
			</div>

			<div className="space-y-2">
				<Label htmlFor={filenameInputId}>File name</Label>
				<Input
					id={filenameInputId}
					type="text"
					disabled={exporting}
					value={filename}
					className="font-mono text-[13px]"
					onChange={(event) => {
						setFilename(event.target.value);
					}}
				/>
			</div>

			<p className="text-xs leading-4 text-muted-foreground">
				Exported files are sRGB and carry no EXIF, GPS, or ICC metadata.
				{effectiveFormat === 'jpeg'
					? ' Transparent pixels are flattened onto white.'
					: ''}
			</p>

			{exporting ? (
				<div
					data-slot="export-progress"
					className="space-y-1.5 rounded-md border border-border bg-card p-3"
				>
					<div className="flex items-center justify-between gap-2 text-xs leading-4">
						<span className="font-medium text-foreground">
							{stageLabel(progress.stage)}
						</span>
						<span className="font-mono text-muted-foreground tabular-nums">
							{Math.round(progress.percent)}%
						</span>
					</div>
					<Progress value={progress.percent} aria-label="Export progress" />
				</div>
			) : null}

			{error ? (
				<div
					role="alert"
					className="space-y-2 rounded-md border border-destructive bg-card p-3 text-sm text-destructive-text"
				>
					<p>{error.message}</p>
					{error.suggestSmallerSize ? (
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								size="xs"
								onClick={() => {
									handleSizeModeChange('half');
								}}
							>
								Use 1/2 size
							</Button>
							<Button
								type="button"
								variant="outline"
								size="xs"
								onClick={() => {
									handleSizeModeChange('quarter');
								}}
							>
								Use 1/4 size
							</Button>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);

	const footerActions: ReactNode = exporting ? (
		<Button type="button" variant="outline" onClick={handleCancel}>
			Cancel
		</Button>
	) : (
		<>
			{shareSupported ? (
				<Button
					type="button"
					variant="secondary"
					onClick={() => {
						startExport('share');
					}}
				>
					<Share2Icon aria-hidden="true" />
					Share
				</Button>
			) : null}
			<Button
				type="button"
				variant="default"
				onClick={() => {
					startExport('download');
				}}
			>
				<DownloadIcon aria-hidden="true" />
				Download
			</Button>
		</>
	);

	if (isPhone) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="bottom"
					className="h-dvh max-h-dvh gap-0 rounded-none p-0"
				>
					<SheetHeader className="border-b border-border px-4 py-3.5">
						<SheetTitle>Export</SheetTitle>
						<SheetDescription className="sr-only">
							Choose format, quality, size, and file name for the exported
							image.
						</SheetDescription>
					</SheetHeader>
					<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
						{formBody}
					</div>
					<SheetFooter className="flex-row justify-end border-t border-border px-4 py-3">
						{footerActions}
					</SheetFooter>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Export</DialogTitle>
					<DialogDescription className="sr-only">
						Choose format, quality, size, and file name for the exported image.
					</DialogDescription>
				</DialogHeader>
				{formBody}
				<DialogFooter>{footerActions}</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
