import {expect, test, type Page} from '@playwright/test';

test('keeps a multi-megabyte version 1 project through the upgrade on reload in real IndexedDB', async ({
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
			const request = idb.open('drift');
			request.addEventListener('success', () => resolve(request.result));
			request.addEventListener('error', () =>
				reject(request.error ?? new Error('Open failed')),
			);
		});

		const record = await new Promise<{
			project:
				| {
						id: string;
						name: string;
						sourceHash: string;
						effectiveWidth: number;
						effectiveHeight: number;
				  }
				| undefined;
			source: {sha256: string; blob: Blob; byteLength: number} | undefined;
			historyCount: number;
		}>((resolve, reject) => {
			const tx = db.transaction(['projects', 'sources', 'history'], 'readonly');
			const projectReq = tx
				.objectStore('projects')
				.get(expectedProjectId) as IDBRequest<
				| {
						id: string;
						name: string;
						sourceHash: string;
						effectiveWidth: number;
						effectiveHeight: number;
				  }
				| undefined
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

		const {version} = db;
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
			version,
			effectiveSize: [
				record.project?.effectiveWidth,
				record.project?.effectiveHeight,
			],
			projectName: record.project?.name,
			byteLength: record.source.blob.size,
			storedHash: record.source.sha256,
			computedHash,
			historyCount: record.historyCount,
		};
	}, written.projectId);

	expect(verified).toEqual({
		found: true,
		version: 3,
		effectiveSize: [2048, 1536],
		projectName: 'Large E2E Blob',
		byteLength: written.byteLength,
		storedHash: written.sha256,
		computedHash: written.sha256,
		historyCount: 1,
	});
	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});

// What the version 2 database of the next test holds, read back raw.
async function readDrift(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = globalThis.indexedDB.open('drift');
			request.addEventListener('success', () => resolve(request.result));
			request.addEventListener('error', () =>
				reject(request.error ?? new Error('Open failed')),
			);
		});
		const all = <T>(store: string) =>
			new Promise<T[]>((resolve, reject) => {
				const request = db.transaction(store).objectStore(store).getAll();
				request.addEventListener('success', () =>
					resolve(request.result as T[]),
				);
				request.addEventListener('error', () =>
					reject(request.error ?? new Error('Read failed')),
				);
			});
		const hex = async (blob: Blob) =>
			Array.from(
				new Uint8Array(
					await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
				),
				(byte) => byte.toString(16).padStart(2, '0'),
			).join('');

		const sources = await all<{sha256: string; blob: Blob}>('sources');
		const thumbnails = await all<{blob: Blob}>('thumbnails');
		const projects = db.transaction('projects').objectStore('projects');
		const result = {
			version: db.version,
			indexes: [...projects.indexNames],
			// Only sources whose bytes still match their hash.
			sources: (
				await Promise.all(
					sources.map(async ({sha256, blob}) =>
						(await hex(blob)) === sha256 ? sha256 : 'damaged',
					),
				)
			).toSorted(),
			projects: await all<Record<string, unknown>>('projects'),
			history: await all<Record<string, unknown>>('history'),
			thumbnails: await Promise.all(
				thumbnails.map(async ({blob, ...rest}) => ({
					...rest,
					hash: await hex(blob),
				})),
			),
			presets: await all<Record<string, unknown>>('presets'),
			appState: (await all<{key: string}>('meta')).find(
				(record) => record.key === 'appState',
			),
		};
		db.close();
		return result;
	});
}

test('upgrades a version 2 database on reload and keeps every image in use until its last project goes', async ({
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

	const hashes = await page.evaluate(async () => {
		const idb = globalThis.indexedDB;
		await new Promise<void>((resolve, reject) => {
			const del = idb.deleteDatabase('drift');
			del.addEventListener('success', () => resolve());
			del.addEventListener('error', () =>
				reject(del.error ?? new Error('Delete failed')),
			);
		});

		// The stores and indexes version 2 had.
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = idb.open('drift', 2);
			request.addEventListener('upgradeneeded', () => {
				const database = request.result;
				database
					.createObjectStore('sources', {keyPath: 'sha256'})
					.createIndex('byCreatedAt', 'createdAt');
				const projects = database.createObjectStore('projects', {
					keyPath: 'id',
				});
				projects.createIndex('byOpenedAt', 'openedAt');
				projects.createIndex('bySourceHash', 'sourceHash');
				database.createObjectStore('thumbnails', {keyPath: 'projectId'});
				database
					.createObjectStore('history', {keyPath: ['projectId', 'seq']})
					.createIndex('byProjectId', 'projectId');
				database
					.createObjectStore('presets', {keyPath: 'id'})
					.createIndex('byNameLower', 'nameLower');
				database.createObjectStore('meta', {keyPath: 'key'});
			});
			request.addEventListener('success', () => resolve(request.result));
			request.addEventListener('error', () =>
				reject(request.error ?? new Error('Open failed')),
			);
		});

		const image = async (seed: number) => {
			const bytes = new Uint8Array(512 * 1024);
			for (let at = 0; at < bytes.length; at++) {
				bytes[at] = (at * 31 + seed * 7) % 256;
			}

			const digest = await crypto.subtle.digest('SHA-256', bytes);
			const sha256 = Array.from(new Uint8Array(digest), (byte) =>
				byte.toString(16).padStart(2, '0'),
			).join('');
			return {
				sha256,
				blob: new Blob([bytes], {type: 'image/png'}),
				mimeType: 'image/png',
				byteLength: bytes.length,
				width: 400,
				height: 300,
				createdAt: seed,
			};
		};

		const [primary, current, shared, undoOnly, other, orphan] =
			await Promise.all([1, 2, 3, 4, 5, 6].map(async (seed) => image(seed)));

		const canvas = new globalThis.OffscreenCanvas(40, 30);
		canvas.getContext('2d')!.fillRect(0, 0, 20, 30);
		const thumbnail = await canvas.convertToBlob({type: 'image/png'});

		const empty = {schemaVersion: 1, instances: []};
		const blend = (id: string, sha256: string) => ({
			schemaVersion: 1,
			instances: [
				{
					id,
					type: 'imageBlend',
					version: 1,
					enabled: true,
					params: {image: sha256},
					mix: 1,
					blend: 'normal',
				},
			],
		});
		const transform = {
			rotation: 90,
			flipX: true,
			flipY: false,
			crop: null,
			resize: null,
		};
		const project = (
			id: string,
			sourceHash: string,
			overrides: Record<string, unknown>,
		) => ({
			id,
			name: id,
			sourceHash,
			sourceWidth: 400,
			sourceHeight: 300,
			transform,
			effectiveWidth: 300,
			effectiveHeight: 400,
			stack: empty,
			selectedInstanceId: null,
			historyHeadSeq: 0,
			historyMinSeq: 0,
			historyMaxSeq: 0,
			viewState: {
				fitMode: 'fit',
				zoom: 1,
				centerX: 150,
				centerY: 200,
				splitPosition: 0.3,
			},
			exportSettings: {
				format: 'png',
				quality: 92,
				sizeMode: 'full',
				customLongestSide: null,
			},
			createdAt: 1,
			updatedAt: 2,
			openedAt: 3,
			...overrides,
		});
		const entry = (
			projectId: string,
			seq: number,
			stack: unknown,
			overrides: Record<string, unknown> = {},
		) => ({
			projectId,
			seq,
			label: seq === 0 ? 'Initial' : 'Change',
			stack,
			selectedInstanceId: null,
			transform,
			createdAt: 10 + seq,
			...overrides,
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction([...db.objectStoreNames], 'readwrite');
			for (const source of [
				primary,
				current,
				shared,
				undoOnly,
				other,
				orphan,
			]) {
				tx.objectStore('sources').put(source);
			}

			tx.objectStore('projects').put(
				project('Blended', primary.sha256, {
					stack: blend('b', current.sha256),
					stackA: blend('a', shared.sha256),
					selectedInstanceIdA: 'a',
					historyHeadSeq: 1,
					historyMaxSeq: 1,
				}),
			);
			tx.objectStore('projects').put(
				project('Keeper', other.sha256, {
					stack: blend('k', shared.sha256),
				}),
			);
			const history = tx.objectStore('history');
			history.put(entry('Blended', 0, blend('u', undoOnly.sha256)));
			history.put(
				entry('Blended', 1, blend('b', current.sha256), {
					stackA: blend('a', shared.sha256),
					selectedInstanceIdA: 'a',
				}),
			);
			history.put(entry('Keeper', 0, blend('k', shared.sha256)));
			tx.objectStore('thumbnails').put({
				projectId: 'Blended',
				blob: thumbnail,
				width: 40,
				height: 30,
				stackSignature: 'v2',
				updatedAt: 4,
			});
			tx.objectStore('presets').put({
				id: 'user:v2',
				name: 'Mine',
				nameLower: 'mine',
				stack: empty,
				createdAt: 5,
				updatedAt: 5,
			});
			tx.objectStore('meta').put({
				key: 'appState',
				activeProjectId: null,
				theme: 'dark',
				compareMode: 'split',
				welcomeDismissed: true,
			});
			tx.addEventListener('complete', () => resolve());
			tx.addEventListener('abort', () =>
				reject(tx.error ?? new Error('Transaction aborted')),
			);
		});
		db.close();

		return {
			primary: primary.sha256,
			current: current.sha256,
			shared: shared.sha256,
			undoOnly: undoOnly.sha256,
			other: other.sha256,
			orphan: orphan.sha256,
		};
	});

	const before = await readDrift(page);
	expect(before.version).toBe(2);

	await page.reload();
	await expect(page.getByRole('button', {name: 'Open Blended'})).toBeVisible();

	// The startup cleanup has run once the unused image is gone.
	await expect
		.poll(async () => (await readDrift(page)).sources)
		.not.toContain(hashes.orphan);
	const after = await readDrift(page);

	const {orphan, ...used} = hashes;
	expect(after.version).toBe(3);
	expect(after.indexes).toContain('byReferencedSourceHash');
	expect(after.sources).toEqual(Object.values(used).toSorted());
	expect(after.history).toEqual(before.history);
	expect(after.thumbnails).toEqual(before.thumbnails);
	expect(after.presets).toEqual(before.presets);
	expect(after.appState).toEqual(before.appState);
	const references: Record<string, string[]> = {
		Blended: [
			hashes.primary,
			hashes.current,
			hashes.shared,
			hashes.undoOnly,
		].toSorted(),
		Keeper: [hashes.other, hashes.shared].toSorted(),
	};
	expect(after.projects).toEqual(
		before.projects.map((record) => ({
			...record,
			referencedSourceHashes: references[record.id as string],
		})),
	);

	await page.getByRole('button', {name: 'Actions for Blended'}).click();
	await page.getByRole('menuitem', {name: 'Delete'}).click();
	await page
		.getByRole('alertdialog')
		.getByRole('button', {name: 'Delete'})
		.click();
	await expect(page.getByRole('button', {name: 'Open Blended'})).toHaveCount(0);

	await expect
		.poll(async () => (await readDrift(page)).sources)
		.toEqual([hashes.other, hashes.shared].toSorted());
	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
