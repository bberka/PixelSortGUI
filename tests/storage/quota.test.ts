import {describe, expect, it} from 'vite-plus/test';
import {
	checkQuotaForImport,
	formatByteSize,
	formatStorageUsage,
	getStorageEstimate,
	isStoragePersisted,
	requestPersistentStorage,
	type PersistenceOutcome,
	type StorageManagerLike,
} from '../../src/storage/quota.ts';

describe('quota helpers', () => {
	it('formats byte sizes and usage lines per persistence.md section 7.2', () => {
		expect(formatByteSize(0)).toBe('0 MB');
		expect(formatByteSize(42_000_000)).toBe('42 MB');
		expect(formatByteSize(512_400_000)).toBe('512 MB');
		expect(formatByteSize(1_200_000_000)).toBe('1.2 GB');
		expect(formatByteSize(24_540_000_000)).toBe('24.5 GB');

		expect(
			formatStorageUsage({
				usage: 42_000_000,
				quota: 512_000_000,
				available: 470_000_000,
			}),
		).toBe('Using 42 MB of 512 MB');
		expect(
			formatStorageUsage({usage: null, quota: null, available: null}),
		).toBe('Storage usage unavailable');
	});

	it('computes storage estimates safely without relying on usageDetails', async () => {
		const estimate = await getStorageEstimate({
			async estimate() {
				return {usage: 500, quota: 2000};
			},
		});
		expect(estimate).toEqual({usage: 500, quota: 2000, available: 1500});

		const unavailable = await getStorageEstimate(undefined);
		expect(unavailable).toEqual({usage: null, quota: null, available: null});
	});

	it('enforces the 15% headroom pre-flight check', async () => {
		const storage = {
			async estimate() {
				return {usage: 885, quota: 1000};
			},
		};

		const fits = await checkQuotaForImport(100, storage);
		expect(fits.ok).toBe(true);
		expect(fits.requiredBytes).toBeCloseTo(115);

		const tooTight = await checkQuotaForImport(101, storage);
		expect(tooTight.ok).toBe(false);

		const unknownQuota = await checkQuotaForImport(1_000_000, undefined);
		expect(unknownQuota.ok).toBe(true);
	});

	it('fires requestPersistentStorage without blocking even when persist() never settles', async () => {
		let settledValue: boolean | undefined;
		const hangingStorage = {
			persist() {
				return new Promise<boolean>(() => {
					// Simulates headless Firefox permission prompt staying pending.
				});
			},
			async persisted() {
				return false;
			},
		};

		requestPersistentStorage(hangingStorage, (value) => {
			settledValue = value;
		});
		expect(settledValue).toBeUndefined();
		expect(await isStoragePersisted(hangingStorage)).toBe(false);

		const grantedStorage = {
			async persist() {
				return true;
			},
			async persisted() {
				return true;
			},
		};
		const settled = await new Promise<boolean>((resolve) => {
			requestPersistentStorage(grantedStorage, resolve);
		});
		expect(settled).toBe(true);
	});

	const outcomeOf = async (storage: StorageManagerLike) =>
		new Promise<[boolean, PersistenceOutcome]>((resolve) => {
			requestPersistentStorage(storage, (persisted, outcome) => {
				resolve([persisted, outcome]);
			});
		});

	it.each<[string, StorageManagerLike, [boolean, PersistenceOutcome]]>([
		[
			'granted',
			{persist: async () => true, persisted: async () => true},
			[true, 'granted'],
		],
		[
			'denied',
			{persist: async () => false, persisted: async () => false},
			[false, 'denied'],
		],
		[
			'trusting persisted() over persist()',
			{persist: async () => true, persisted: async () => false},
			[false, 'denied'],
		],
		['unsupported', {}, [false, 'unsupported']],
		[
			'rejected',
			{
				async persist() {
					throw new Error('no');
				},
				persisted: async () => false,
			},
			[false, 'failed'],
		],
		[
			'throwing synchronously',
			{
				persist() {
					throw new TypeError('no');
				},
				persisted: async () => false,
			},
			[false, 'failed'],
		],
		[
			'rejected but already persisted',
			{
				async persist() {
					throw new Error('no');
				},
				persisted: async () => true,
			},
			[true, 'granted'],
		],
	])('reports a request that is %s', async (_name, storage, expected) => {
		expect(await outcomeOf(storage)).toEqual(expected);
	});
});
