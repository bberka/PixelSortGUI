import {
	renderSizeForExport,
	type ExportSizeSpec,
	type RenderSize,
} from '@/codec/decode.ts';
import {
	FORMAT_MIME_TYPES,
	probeSupportedEncodeFormats,
	type ExportFormat,
	type SupportedEncodeFormats,
} from '@/codec/encode.ts';
import {
	DEFAULT_EXPORT_QUALITY,
	MAX_EXPORT_MAX_FILE_SIZE_KB,
	MAX_EXPORT_QUALITY,
	MIN_EXPORT_MAX_FILE_SIZE_KB,
	MIN_EXPORT_QUALITY,
	type ExportSettings,
} from '@/storage/types.ts';
import type {EngineErrorCode, ExportStage} from '@/worker/protocol.ts';

export const DEFAULT_SUPPORTED_FORMATS: SupportedEncodeFormats = {
	png: true,
	jpeg: true,
	webp: false,
};

export const OOM_EXPORT_MESSAGE =
	'Not enough memory to export at this size. Try 1/2 or 1/4 size.';

let cachedFormatProbe: Promise<SupportedEncodeFormats> | null = null;

export function getSupportedEncodeFormats(): Promise<SupportedEncodeFormats> {
	cachedFormatProbe ??= probeSupportedEncodeFormats().catch(
		() => DEFAULT_SUPPORTED_FORMATS,
	);
	return cachedFormatProbe;
}

export function extensionForFormat(
	format: ExportFormat,
): 'png' | 'jpg' | 'webp' {
	switch (format) {
		case 'png': {
			return 'png';
		}

		case 'jpeg': {
			return 'jpg';
		}

		case 'webp': {
			return 'webp';
		}
	}
}

export function formatTimestamp(date: Date): string {
	const year = String(date.getFullYear()).padStart(4, '0');
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

const FORBIDDEN_STEM_CHARS = new Set([
	'<',
	'>',
	':',
	'"',
	'/',
	'\\',
	'|',
	'?',
	'*',
]);

function stripUnsafeChars(
	input: string,
	forbidden: ReadonlySet<string>,
): string {
	let output = '';
	for (const char of input) {
		const code = char.codePointAt(0) ?? 0;
		output += code < 0x20 || forbidden.has(char) ? '-' : char;
	}

	return output;
}

export function sanitizeFilenameStem(projectName: string): string {
	const cleaned = stripUnsafeChars(projectName, FORBIDDEN_STEM_CHARS)
		.replaceAll(/\s+/g, ' ')
		.trim()
		.replaceAll(/^-+|-+$/g, '');
	return cleaned.length > 0 ? cleaned : 'export';
}

export function buildDefaultFilename(
	projectName: string,
	format: ExportFormat,
	date: Date = new Date(),
): string {
	return `${sanitizeFilenameStem(projectName)}-${formatTimestamp(date)}.${extensionForFormat(format)}`;
}

const IMAGE_EXTENSION_RE = /\.(?:png|jpe?g|webp)$/i;

export function replaceFilenameExtension(
	filename: string,
	format: ExportFormat,
): string {
	const trimmed = filename.trim();
	if (trimmed.length === 0) {
		return '';
	}

	const ext = extensionForFormat(format);
	return IMAGE_EXTENSION_RE.test(trimmed)
		? `${trimmed.replace(IMAGE_EXTENSION_RE, '')}.${ext}`
		: `${trimmed}.${ext}`;
}

const PATH_SEPARATORS = new Set(['/', '\\']);

export function resolveDownloadFilename(
	raw: string,
	projectName: string,
	format: ExportFormat,
	date: Date = new Date(),
): string {
	const cleaned = stripUnsafeChars(raw, PATH_SEPARATORS).trim();
	if (cleaned.length === 0) {
		return buildDefaultFilename(projectName, format, date);
	}

	const ext = extensionForFormat(format);
	if (format === 'jpeg' && /\.jpe?g$/i.test(cleaned)) {
		return cleaned;
	}

	return IMAGE_EXTENSION_RE.test(cleaned)
		? `${cleaned.replace(IMAGE_EXTENSION_RE, '')}.${ext}`
		: `${cleaned}.${ext}`;
}

export const FILE_SIZE_LIMIT_PRESETS_KB = [
	500, 1024, 2048, 5120, 10_240,
] as const;

export type FileSizeLimitPresetKb = (typeof FILE_SIZE_LIMIT_PRESETS_KB)[number];
export type FileSizeLimitMode = 'off' | `${FileSizeLimitPresetKb}` | 'custom';
export type FileSizeUnit = 'KB' | 'MB';

export function clampMaxFileSizeKb(value: number): number {
	if (!Number.isFinite(value)) {
		return 1024;
	}

	return Math.min(
		MAX_EXPORT_MAX_FILE_SIZE_KB,
		Math.max(MIN_EXPORT_MAX_FILE_SIZE_KB, Math.round(value)),
	);
}

export function fileSizeLimitModeFor(
	maxFileSizeKb: number | null | undefined,
): FileSizeLimitMode {
	if (typeof maxFileSizeKb !== 'number' || !Number.isFinite(maxFileSizeKb)) {
		return 'off';
	}

	const clamped = clampMaxFileSizeKb(maxFileSizeKb);
	for (const preset of FILE_SIZE_LIMIT_PRESETS_KB) {
		if (clamped === preset) {
			return `${preset}`;
		}
	}

	return 'custom';
}

export function formatFileSizeLimitLabel(kb: number): string {
	if (kb >= 1024 && kb % 1024 === 0) {
		return `${kb / 1024} MB`;
	}

	return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

export function formatByteSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return '0 B';
	}

	if (bytes < 1024) {
		return `${Math.round(bytes)} B`;
	}

	const kb = bytes / 1024;
	if (kb < 1024) {
		return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	}

	const mb = kb / 1024;
	return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

export function parseCustomFileSizeToKb(
	value: number,
	unit: FileSizeUnit,
): number {
	if (!Number.isFinite(value)) {
		return 1024;
	}

	const kb = unit === 'MB' ? value * 1024 : value;
	return clampMaxFileSizeKb(kb);
}

export function clampQuality(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_EXPORT_QUALITY;
	}

	return Math.min(
		MAX_EXPORT_QUALITY,
		Math.max(MIN_EXPORT_QUALITY, Math.round(value)),
	);
}

export function clampCustomLongestSide(
	value: number,
	sourceWidth: number,
	sourceHeight: number,
): number {
	const maxSide = Math.max(1, sourceWidth, sourceHeight);
	return Number.isFinite(value)
		? Math.min(maxSide, Math.max(1, Math.round(value)))
		: maxSide;
}

export function effectiveFormatFor(
	format: ExportFormat,
	supported: SupportedEncodeFormats,
): ExportFormat {
	return format === 'webp' && !supported.webp ? 'png' : format;
}

export function toExportSizeSpec(
	settings: ExportSettings,
	sourceWidth: number,
	sourceHeight: number,
): ExportSizeSpec {
	switch (settings.sizeMode) {
		case 'full': {
			return {kind: 'full'};
		}

		case 'half': {
			return {kind: 'half'};
		}

		case 'quarter': {
			return {kind: 'quarter'};
		}

		case 'custom': {
			const maxSide = clampCustomLongestSide(
				settings.customLongestSide ?? Math.max(sourceWidth, sourceHeight),
				sourceWidth,
				sourceHeight,
			);
			return {kind: 'longestSide', maxSide};
		}
	}
}

export function toExportScale(
	settings: ExportSettings,
	sourceWidth: number,
	sourceHeight: number,
): number {
	switch (settings.sizeMode) {
		case 'full': {
			return 1;
		}

		case 'half': {
			return 0.5;
		}

		case 'quarter': {
			return 0.25;
		}

		case 'custom': {
			const longest = Math.max(1, sourceWidth, sourceHeight);
			const maxSide = clampCustomLongestSide(
				settings.customLongestSide ?? longest,
				sourceWidth,
				sourceHeight,
			);
			return Math.min(1, maxSide / longest);
		}
	}
}

export function computeOutputDimensions(
	settings: ExportSettings,
	sourceWidth: number,
	sourceHeight: number,
): RenderSize {
	return renderSizeForExport(
		sourceWidth,
		sourceHeight,
		toExportSizeSpec(settings, sourceWidth, sourceHeight),
	);
}

export function stageLabel(stage: ExportStage): string {
	switch (stage) {
		case 'decode': {
			return 'Decoding';
		}

		case 'render': {
			return 'Rendering';
		}

		case 'encode': {
			return 'Encoding';
		}
	}
}

export function computeOverallProgress(
	stage: ExportStage,
	fraction: number,
): number {
	const clamped = Number.isFinite(fraction)
		? Math.min(1, Math.max(0, fraction))
		: 0;
	switch (stage) {
		case 'decode': {
			return clamped * 15;
		}

		case 'render': {
			return 15 + clamped * 70;
		}

		case 'encode': {
			return 85 + clamped * 15;
		}
	}
}

export type ExportErrorView = {
	readonly message: string;
	readonly suggestSmallerSize: boolean;
};

export function formatExportError(error: {
	code: EngineErrorCode;
	message: string;
}): ExportErrorView {
	if (error.code === 'out-of-memory') {
		return {
			message: OOM_EXPORT_MESSAGE,
			suggestSmallerSize: true,
		};
	}

	return {
		message: error.message.trim() || 'Export failed.',
		suggestSmallerSize: false,
	};
}

export function canShareFiles(format: ExportFormat): boolean {
	if (
		typeof navigator === 'undefined' ||
		typeof navigator.share !== 'function' ||
		typeof navigator.canShare !== 'function'
	) {
		return false;
	}

	try {
		const mime = FORMAT_MIME_TYPES[format];
		const probe = new File(
			[new Uint8Array(1)],
			`export.${extensionForFormat(format)}`,
			{type: mime},
		);
		return navigator.canShare({files: [probe]});
	} catch {
		return false;
	}
}

export function downloadBlob(
	blob: Blob,
	filename: string,
	revokeDelayMs = 1000,
): () => void {
	const url = URL.createObjectURL(blob);
	let revoked = false;
	let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	anchor.style.display = 'none';
	document.body.append(anchor);
	anchor.click();

	const revoke = () => {
		if (revoked) {
			return;
		}

		revoked = true;
		if (timer !== undefined) {
			globalThis.clearTimeout(timer);
			timer = undefined;
		}

		anchor.remove();
		URL.revokeObjectURL(url);
	};

	timer = globalThis.setTimeout(revoke, revokeDelayMs);
	return revoke;
}
