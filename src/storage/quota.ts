import {QUOTA_HEADROOM_MULTIPLIER} from './types.ts';

export type StorageManagerLike = {
	estimate?: () => Promise<{usage?: number; quota?: number}>;
	persisted?: () => Promise<boolean>;
	persist?: () => Promise<boolean>;
};

export type PersistenceOutcome =
	'granted' | 'denied' | 'unsupported' | 'failed';

export type StorageQuotaEstimate = {
	usage: number | null;
	quota: number | null;
	available: number | null;
};

export type QuotaCheckResult = {
	ok: boolean;
	requiredBytes: number;
	estimate: StorageQuotaEstimate;
};

function getDefaultStorageManager(): StorageManagerLike | undefined {
	return globalThis.navigator === undefined
		? undefined
		: globalThis.navigator.storage;
}

function finiteNonNegative(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: null;
}

export async function getStorageEstimate(
	storage: StorageManagerLike | undefined = getDefaultStorageManager(),
): Promise<StorageQuotaEstimate> {
	if (!storage?.estimate) {
		return {usage: null, quota: null, available: null};
	}

	try {
		const raw = await storage.estimate();
		const usage = finiteNonNegative(raw.usage);
		const quota = finiteNonNegative(raw.quota);
		const available =
			usage !== null && quota !== null ? Math.max(0, quota - usage) : null;
		return {usage, quota, available};
	} catch {
		return {usage: null, quota: null, available: null};
	}
}

export function formatByteSize(bytes: number): string {
	const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
	if (safeBytes >= 1_000_000_000) {
		const gigabytes = safeBytes / 1_000_000_000;
		return `${gigabytes.toFixed(1)} GB`;
	}

	const megabytes = Math.round(safeBytes / 1_000_000);
	return `${megabytes} MB`;
}

export function formatStorageUsage(estimate: StorageQuotaEstimate): string {
	return estimate.usage === null || estimate.quota === null
		? 'Storage usage unavailable'
		: `Using ${formatByteSize(estimate.usage)} of ${formatByteSize(estimate.quota)}`;
}

export async function checkQuotaForImport(
	incomingBytes: number,
	storage: StorageManagerLike | undefined = getDefaultStorageManager(),
): Promise<QuotaCheckResult> {
	const safeIncoming =
		Number.isFinite(incomingBytes) && incomingBytes > 0 ? incomingBytes : 0;
	const requiredBytes = safeIncoming * QUOTA_HEADROOM_MULTIPLIER;
	const estimate = await getStorageEstimate(storage);

	if (estimate.usage === null || estimate.quota === null) {
		return {ok: true, requiredBytes, estimate};
	}

	const remaining = estimate.quota - estimate.usage;
	return {
		ok: remaining >= requiredBytes,
		requiredBytes,
		estimate,
	};
}

export async function isStoragePersisted(
	storage: StorageManagerLike | undefined = getDefaultStorageManager(),
): Promise<boolean> {
	if (!storage?.persisted) {
		return false;
	}

	try {
		return Boolean(await storage.persisted());
	} catch {
		return false;
	}
}

/**
 Requests persistent storage without blocking the caller.
 In Firefox, `navigator.storage.persist()` stays pending until the user answers
 the browser permission prompt, so callers on import or startup paths must never
 await it.
 */
export function requestPersistentStorage(
	storage: StorageManagerLike | undefined = getDefaultStorageManager(),
	onSettled?: (persisted: boolean, outcome: PersistenceOutcome) => void,
): void {
	if (!storage?.persist) {
		onSettled?.(false, 'unsupported');
		return;
	}

	void (async () => {
		let refusal: PersistenceOutcome = 'denied';
		try {
			await storage.persist?.();
		} catch {
			refusal = 'failed';
		}

		const persisted = await isStoragePersisted(storage);
		onSettled?.(persisted, persisted ? 'granted' : refusal);
	})();
}
