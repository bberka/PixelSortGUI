import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
} from 'react';
import {DownloadIcon, Share2Icon} from 'lucide-react';
import {
	buildDefaultFilename,
	canShareFiles,
	clampCustomLongestSide,
	clampMaxFileSizeKb,
	clampQuality,
	computeOutputDimensions,
	computeOverallProgress,
	DEFAULT_SUPPORTED_FORMATS,
	downloadBlob,
	effectiveFormatFor,
	FILE_SIZE_LIMIT_PRESETS_KB,
	fileSizeLimitModeFor,
	formatByteSize,
	formatExportError,
	formatFileSizeLimitLabel,
	getSupportedEncodeFormats,
	parseCustomFileSizeToKb,
	replaceFilenameExtension,
	resolveDownloadFilename,
	stageLabel,
	toExportScale,
	type ExportErrorView,
	type FileSizeLimitMode,
	type FileSizeUnit,
} from './export-helpers.ts';
import {usePhoneLayout} from '@/lib/use-phone-layout.ts';
import {announce} from '@/app/announcer.ts';
import {useAppRuntime, useAppStore} from '@/app/runtime-context.tsx';
import {
	isLossyFormat,
	type ExportFormat,
	type SupportedEncodeFormats,
} from '@/codec/encode.ts';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
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
	MAX_EXPORT_MAX_FILE_SIZE_KB,
	MAX_EXPORT_QUALITY,
	MIN_EXPORT_MAX_FILE_SIZE_KB,
	MIN_EXPORT_QUALITY,
	type ExportSettings,
	type ExportSizeMode,
	type SplitSide,
} from '@/storage/types.ts';
import {
	selectSplitOrientation,
	sideOptionLabel,
	sideStack,
} from '@/state/split-sides.ts';
import type {ExportStage} from '@/worker/protocol.ts';

type ExportMode = 'download' | 'share';

const FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
	png: 'PNG',
	jpeg: 'JPEG',
	webp: 'WebP',
	bmp: 'BMP',
	tiff: 'TIFF',
};

function isExportFormat(value: string): value is ExportFormat {
	return Object.hasOwn(FORMAT_LABELS, value);
}

type ExportProgress = {
	readonly stage: ExportStage;
	readonly percent: number;
};

type ExportSummary = {
	readonly bytes: number;
	readonly width: number;
	readonly height: number;
	readonly effectiveQuality?: number;
	readonly requestedQuality: number;
	readonly requestedWidth: number;
	readonly requestedHeight: number;
	readonly maxFileSizeKb: number | null;
	readonly targetMet: boolean;
};

export type ExportDialogProps = {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onBusyChange?: (busy: boolean) => void;
	readonly returnFocusTo?: RefObject<HTMLElement | null>;
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
	returnFocusTo,
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
	const orientation = useAppStore(selectSplitOrientation);
	const [exportSide, setExportSide] = useState<SplitSide>('b');

	const sideLabelId = useId();
	const formatLabelId = useId();
	const sizeLabelId = useId();
	const sizeLimitLabelId = useId();
	const qualityInputId = useId();
	const longestSideInputId = useId();
	const customSizeLimitInputId = useId();
	const filenameInputId = useId();

	const [probedFormats, setProbedFormats] = useState<SupportedEncodeFormats>(
		providedFormats ?? DEFAULT_SUPPORTED_FORMATS,
	);
	const supportedFormats = providedFormats ?? probedFormats;

	const [qualityDraft, setQualityDraft] = useState<string>('');
	const [qualityPreview, setQualityPreview] = useState<number | null>(null);
	const [longestSideDraft, setLongestSideDraft] = useState<string>('');
	const [sizeLimitMode, setSizeLimitMode] = useState<FileSizeLimitMode>('off');
	const [customSizeLimitDraft, setCustomSizeLimitDraft] =
		useState<string>('1024');
	const [customSizeLimitUnit, setCustomSizeLimitUnit] =
		useState<FileSizeUnit>('KB');
	const [filename, setFilename] = useState<string>('');
	const [exporting, setExporting] = useState(false);
	const [progress, setProgress] = useState<ExportProgress>({
		stage: 'decode',
		percent: 0,
	});
	const [error, setError] = useState<ExportErrorView | null>(null);
	const [summary, setSummary] = useState<ExportSummary | null>(null);

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
		setSummary(null);
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
			maxFileSizeKb: rawSettings.maxFileSizeKb ?? null,
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
		const initialLimitKb = rawSettings.maxFileSizeKb ?? null;
		const initialLimitMode = fileSizeLimitModeFor(initialLimitKb);
		if (!exporting) {
			setExportSide('b');
		}

		setQualityPreview(null);
		setQualityDraft(String(quality));
		setLongestSideDraft(String(longestSide));
		setSizeLimitMode(initialLimitMode);
		if (initialLimitKb === null) {
			setCustomSizeLimitUnit('KB');
			setCustomSizeLimitDraft('1024');
		} else if (initialLimitKb >= 1024 && initialLimitKb % 1024 === 0) {
			setCustomSizeLimitUnit('MB');
			setCustomSizeLimitDraft(String(initialLimitKb / 1024));
		} else {
			setCustomSizeLimitUnit('KB');
			setCustomSizeLimitDraft(String(initialLimitKb));
		}

		setFilename(buildDefaultFilename(activeProject.name, format, now()));
		if (exporting) {
			return;
		}

		setError(null);
		setSummary(null);
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
	const offersSide = (activeProject.stackA?.instances.length ?? 0) > 0;

	const persistSettings = (next: ExportSettings) => {
		setError(null);
		setSummary(null);
		void updateExportSettings(next).catch(() => {
			// Quota errors are surfaced by the store's storage state.
		});
	};

	const handleFormatChange = (value: string) => {
		if (
			!isExportFormat(value) ||
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

	const parseCustomSizeDraftKb = (
		draft: string,
		unit: FileSizeUnit,
		fallbackKb: number,
	): number => {
		const trimmed = draft.trim();
		if (trimmed.length === 0) {
			return fallbackKb;
		}

		const parsed = Number(trimmed);
		return Number.isFinite(parsed) && parsed > 0
			? parseCustomFileSizeToKb(parsed, unit)
			: fallbackKb;
	};

	const handleSizeLimitModeChange = (mode: FileSizeLimitMode) => {
		setSizeLimitMode(mode);
		if (mode === 'off') {
			persistSettings({...liveSettings, maxFileSizeKb: null});
			return;
		}

		if (mode === 'custom') {
			const nextKb = parseCustomSizeDraftKb(
				customSizeLimitDraft,
				customSizeLimitUnit,
				liveSettings.maxFileSizeKb ?? 1024,
			);
			const displayValue =
				customSizeLimitUnit === 'MB'
					? Number((nextKb / 1024).toFixed(2))
					: nextKb;
			setCustomSizeLimitDraft(String(displayValue));
			persistSettings({...liveSettings, maxFileSizeKb: nextKb});
			return;
		}

		const presetKb = clampMaxFileSizeKb(Number(mode));
		persistSettings({...liveSettings, maxFileSizeKb: presetKb});
	};

	const commitCustomSizeLimitInput = (unitOverride?: FileSizeUnit) => {
		const unit = unitOverride ?? customSizeLimitUnit;
		const nextKb = parseCustomSizeDraftKb(
			customSizeLimitDraft,
			unit,
			liveSettings.maxFileSizeKb ?? 1024,
		);
		const displayValue =
			unit === 'MB' ? Number((nextKb / 1024).toFixed(2)) : nextKb;
		setCustomSizeLimitDraft(String(displayValue));
		if (nextKb !== (activeProject.exportSettings.maxFileSizeKb ?? null)) {
			persistSettings({...liveSettings, maxFileSizeKb: nextKb});
		}
	};

	const handleCustomSizeUnitChange = (value: string) => {
		if (value !== 'KB' && value !== 'MB') {
			return;
		}

		const nextUnit: FileSizeUnit = value;
		setCustomSizeLimitUnit(nextUnit);
		const currentKb = parseCustomSizeDraftKb(
			customSizeLimitDraft,
			customSizeLimitUnit,
			liveSettings.maxFileSizeKb ?? 1024,
		);
		const nextDisplay =
			nextUnit === 'MB' ? Number((currentKb / 1024).toFixed(2)) : currentKb;
		setCustomSizeLimitDraft(String(nextDisplay));
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
		const finalMaxFileSizeKb =
			sizeLimitMode === 'off'
				? null
				: sizeLimitMode === 'custom'
					? parseCustomSizeDraftKb(
							customSizeLimitDraft,
							customSizeLimitUnit,
							liveSettings.maxFileSizeKb ?? 1024,
						)
					: clampMaxFileSizeKb(Number(sizeLimitMode));
		const finalSettings: ExportSettings = {
			format: effectiveFormat,
			quality: finalQuality,
			sizeMode: liveSettings.sizeMode,
			customLongestSide: finalLongest,
			maxFileSizeKb: finalMaxFileSizeKb,
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
		setSummary(null);
		setProgress({stage: 'decode', percent: 0});
		setExporting(true);

		const requestedDims = computeOutputDimensions(
			finalSettings,
			sourceWidth,
			sourceHeight,
		);

		let currentTask: ExportTask | null = null;
		const task = bundle.coordinator.exportImage({
			stack: sideStack(activeProject, offersSide ? exportSide : 'b'),
			scale: toExportScale(finalSettings, sourceWidth, sourceHeight),
			format: effectiveFormat,
			quality: finalQuality,
			maxFileSizeKb: finalMaxFileSizeKb,
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

			const nextSummary: ExportSummary = {
				bytes: outcome.file.size,
				width: outcome.width,
				height: outcome.height,
				effectiveQuality: outcome.effectiveQuality,
				requestedQuality: finalQuality,
				requestedWidth: requestedDims.width,
				requestedHeight: requestedDims.height,
				maxFileSizeKb: finalMaxFileSizeKb,
				targetMet: outcome.targetMet ?? true,
			};

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
					setSummary(nextSummary);
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
			setSummary(nextSummary);
			announce(`Export finished: ${targetFilename}`);
		});
	};

	const formBody = (
		<div className="space-y-4">
			{offersSide ? (
				<div className="space-y-2">
					<span
						id={sideLabelId}
						className="block text-sm leading-5 font-medium text-foreground"
					>
						Side
					</span>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={exportSide}
						disabled={exporting}
						aria-labelledby={sideLabelId}
						className="w-full"
						onValueChange={(value) => {
							if (!(value === 'a' || value === 'b')) {
								return;
							}

							setExportSide(value);
							setError(null);
							setSummary(null);
						}}
					>
						<ToggleGroupItem value="a" className="flex-1">
							{sideOptionLabel('a', orientation)}
						</ToggleGroupItem>
						<ToggleGroupItem value="b" className="flex-1">
							{sideOptionLabel('b', orientation)}
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
			) : null}

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
					{Object.entries(FORMAT_LABELS).map(([value, label]) =>
						value === 'webp' && !supportedFormats.webp ? null : (
							<ToggleGroupItem key={value} value={value} className="flex-1">
								{label}
							</ToggleGroupItem>
						),
					)}
				</ToggleGroup>
			</div>

			{isLossyFormat(effectiveFormat) ? (
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
						defaultMark={92}
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
			) : null}

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
				<div className="flex items-baseline justify-between gap-2">
					<span
						id={sizeLimitLabelId}
						className="text-sm leading-5 font-medium text-foreground"
					>
						Limit file size
					</span>
					{liveSettings.maxFileSizeKb ? (
						<span
							data-slot="export-size-limit-value"
							className="font-mono text-xs leading-4 text-muted-foreground tabular-nums"
						>
							≤ {formatFileSizeLimitLabel(liveSettings.maxFileSizeKb)}
						</span>
					) : null}
				</div>
				<div
					role="radiogroup"
					aria-labelledby={sizeLimitLabelId}
					className="flex flex-wrap gap-1.5"
				>
					<Button
						type="button"
						role="radio"
						aria-checked={sizeLimitMode === 'off'}
						variant={sizeLimitMode === 'off' ? 'secondary' : 'outline'}
						size="xs"
						disabled={exporting}
						onClick={() => {
							handleSizeLimitModeChange('off');
						}}
					>
						Off
					</Button>
					{FILE_SIZE_LIMIT_PRESETS_KB.map((presetKb) => {
						const modeValue: FileSizeLimitMode = `${presetKb}`;
						const selected = sizeLimitMode === modeValue;
						return (
							<Button
								key={presetKb}
								type="button"
								role="radio"
								aria-checked={selected}
								variant={selected ? 'secondary' : 'outline'}
								size="xs"
								disabled={exporting}
								onClick={() => {
									handleSizeLimitModeChange(modeValue);
								}}
							>
								{formatFileSizeLimitLabel(presetKb)}
							</Button>
						);
					})}
					<Button
						type="button"
						role="radio"
						aria-checked={sizeLimitMode === 'custom'}
						variant={sizeLimitMode === 'custom' ? 'secondary' : 'outline'}
						size="xs"
						disabled={exporting}
						onClick={() => {
							handleSizeLimitModeChange('custom');
						}}
					>
						Custom
					</Button>
				</div>

				{sizeLimitMode === 'custom' ? (
					<div className="flex items-center justify-between gap-2 pt-1">
						<Label htmlFor={customSizeLimitInputId}>Max size</Label>
						<div className="flex items-center gap-1.5">
							<Input
								id={customSizeLimitInputId}
								type="number"
								inputMode="decimal"
								min={
									customSizeLimitUnit === 'MB'
										? Number((MIN_EXPORT_MAX_FILE_SIZE_KB / 1024).toFixed(2))
										: MIN_EXPORT_MAX_FILE_SIZE_KB
								}
								max={
									customSizeLimitUnit === 'MB'
										? MAX_EXPORT_MAX_FILE_SIZE_KB / 1024
										: MAX_EXPORT_MAX_FILE_SIZE_KB
								}
								step={customSizeLimitUnit === 'MB' ? 0.1 : 10}
								disabled={exporting}
								value={customSizeLimitDraft}
								className="h-8 w-24 text-right font-mono text-[13px] tabular-nums"
								onChange={(event) => {
									setCustomSizeLimitDraft(event.target.value);
								}}
								onBlur={() => {
									commitCustomSizeLimitInput();
								}}
								onKeyDown={(event) => {
									handleInputKeyDown(event, () => {
										commitCustomSizeLimitInput();
									});
								}}
							/>
							<ToggleGroup
								type="single"
								variant="outline"
								size="sm"
								value={customSizeLimitUnit}
								disabled={exporting}
								aria-label="Max size unit"
								onValueChange={handleCustomSizeUnitChange}
							>
								<ToggleGroupItem value="KB">KB</ToggleGroupItem>
								<ToggleGroupItem value="MB">MB</ToggleGroupItem>
							</ToggleGroup>
						</div>
					</div>
				) : null}

				{!isLossyFormat(effectiveFormat) && sizeLimitMode !== 'off' ? (
					<p
						data-slot="export-png-limit-note"
						className="text-xs leading-4 text-muted-foreground"
					>
						{FORMAT_LABELS[effectiveFormat]} is lossless and scales dimensions
						to fit. Choose JPEG or WebP for smaller files.
					</p>
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
				Exported files are sRGB and carry no EXIF or GPS metadata.
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

			{summary && !exporting ? (
				<div
					aria-live="polite"
					data-slot="export-summary"
					className="space-y-1 rounded-md border border-border bg-card p-3 text-xs leading-4"
				>
					<p className="font-medium text-foreground">
						Exported{' '}
						<span className="font-mono tabular-nums">
							{formatByteSize(summary.bytes)}
						</span>{' '}
						<span className="font-mono text-muted-foreground tabular-nums">
							({summary.width} × {summary.height} px
							{summary.effectiveQuality === undefined
								? ''
								: `, quality ${summary.effectiveQuality}`}
							)
						</span>
					</p>
					{summary.targetMet ? null : (
						<p className="text-muted-foreground">
							Minimum size still exceeded the{' '}
							{summary.maxFileSizeKb
								? formatFileSizeLimitLabel(summary.maxFileSizeKb)
								: 'target'}{' '}
							limit.
						</p>
					)}
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

	const handleCloseAutoFocus = returnFocusTo
		? (event: Event) => {
				event.preventDefault();
				returnFocusTo.current?.focus();
			}
		: undefined;

	if (isPhone) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="bottom"
					className="h-dvh max-h-dvh gap-0 rounded-none p-0"
					onCloseAutoFocus={handleCloseAutoFocus}
				>
					<SheetHeader className="border-b border-border px-4 py-3.5">
						<SheetTitle>Export</SheetTitle>
						<SheetDescription className="sr-only">
							Choose format, quality, size, and file name for the exported
							image.
						</SheetDescription>
					</SheetHeader>
					<ScrollArea
						tabStop={false}
						className="min-h-0 flex-1"
						viewportClassName="[&>div]:block!"
					>
						<div className="px-4 py-4">{formBody}</div>
					</ScrollArea>
					<SheetFooter className="flex-row justify-end border-t border-border px-4 py-3">
						{footerActions}
					</SheetFooter>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-md"
				onCloseAutoFocus={handleCloseAutoFocus}
			>
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
