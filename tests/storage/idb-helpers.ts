// Raw IndexedDB access, for records the repository would never write.

export function settle<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.addEventListener('success', () => {
			resolve(request.result);
		});
		request.addEventListener('error', () => {
			reject(request.error ?? new Error('IndexedDB request failed'));
		});
	});
}

export async function putRecords(
	database: IDBDatabase,
	storeName: string,
	records: readonly unknown[],
): Promise<void> {
	const transaction = database.transaction(storeName, 'readwrite');
	const store = transaction.objectStore(storeName);
	await Promise.all(records.map(async (record) => settle(store.put(record))));
}

export function allRecords<T>(
	database: IDBDatabase,
	storeName: string,
): Promise<T[]> {
	return settle(
		database.transaction(storeName).objectStore(storeName).getAll(),
	) as Promise<T[]>;
}
