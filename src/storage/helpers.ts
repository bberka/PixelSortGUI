import {
	MAX_STACK_INSTANCES,
	STACK_SCHEMA_VERSION,
	type EffectStack,
} from '../engine/types.ts';
import {
	DEFAULT_EXPORT_QUALITY,
	DEFAULT_SPLIT_POSITION,
	MAX_EXPORT_MAX_FILE_SIZE_KB,
	MAX_EXPORT_QUALITY,
	MAX_PRESET_NAME_LENGTH,
	MAX_PROJECT_NAME_LENGTH,
	MAX_ZOOM,
	MIN_EXPORT_MAX_FILE_SIZE_KB,
	MIN_EXPORT_QUALITY,
	MIN_ZOOM,
	StorageValidationError,
	type AppStateRecord,
	type ExportSettings,
	type ViewState,
} from './types.ts';

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function createEmptyStack(): EffectStack {
	return {
		schemaVersion: STACK_SCHEMA_VERSION,
		instances: [],
	};
}

export function createDefaultViewState(
	width: number,
	height: number,
): ViewState {
	return {
		fitMode: 'fit',
		zoom: 1,
		centerX: width / 2,
		centerY: height / 2,
		splitPosition: DEFAULT_SPLIT_POSITION,
	};
}

export function createDefaultExportSettings(): ExportSettings {
	return {
		format: 'png',
		quality: DEFAULT_EXPORT_QUALITY,
		sizeMode: 'full',
		customLongestSide: null,
		maxFileSizeKb: null,
	};
}

export function createDefaultAppState(): AppStateRecord {
	return {
		key: 'appState',
		activeProjectId: null,
		theme: 'system',
		compareMode: 'toggle',
	};
}

export function normalizeImportProjectName(
	rawName: string,
	stripExtension = true,
): string {
	let name = rawName.trim();
	if (stripExtension) {
		const lastDot = name.lastIndexOf('.');
		if (lastDot > 0) {
			name = name.slice(0, lastDot);
		}
	}

	name = name.trim();
	return name.length === 0
		? 'Untitled'
		: name.slice(0, MAX_PROJECT_NAME_LENGTH).trim() || 'Untitled';
}

export function validateProjectName(rawName: string): string {
	const name = rawName.trim();
	if (name.length === 0 || name.length > MAX_PROJECT_NAME_LENGTH) {
		throw new StorageValidationError(
			`Project name must be between 1 and ${MAX_PROJECT_NAME_LENGTH} characters`,
		);
	}

	return name;
}

export function createDuplicateProjectName(name: string): string {
	return `${name} copy`.slice(0, MAX_PROJECT_NAME_LENGTH);
}

export function validatePresetName(rawName: string): string {
	const name = rawName.trim();
	if (name.length === 0 || name.length > MAX_PRESET_NAME_LENGTH) {
		throw new StorageValidationError(
			`Preset name must be between 1 and ${MAX_PRESET_NAME_LENGTH} characters`,
		);
	}

	return name;
}

export function validateStackForWrite(stack: EffectStack): void {
	if (!Array.isArray(stack.instances)) {
		throw new StorageValidationError('EffectStack.instances must be an array');
	}

	if (stack.instances.length > MAX_STACK_INSTANCES) {
		throw new StorageValidationError(
			`EffectStack cannot exceed ${MAX_STACK_INSTANCES} instances`,
		);
	}
}

/**
 Returns `record` holding the given side A. An empty side A leaves no fields
 behind, so a project that never used it is stored as before.
 */
export function withSideA<
	Value extends {
		stackA?: EffectStack;
		selectedInstanceIdA?: string | null;
	},
>(
	record: Value,
	stackA: EffectStack | undefined,
	selectedInstanceIdA: string | null | undefined,
): Value {
	const next = {...record};
	if (!stackA || stackA.instances.length === 0) {
		delete next.stackA;
		delete next.selectedInstanceIdA;
		return next;
	}

	next.stackA = stackA;
	next.selectedInstanceIdA = selectedInstanceIdA ?? null;
	return next;
}

export function normalizeViewState(viewState: ViewState): ViewState {
	const zoom = Number.isFinite(viewState.zoom)
		? clamp(viewState.zoom, MIN_ZOOM, MAX_ZOOM)
		: 1;
	const splitPosition = Number.isFinite(viewState.splitPosition)
		? clamp(viewState.splitPosition, 0, 1)
		: DEFAULT_SPLIT_POSITION;
	const next: ViewState = {
		...viewState,
		zoom,
		splitPosition,
	};
	if (
		next.splitOrientation !== 'vertical' &&
		next.splitOrientation !== 'horizontal'
	) {
		delete next.splitOrientation;
	}

	if (next.editSide !== 'a' && next.editSide !== 'b') {
		delete next.editSide;
	}

	return next;
}

export function normalizeExportSettings(
	exportSettings: ExportSettings,
): ExportSettings {
	const quality = Number.isFinite(exportSettings.quality)
		? clamp(
				Math.round(exportSettings.quality),
				MIN_EXPORT_QUALITY,
				MAX_EXPORT_QUALITY,
			)
		: DEFAULT_EXPORT_QUALITY;
	const rawMaxSize = exportSettings.maxFileSizeKb;
	const maxFileSizeKb =
		typeof rawMaxSize === 'number' && Number.isFinite(rawMaxSize)
			? clamp(
					Math.round(rawMaxSize),
					MIN_EXPORT_MAX_FILE_SIZE_KB,
					MAX_EXPORT_MAX_FILE_SIZE_KB,
				)
			: null;
	return {
		...exportSettings,
		quality,
		maxFileSizeKb,
	};
}

export function validateImageDimensions(width: number, height: number): void {
	if (
		!Number.isSafeInteger(width) ||
		width < 1 ||
		width > 16_384 ||
		!Number.isSafeInteger(height) ||
		height < 1 ||
		height > 16_384
	) {
		throw new StorageValidationError(
			'Image dimensions must be integers in 1..16384',
		);
	}
}

export async function hashBlobSha256(blob: Blob): Promise<string> {
	const buffer = await blob.arrayBuffer();
	const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
	const bytes = new Uint8Array(digest);
	let hex = '';
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, '0');
	}

	return hex;
}

export function generateId(): string {
	return globalThis.crypto.randomUUID();
}

export function cloneRecord<T>(value: T): T {
	return structuredClone(value);
}
