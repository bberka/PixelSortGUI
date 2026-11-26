import {expect, test} from '@playwright/test';

test('persists a multi-megabyte project blob across page reload in real IndexedDB', async ({
	page,
}) => {
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];

	page.on('console', (message) => {
		if (message.type() === 'error') {
			consoleErrors.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		pageErrors.push(error.message);
	});

	await page.goto('/');

	const written = await page.evaluate(async () => {
		const dbName = 'drift';
		const idb = globalThis.indexedDB;
		await new Promise<void>((resolve, reject) => {
			const del = idb.deleteDatabase(dbName);
			del.addEventListener('success', () => resolve());
			del.addEventListener('error', () =>
				reject(del.error ?? new Error('Delete failed')),
			);
		});

		const openDb = () =>
			new Promise<IDBDatabase>((resolve, reject) => {
				const request = idb.open(dbName, 1);
				request.addEventListener('upgradeneeded', () => {
					const db = request.result;
					const sources = db.createObjectStore('sources', {keyPath: 'sha256'});
					sources.createIndex('byCreatedAt', 'createdAt');
					const projects = db.createObjectStore('projects', {keyPath: 'id'});
					projects.createIndex('byOpenedAt', 'openedAt');
					projects.createIndex('bySourceHash', 'sourceHash');
					db.createObjectStore('thumbnails', {keyPath: 'projectId'});
					const history = db.createObjectStore('history', {
						keyPath: ['projectId', 'seq'],
					});
					history.createIndex('byProjectId', 'projectId');
					const presets = db.createObjectStore('presets', {keyPath: 'id'});
					presets.createIndex('byNameLower', 'nameLower');
					db.createObjectStore('meta', {keyPath: 'key'});
				});
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () =>
					reject(request.error ?? new Error('Open failed')),
				);
			});

		const byteLength = 3 * 1024 * 1024;
		const bytes = new Uint8Array(byteLength);
		for (let i = 0; i < byteLength; i++) {
			bytes[i] = (i * 37 + Math.floor(i / 251) * 13 + 7) % 256;
		}

		const blob = new Blob([bytes], {type: 'image/png'});
		const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
		const sha256 = [...new Uint8Array(digest)]
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		const projectId = crypto.randomUUID();
		const now = Date.now();
		const db = await openDb();

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(
				['sources', 'projects', 'history', 'meta'],
				'readwrite',
			);
			tx.objectStore('sources').put({
				sha256,
				blob,
				mimeType: 'image/png',
				byteLength,
				width: 2048,
				height: 1536,
				createdAt: now,
			});
			tx.objectStore('projects').put({
				id: projectId,
				name: 'Large E2E Blob',
				sourceHash: sha256,
				sourceWidth: 2048,
				sourceHeight: 1536,
				stack: {schemaVersion: 1, instances: []},
				selectedInstanceId: null,
				historyHeadSeq: 0,
				historyMinSeq: 0,
				historyMaxSeq: 0,
				viewState: {
					fitMode: 'fit',
					zoom: 1,
					centerX: 1024,
					centerY: 768,
					splitPosition: 0.5,
				},
				exportSettings: {
					format: 'png',
					quality: 92,
					sizeMode: 'full',
					customLongestSide: null,
				},
				createdAt: now,
				updatedAt: now,
				openedAt: now,
			});
			tx.objectStore('history').put({
				projectId,
				seq: 0,
				label: 'Initial',
				stack: {schemaVersion: 1, instances: []},
				selectedInstanceId: null,
				createdAt: now,
			});
			tx.objectStore('meta').put({
				key: 'appState',
				activeProjectId: projectId,
				theme: 'system',
				compareMode: 'toggle',
			});
			tx.addEventListener('complete', () => resolve());
			tx.addEventListener('abort', () =>
				reject(tx.error ?? new Error('Transaction aborted')),
			);
			tx.addEventListener('error', () =>
				reject(tx.error ?? new Error('Transaction error')),
			);
		});

		db.close();
		return {projectId, sha256, byteLength};
	});

	await page.reload();

	const verified = await page.evaluate(async (expectedProjectId) => {
		const idb = globalThis.indexedDB;
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = idb.open('drift', 1);
			request.addEventListener('success', () => resolve(request.result));
			request.addEventListener('error', () =>
				reject(request.error ?? new Error('Open failed')),
			);
		});

		const record = await new Promise<{
			project: {id: string; name: string; sourceHash: string} | undefined;
			source: {sha256: string; blob: Blob; byteLength: number} | undefined;
			historyCount: number;
		}>((resolve, reject) => {
			const tx = db.transaction(['projects', 'sources', 'history'], 'readonly');
			const projectReq = tx
				.objectStore('projects')
				.get(expectedProjectId) as IDBRequest<
				{id: string; name: string; sourceHash: string} | undefined
			>;
			const historyReq = tx
				.objectStore('history')
				.index('byProjectId')
				.count(expectedProjectId);

			let sourceReq:
				| IDBRequest<
						{sha256: string; blob: Blob; byteLength: number} | undefined
				  >
				| undefined;

			projectReq.addEventListener('success', () => {
				const project = projectReq.result;
				if (project) {
					sourceReq = tx
						.objectStore('sources')
						.get(project.sourceHash) as IDBRequest<
						{sha256: string; blob: Blob; byteLength: number} | undefined
					>;
				}
			});

			tx.addEventListener('complete', () => {
				resolve({
					project: projectReq.result,
					source: sourceReq?.result,
					historyCount: historyReq.result,
				});
			});
			tx.addEventListener('error', () =>
				reject(tx.error ?? new Error('Read transaction error')),
			);
		});

		db.close();

		if (!record.source) {
			return {found: false};
		}

		const buffer = await record.source.blob.arrayBuffer();
		const digest = await crypto.subtle.digest('SHA-256', buffer);
		const computedHash = [...new Uint8Array(digest)]
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		await new Promise<void>((resolve, reject) => {
			const del = idb.deleteDatabase('drift');
			del.addEventListener('success', () => resolve());
			del.addEventListener('error', () =>
				reject(del.error ?? new Error('Cleanup delete failed')),
			);
		});

		return {
			found: true,
			projectName: record.project?.name,
			byteLength: record.source.blob.size,
			storedHash: record.source.sha256,
			computedHash,
			historyCount: record.historyCount,
		};
	}, written.projectId);

	expect(verified).toEqual({
		found: true,
		projectName: 'Large E2E Blob',
		byteLength: written.byteLength,
		storedHash: written.sha256,
		computedHash: written.sha256,
		historyCount: 1,
	});
	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
