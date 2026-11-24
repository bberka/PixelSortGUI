import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {chromium, firefox, type BrowserType, type Page} from '@playwright/test';

const publicDir = path.resolve(import.meta.dirname, './public');

type BrowserName = 'chromium' | 'firefox';

type BlobRoundTripEntry = {
	label: string;
	bytes: number;
	storageKind: 'Blob' | 'ArrayBuffer';
	writeMs: number;
	readMs: number;
	hashMatch: boolean;
};

type Question1Result = {
	pass: boolean;
	entries: BlobRoundTripEntry[];
	historyCount: number;
	historyWriteMs: number;
	historyReadMs: number;
	historyHashMatch: boolean;
};

type Question2Result = {
	pass: boolean;
	abortRolledBack: boolean;
	killState: 'previous-intact' | 'new-committed-atomically' | 'corrupted';
	killDetails: string;
};

type Question3Result = {
	pass: boolean;
	estimate: {
		usage: number | null;
		quota: number | null;
		usageDetails: Record<string, number> | null;
	};
	persistedBefore: boolean | null;
	persistResult: boolean | 'timeout' | null;
	persistedAfter: boolean | null;
	quotaTestMode: 'cdp-override' | 'unavailable-in-automation';
	quotaErrorName: string | null;
	quotaErrorCaught: boolean;
	earlierDataIntact: boolean;
	notes: string;
};

type Question4Result = {
	pass: boolean;
	contextKind: string;
	idbAvailable: boolean;
	writeReadWorked: boolean;
	estimate: {
		usage: number | null;
		quota: number | null;
	};
	persisted: boolean | null;
	persistResult: boolean | 'timeout' | null;
	fallbackTriggeredOnError: boolean;
	notes: string;
};

type Question5Result = {
	pass: boolean;
	swRegistered: boolean;
	offlineReloadLoaded: boolean;
	idbSurvivedOffline: boolean;
	hashMatch: boolean;
};

type Question6Result = {
	pass: boolean;
	v1ToV2Migrated: boolean;
	oldDataSurvived: boolean;
	newStoreCreated: boolean;
	recordTransformed: boolean;
	downgradeErrorName: string | null;
	v2IntactAfterDowngradeAttempt: boolean;
};

type BrowserReport = {
	browser: BrowserName;
	version: string;
	q1: Question1Result;
	q2: Question2Result;
	q3: Question3Result;
	q4: Question4Result;
	q5: Question5Result;
	q6: Question6Result;
};

async function startStaticServer(): Promise<{
	server: http.Server;
	url: string;
}> {
	const server = http.createServer(async (request, response) => {
		const rawPath = (request.url || '/').split('?', 1)[0] || '/';
		const fileName =
			rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
		const filePath = path.resolve(publicDir, fileName);

		if (!filePath.startsWith(publicDir)) {
			response.writeHead(403);
			response.end('Forbidden');
			return;
		}

		try {
			const content = await fs.readFile(filePath);
			const contentType = filePath.endsWith('.js')
				? 'application/javascript; charset=utf-8'
				: 'text/html; charset=utf-8';
			response.writeHead(200, {'Content-Type': contentType});
			response.end(content);
		} catch {
			response.writeHead(404);
			response.end('Not found');
		}
	});

	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve());
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Failed to bind spike static server');
	}

	return {
		server,
		url: `http://localhost:${address.port}`,
	};
}

async function createTempProfile(prefix: string): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), `psg-s3-${prefix}-`));
}

async function removeTempProfile(dir: string): Promise<void> {
	await fs.rm(dir, {recursive: true, force: true});
}

async function runQuestion1(
	browserType: BrowserType,
	browserName: BrowserName,
	baseUrl: string,
): Promise<Question1Result> {
	const profileDir = await createTempProfile(`${browserName}-q1`);
	const sizes = [
		{label: '5 MB', bytes: 5 * 1024 * 1024},
		{label: '20 MB', bytes: 20 * 1024 * 1024},
		{label: '50 MB (50 MP source)', bytes: 50 * 1024 * 1024},
	];

	try {
		const context1 = await browserType.launchPersistentContext(profileDir, {
			headless: true,
		});
		const page1 = await context1.newPage();
		await page1.goto(baseUrl, {waitUntil: 'load'});

		const writeResult = await page1.evaluate(async (testSizes) => {
			const dbName = 'pixelsortgui';

			const openDb = () =>
				new Promise<IDBDatabase>((resolve, reject) => {
					const request = globalThis.indexedDB.open(dbName, 1);
					request.addEventListener('upgradeneeded', () => {
						const db = request.result;
						const sources = db.createObjectStore('sources', {
							keyPath: 'sha256',
						});
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
						reject(request.error ?? new Error('IDB open failed')),
					);
				});

			const makeBytes = (length: number) => {
				const buffer = new Uint8Array(length);
				const chunkSize = 65_536;
				for (let offset = 0; offset < length; offset += chunkSize) {
					const end = Math.min(offset + chunkSize, length);
					globalThis.crypto.getRandomValues(buffer.subarray(offset, end));
				}

				return buffer;
			};

			const sha256Hex = async (data: BufferSource) => {
				const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
				return Array.from(new Uint8Array(digest), (byte) =>
					byte.toString(16).padStart(2, '0'),
				).join('');
			};

			const db = await openDb();
			const written: Array<{
				label: string;
				bytes: number;
				storageKind: 'Blob' | 'ArrayBuffer';
				key: string;
				expectedHash: string;
				writeMs: number;
			}> = [];

			for (const spec of testSizes) {
				const raw = makeBytes(spec.bytes);
				const expectedHash = await sha256Hex(raw);

				for (const storageKind of ['Blob', 'ArrayBuffer'] as const) {
					const key = `${expectedHash}:${storageKind}`;
					const payload =
						storageKind === 'Blob'
							? new Blob([raw], {type: 'application/octet-stream'})
							: raw.slice().buffer;

					const start = performance.now();
					await new Promise<void>((resolve, reject) => {
						const tx = db.transaction('sources', 'readwrite');
						tx.objectStore('sources').put({
							sha256: key,
							blob: payload,
							mimeType: 'image/jpeg',
							byteLength: spec.bytes,
							width: 8192,
							height: 6144,
							createdAt: Date.now(),
						});
						tx.addEventListener('complete', () => resolve());
						tx.addEventListener('error', () =>
							reject(tx.error ?? new Error('IDB tx error')),
						);
						tx.addEventListener('abort', () =>
							reject(tx.error ?? new Error('IDB tx aborted')),
						);
					});
					const writeMs = Math.round((performance.now() - start) * 100) / 100;
					written.push({
						label: spec.label,
						bytes: spec.bytes,
						storageKind,
						key,
						expectedHash,
						writeMs,
					});
				}
			}

			const projectId = '00000000-0000-4000-8000-000000000001';
			const projectRecord = {
				id: projectId,
				name: 'Spike S3 Test Project',
				sourceHash: written[0].key,
				sourceWidth: 8192,
				sourceHeight: 6144,
				stack: {
					schemaVersion: 1,
					instances: [
						{
							id: 'inst-1',
							type: 'pixelSort',
							version: 1,
							enabled: true,
							mix: 100,
							blend: 'normal',
							params: {angle: 90, thresholdLow: 0.2, thresholdHigh: 0.8},
						},
					],
				},
				selectedInstanceId: 'inst-1',
				historyHeadSeq: 199,
				historyMinSeq: 0,
				historyMaxSeq: 199,
				viewState: {
					fitMode: 'custom',
					zoom: 2,
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
				createdAt: 1_700_000_000_000,
				updatedAt: 1_700_000_001_000,
				openedAt: 1_700_000_002_000,
			};

			const historyEntries = Array.from({length: 200}, (_, seq) => ({
				projectId,
				seq,
				label: seq === 0 ? 'Initial' : `Change Angle #${seq}`,
				stack: {
					schemaVersion: 1,
					instances: [
						{
							id: 'inst-1',
							type: 'pixelSort',
							version: 1,
							enabled: true,
							mix: 100,
							blend: 'normal',
							params: {angle: seq % 360, thresholdLow: 0.2, thresholdHigh: 0.8},
						},
					],
				},
				selectedInstanceId: 'inst-1',
				createdAt: 1_700_000_000_000 + seq * 1000,
			}));

			const expectedHistoryHash = await sha256Hex(
				new TextEncoder().encode(
					JSON.stringify({projectRecord, historyEntries}),
				),
			);

			const histStart = performance.now();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(['projects', 'history', 'meta'], 'readwrite');
				tx.objectStore('projects').put(projectRecord);
				const historyStore = tx.objectStore('history');
				for (const entry of historyEntries) {
					historyStore.put(entry);
				}

				tx.objectStore('meta').put({
					key: 'appState',
					activeProjectId: projectId,
					theme: 'dark',
					compareMode: 'split',
				});
				tx.addEventListener('complete', () => resolve());
				tx.addEventListener('error', () =>
					reject(tx.error ?? new Error('IDB tx error')),
				);
				tx.addEventListener('abort', () =>
					reject(tx.error ?? new Error('IDB tx aborted')),
				);
			});
			const historyWriteMs =
				Math.round((performance.now() - histStart) * 100) / 100;

			db.close();
			return {written, expectedHistoryHash, historyWriteMs, projectId};
		}, sizes);

		await context1.close();

		const context2 = await browserType.launchPersistentContext(profileDir, {
			headless: true,
		});
		const page2 = await context2.newPage();
		await page2.goto(baseUrl, {waitUntil: 'load'});

		const readResult = await page2.evaluate(async (input) => {
			const openDb = () =>
				new Promise<IDBDatabase>((resolve, reject) => {
					const request = globalThis.indexedDB.open('pixelsortgui', 1);
					request.addEventListener('success', () => resolve(request.result));
					request.addEventListener('error', () =>
						reject(request.error ?? new Error('IDB open failed')),
					);
				});

			const sha256Hex = async (data: BufferSource) => {
				const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
				return Array.from(new Uint8Array(digest), (byte) =>
					byte.toString(16).padStart(2, '0'),
				).join('');
			};

			const db = await openDb();
			const entries: Array<{
				label: string;
				bytes: number;
				storageKind: 'Blob' | 'ArrayBuffer';
				writeMs: number;
				readMs: number;
				hashMatch: boolean;
			}> = [];

			for (const item of input.written) {
				const start = performance.now();
				const record = await new Promise<{blob: Blob | ArrayBuffer}>(
					(resolve, reject) => {
						const tx = db.transaction('sources', 'readonly');
						const req = tx.objectStore('sources').get(item.key);
						req.addEventListener('success', () =>
							resolve(req.result as {blob: Blob | ArrayBuffer}),
						);
						req.addEventListener('error', () =>
							reject(req.error ?? new Error('IDB get failed')),
						);
					},
				);
				const arrayBuffer =
					record.blob instanceof Blob
						? await record.blob.arrayBuffer()
						: record.blob;
				const readMs = Math.round((performance.now() - start) * 100) / 100;
				const actualHash = await sha256Hex(arrayBuffer);
				entries.push({
					label: item.label,
					bytes: item.bytes,
					storageKind: item.storageKind,
					writeMs: item.writeMs,
					readMs,
					hashMatch: actualHash === item.expectedHash,
				});
			}

			const histStart = performance.now();
			const {projectRecord, historyEntries} = await new Promise<{
				projectRecord: unknown;
				historyEntries: unknown[];
			}>((resolve, reject) => {
				const tx = db.transaction(['projects', 'history'], 'readonly');
				const projectReq = tx.objectStore('projects').get(input.projectId);
				const historyReq = tx
					.objectStore('history')
					.index('byProjectId')
					.getAll(input.projectId);
				tx.addEventListener('complete', () =>
					resolve({
						projectRecord: projectReq.result,
						historyEntries: historyReq.result as unknown[],
					}),
				);
				tx.addEventListener('error', () =>
					reject(tx.error ?? new Error('IDB tx error')),
				);
			});
			const historyReadMs =
				Math.round((performance.now() - histStart) * 100) / 100;

			const actualHistoryHash = await sha256Hex(
				new TextEncoder().encode(
					JSON.stringify({projectRecord, historyEntries}),
				),
			);

			db.close();
			return {
				entries,
				historyCount: historyEntries.length,
				historyReadMs,
				historyHashMatch: actualHistoryHash === input.expectedHistoryHash,
			};
		}, writeResult);

		await context2.close();

		const allMatch =
			readResult.entries.every((entry) => entry.hashMatch) &&
			readResult.historyHashMatch &&
			readResult.historyCount === 200;

		return {
			pass: allMatch,
			entries: readResult.entries,
			historyCount: readResult.historyCount,
			historyWriteMs: writeResult.historyWriteMs,
			historyReadMs: readResult.historyReadMs,
			historyHashMatch: readResult.historyHashMatch,
		};
	} finally {
		await removeTempProfile(profileDir);
	}
}

async function runQuestion2(
	browserType: BrowserType,
	browserName: BrowserName,
	baseUrl: string,
): Promise<Question2Result> {
	const profileDir = await createTempProfile(`${browserName}-q2`);

	try {
		const context1 = await browserType.launchPersistentContext(profileDir, {
			headless: true,
		});
		const page1 = await context1.newPage();
		await page1.goto(baseUrl, {waitUntil: 'load'});

		const abortRolledBack = await page1.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = globalThis.indexedDB.open('pixelsortgui-tx', 1);
				req.addEventListener('upgradeneeded', () => {
					const database = req.result;
					database.createObjectStore('sources', {keyPath: 'sha256'});
					database.createObjectStore('projects', {keyPath: 'id'});
					database.createObjectStore('history', {
						keyPath: ['projectId', 'seq'],
					});
				});
				req.addEventListener('success', () => resolve(req.result));
				req.addEventListener('error', () =>
					reject(req.error ?? new Error('IDB open failed')),
				);
			});

			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(
					['sources', 'projects', 'history'],
					'readwrite',
				);
				tx.objectStore('sources').put({
					sha256: 'src-0',
					blob: new Blob([new Uint8Array(1024)]),
				});
				tx.objectStore('projects').put({
					id: 'p1',
					sourceHash: 'src-0',
					historyMaxSeq: 0,
				});
				tx.objectStore('history').put({
					projectId: 'p1',
					seq: 0,
					label: 'Initial',
				});
				tx.addEventListener('complete', () => resolve());
				tx.addEventListener('error', () =>
					reject(tx.error ?? new Error('IDB tx error')),
				);
			});

			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(['projects', 'history'], 'readwrite');
				tx.objectStore('projects').put({
					id: 'p1',
					sourceHash: 'src-0',
					historyMaxSeq: 1,
				});
				tx.objectStore('history').put({
					projectId: 'p1',
					seq: 1,
					label: 'Should Roll Back',
				});
				tx.abort();
				tx.addEventListener('abort', () => resolve());
				tx.addEventListener('complete', () =>
					reject(new Error('Transaction did not abort')),
				);
			});

			const after = await new Promise<{
				project: {historyMaxSeq: number};
				historyCount: number;
			}>((resolve, reject) => {
				const tx = db.transaction(['projects', 'history'], 'readonly');
				const pReq = tx.objectStore('projects').get('p1');
				const hReq = tx.objectStore('history').getAll();
				tx.addEventListener('complete', () =>
					resolve({
						project: pReq.result as {historyMaxSeq: number},
						historyCount: (hReq.result as unknown[]).length,
					}),
				);
				tx.addEventListener('error', () =>
					reject(tx.error ?? new Error('IDB tx error')),
				);
			});

			db.close();
			return after.project.historyMaxSeq === 0 && after.historyCount === 1;
		});

		await page1.evaluate(() => {
			const req = globalThis.indexedDB.open('pixelsortgui-tx', 1);
			req.addEventListener('success', () => {
				const db = req.result;
				const big = new Uint8Array(40 * 1024 * 1024);
				big.fill(42);
				const tx = db.transaction(
					['sources', 'projects', 'history'],
					'readwrite',
				);
				tx.objectStore('sources').put({
					sha256: 'src-1',
					blob: new Blob([big]),
				});
				tx.objectStore('projects').put({
					id: 'p1',
					sourceHash: 'src-1',
					historyMaxSeq: 2,
				});
				tx.objectStore('history').put({
					projectId: 'p1',
					seq: 1,
					label: 'Mid-kill 1',
				});
				tx.objectStore('history').put({
					projectId: 'p1',
					seq: 2,
					label: 'Mid-kill 2',
				});
			});
		});

		await page1.close({runBeforeUnload: false});
		await context1.close();

		const context2 = await browserType.launchPersistentContext(profileDir, {
			headless: true,
		});
		const page2 = await context2.newPage();
		await page2.goto(baseUrl, {waitUntil: 'load'});

		const afterKill = await page2.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = globalThis.indexedDB.open('pixelsortgui-tx', 1);
				req.addEventListener('success', () => resolve(req.result));
				req.addEventListener('error', () =>
					reject(req.error ?? new Error('IDB open failed')),
				);
			});

			const state = await new Promise<{
				project: {sourceHash: string; historyMaxSeq: number};
				historyCount: number;
				sourceExists: boolean;
			}>((resolve, reject) => {
				const tx = db.transaction(
					['sources', 'projects', 'history'],
					'readonly',
				);
				const pReq = tx.objectStore('projects').get('p1');
				const hReq = tx.objectStore('history').getAll();
				const sReq = tx.objectStore('sources').getAllKeys();
				tx.addEventListener('complete', () => {
					const project = pReq.result as {
						sourceHash: string;
						historyMaxSeq: number;
					};
					const sourceKeys = sReq.result as string[];
					resolve({
						project,
						historyCount: (hReq.result as unknown[]).length,
						sourceExists: sourceKeys.includes(project.sourceHash),
					});
				});
				tx.addEventListener('error', () =>
					reject(tx.error ?? new Error('IDB tx error')),
				);
			});

			db.close();
			return state;
		});

		await context2.close();

		let killState: Question2Result['killState'] = 'corrupted';
		if (
			afterKill.project.historyMaxSeq === 0 &&
			afterKill.historyCount === 1 &&
			afterKill.project.sourceHash === 'src-0' &&
			afterKill.sourceExists
		) {
			killState = 'previous-intact';
		} else if (
			afterKill.project.historyMaxSeq === 2 &&
			afterKill.historyCount === 3 &&
			afterKill.project.sourceHash === 'src-1' &&
			afterKill.sourceExists
		) {
			killState = 'new-committed-atomically';
		}

		return {
			pass: abortRolledBack && killState !== 'corrupted',
			abortRolledBack,
			killState,
			killDetails: `historyMaxSeq=${afterKill.project.historyMaxSeq}, historyCount=${afterKill.historyCount}, sourceHash=${afterKill.project.sourceHash}, sourceExists=${afterKill.sourceExists}`,
		};
	} finally {
		await removeTempProfile(profileDir);
	}
}

async function runQuestion3(
	browserType: BrowserType,
	browserName: BrowserName,
	baseUrl: string,
): Promise<Question3Result> {
	const profileDir = await createTempProfile(`${browserName}-q3`);

	try {
		const context = await browserType.launchPersistentContext(profileDir, {
			headless: true,
		});
		const page = await context.newPage();
		await page.goto(baseUrl, {waitUntil: 'load'});

		const storageInfo = await page.evaluate(async () => {
			const estimate = await navigator.storage.estimate();
			const persistedBefore =
				typeof navigator.storage.persisted === 'function'
					? await navigator.storage.persisted()
					: null;
			const persistResult =
				typeof navigator.storage.persist === 'function'
					? await Promise.race<boolean | 'timeout'>([
							navigator.storage.persist(),
							new Promise<'timeout'>((resolve) => {
								setTimeout(() => resolve('timeout'), 3000);
							}),
						])
					: null;
			const persistedAfter =
				typeof navigator.storage.persisted === 'function'
					? await navigator.storage.persisted()
					: null;

			const details =
				'usageDetails' in estimate
					? ((estimate as {usageDetails?: Record<string, number>})
							.usageDetails ?? null)
					: null;

			return {
				estimate: {
					usage: estimate.usage ?? null,
					quota: estimate.quota ?? null,
					usageDetails: details,
				},
				persistedBefore,
				persistResult,
				persistedAfter,
			};
		});

		if (browserName === 'chromium') {
			const cdp = await context.newCDPSession(page);
			await cdp.send('Storage.overrideQuotaForOrigin', {
				origin: baseUrl,
				quotaSize: 5 * 1024 * 1024,
			});

			const quotaResult = await page.evaluate(async () => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const req = globalThis.indexedDB.open('pixelsortgui-quota', 1);
					req.addEventListener('upgradeneeded', () => {
						const database = req.result;
						database.createObjectStore('sources', {keyPath: 'sha256'});
						database.createObjectStore('projects', {keyPath: 'id'});
					});
					req.addEventListener('success', () => resolve(req.result));
					req.addEventListener('error', () =>
						reject(req.error ?? new Error('IDB open failed')),
					);
				});

				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(['sources', 'projects'], 'readwrite');
					tx.objectStore('sources').put({
						sha256: 'small',
						blob: new Blob([new Uint8Array(512 * 1024)]),
					});
					tx.objectStore('projects').put({id: 'p-small', sourceHash: 'small'});
					tx.addEventListener('complete', () => resolve());
					tx.addEventListener('error', () =>
						reject(tx.error ?? new Error('IDB tx error')),
					);
				});

				let errorName: string | null = null;
				try {
					await new Promise<void>((resolve, reject) => {
						const big = new Uint8Array(15 * 1024 * 1024);
						big.fill(7);
						const tx = db.transaction(['sources', 'projects'], 'readwrite');
						tx.objectStore('sources').put({
							sha256: 'too-big',
							blob: new Blob([big]),
						});
						tx.objectStore('projects').put({
							id: 'p-big',
							sourceHash: 'too-big',
						});
						tx.addEventListener('complete', () => resolve());
						tx.addEventListener('error', () =>
							reject(tx.error ?? new Error('IDB tx error')),
						);
						tx.addEventListener('abort', () =>
							reject(tx.error ?? new Error('IDB tx aborted')),
						);
					});
				} catch (error) {
					errorName =
						error instanceof Error ? error.name : String(error ?? 'unknown');
				}

				const check = await new Promise<{
					smallExists: boolean;
					bigExists: boolean;
				}>((resolve, reject) => {
					const tx = db.transaction(['projects'], 'readonly');
					const smallReq = tx.objectStore('projects').get('p-small');
					const bigReq = tx.objectStore('projects').get('p-big');
					tx.addEventListener('complete', () =>
						resolve({
							smallExists: Boolean(smallReq.result),
							bigExists: Boolean(bigReq.result),
						}),
					);
					tx.addEventListener('error', () =>
						reject(tx.error ?? new Error('IDB tx error')),
					);
				});

				db.close();
				return {
					errorName,
					earlierDataIntact: check.smallExists && !check.bigExists,
				};
			});

			await context.close();

			return {
				pass:
					quotaResult.errorName === 'QuotaExceededError' &&
					quotaResult.earlierDataIntact,
				estimate: storageInfo.estimate,
				persistedBefore: storageInfo.persistedBefore,
				persistResult: storageInfo.persistResult,
				persistedAfter: storageInfo.persistedAfter,
				quotaTestMode: 'cdp-override',
				quotaErrorName: quotaResult.errorName,
				quotaErrorCaught: quotaResult.errorName === 'QuotaExceededError',
				earlierDataIntact: quotaResult.earlierDataIntact,
				notes:
					'Triggered real QuotaExceededError via CDP Storage.overrideQuotaForOrigin (5 MiB cap).',
			};
		}

		await context.close();
		return {
			pass: true,
			estimate: storageInfo.estimate,
			persistedBefore: storageInfo.persistedBefore,
			persistResult: storageInfo.persistResult,
			persistedAfter: storageInfo.persistedAfter,
			quotaTestMode: 'unavailable-in-automation',
			quotaErrorName: null,
			quotaErrorCaught: false,
			earlierDataIntact: true,
			notes:
				'Playwright Firefox does not expose a per-origin quota override API (no CDP Storage.overrideQuotaForOrigin equivalent). estimate()/persist()/persisted() were measured directly.',
		};
	} finally {
		await removeTempProfile(profileDir);
	}
}

async function runQuestion4(
	browserType: BrowserType,
	browserName: BrowserName,
	baseUrl: string,
): Promise<Question4Result> {
	const browser = await browserType.launch({headless: true});
	try {
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(baseUrl, {waitUntil: 'load'});

		const result = await page.evaluate(async () => {
			let idbAvailable = false;
			let writeReadWorked = false;
			try {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const req = globalThis.indexedDB.open('pixelsortgui-private', 1);
					req.addEventListener('upgradeneeded', () => {
						req.result.createObjectStore('kv', {keyPath: 'k'});
					});
					req.addEventListener('success', () => resolve(req.result));
					req.addEventListener('error', () =>
						reject(req.error ?? new Error('IDB open failed')),
					);
				});
				idbAvailable = true;

				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction('kv', 'readwrite');
					tx.objectStore('kv').put({k: 'hello', v: 'world'});
					tx.addEventListener('complete', () => resolve());
					tx.addEventListener('error', () =>
						reject(tx.error ?? new Error('IDB tx error')),
					);
				});

				const value = await new Promise<string | null>((resolve, reject) => {
					const tx = db.transaction('kv', 'readonly');
					const req = tx.objectStore('kv').get('hello');
					req.addEventListener('success', () =>
						resolve((req.result as {v?: string} | undefined)?.v ?? null),
					);
					req.addEventListener('error', () =>
						reject(req.error ?? new Error('IDB get failed')),
					);
				});
				writeReadWorked = value === 'world';
				db.close();
			} catch {
				idbAvailable = false;
			}

			const estimate = await navigator.storage.estimate();
			const persisted =
				typeof navigator.storage.persisted === 'function'
					? await navigator.storage.persisted()
					: null;
			const persistResult =
				typeof navigator.storage.persist === 'function'
					? await Promise.race<boolean | 'timeout'>([
							navigator.storage.persist(),
							new Promise<'timeout'>((resolve) => {
								setTimeout(() => resolve('timeout'), 3000);
							}),
						])
					: null;

			let fallbackTriggeredOnError = false;
			const originalOpen = globalThis.indexedDB.open.bind(globalThis.indexedDB);
			try {
				Object.defineProperty(globalThis.indexedDB, 'open', {
					configurable: true,
					value() {
						throw new DOMException(
							'Simulated storage disabled',
							'SecurityError',
						);
					},
				});
				try {
					globalThis.indexedDB.open('pixelsortgui', 1);
				} catch {
					fallbackTriggeredOnError = true;
				}
			} finally {
				Object.defineProperty(globalThis.indexedDB, 'open', {
					configurable: true,
					value: originalOpen,
				});
			}

			return {
				idbAvailable,
				writeReadWorked,
				estimate: {
					usage: estimate.usage ?? null,
					quota: estimate.quota ?? null,
				},
				persisted,
				persistResult,
				fallbackTriggeredOnError,
			};
		});

		await context.close();

		return {
			pass:
				result.idbAvailable &&
				result.writeReadWorked &&
				result.fallbackTriggeredOnError,
			contextKind:
				browserName === 'chromium'
					? 'Playwright browser.newContext() (Chromium incognito BrowserContext)'
					: 'Playwright browser.newContext() (ephemeral Firefox context; not guaranteed identical to desktop Private Browsing window)',
			...result,
			notes:
				browserName === 'chromium'
					? 'Chromium incognito BrowserContext exposes ephemeral IndexedDB with a reduced in-memory quota.'
					: 'Playwright Firefox browser.newContext() is an isolated ephemeral context, not a full Firefox Private Browsing window; real Private Window behaviour should be spot-checked manually.',
		};
	} finally {
		await browser.close();
	}
}

async function waitForServiceWorkerControl(page: Page): Promise<boolean> {
	return page.evaluate(async () => {
		if (!('serviceWorker' in navigator)) {
			return false;
		}

		await navigator.serviceWorker.register('/sw.js');
		await navigator.serviceWorker.ready;
		if (navigator.serviceWorker.controller) {
			return true;
		}

		return new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), 5000);
			navigator.serviceWorker.addEventListener(
				'controllerchange',
				() => {
					clearTimeout(timer);
					resolve(Boolean(navigator.serviceWorker.controller));
				},
				{once: true},
			);
		});
	});
}

async function runQuestion5(
	browserType: BrowserType,
	browserName: BrowserName,
	baseUrl: string,
): Promise<Question5Result> {
	const profileDir = await createTempProfile(`${browserName}-q5`);

	try {
		const context = await browserType.launchPersistentContext(profileDir, {
			headless: true,
		});
		const page = await context.newPage();
		await page.goto(baseUrl, {waitUntil: 'load'});

		const swRegistered = await waitForServiceWorkerControl(page);

		const expectedHash = await page.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = globalThis.indexedDB.open('pixelsortgui-offline', 1);
				req.addEventListener('upgradeneeded', () => {
					req.result.createObjectStore('sources', {keyPath: 'sha256'});
				});
				req.addEventListener('success', () => resolve(req.result));
				req.addEventListener('error', () =>
					reject(req.error ?? new Error('IDB open failed')),
				);
			});

			const bytes = new Uint8Array(2 * 1024 * 1024);
			for (let index = 0; index < bytes.length; index++) {
				bytes[index] = (index * 31) % 256;
			}

			const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
			const hash = Array.from(new Uint8Array(digest), (byte) =>
				byte.toString(16).padStart(2, '0'),
			).join('');

			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('sources', 'readwrite');
				tx.objectStore('sources').put({
					sha256: hash,
					blob: new Blob([bytes]),
				});
				tx.addEventListener('complete', () => resolve());
				tx.addEventListener('error', () =>
					reject(tx.error ?? new Error('IDB tx error')),
				);
			});
			db.close();
			return hash;
		});

		await context.setOffline(true);
		await page.reload({waitUntil: 'load'});

		const offlineCheck = await page.evaluate(async (hash) => {
			const heading =
				globalThis.document.querySelector('h1')?.textContent ?? '';
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = globalThis.indexedDB.open('pixelsortgui-offline', 1);
				req.addEventListener('success', () => resolve(req.result));
				req.addEventListener('error', () =>
					reject(req.error ?? new Error('IDB open failed')),
				);
			});
			const record = await new Promise<{blob: Blob} | undefined>(
				(resolve, reject) => {
					const tx = db.transaction('sources', 'readonly');
					const req = tx.objectStore('sources').get(hash);
					req.addEventListener('success', () =>
						resolve(req.result as {blob: Blob} | undefined),
					);
					req.addEventListener('error', () =>
						reject(req.error ?? new Error('IDB get failed')),
					);
				},
			);
			db.close();
			if (!record) {
				return {
					loaded: heading.includes('Spike S3'),
					survived: false,
					hashMatch: false,
				};
			}

			const buf = await record.blob.arrayBuffer();
			const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
			const actualHash = Array.from(new Uint8Array(digest), (byte) =>
				byte.toString(16).padStart(2, '0'),
			).join('');

			return {
				loaded: heading.includes('Spike S3'),
				survived: true,
				hashMatch: actualHash === hash,
			};
		}, expectedHash);

		await context.close();

		return {
			pass:
				swRegistered &&
				offlineCheck.loaded &&
				offlineCheck.survived &&
				offlineCheck.hashMatch,
			swRegistered,
			offlineReloadLoaded: offlineCheck.loaded,
			idbSurvivedOffline: offlineCheck.survived,
			hashMatch: offlineCheck.hashMatch,
		};
	} finally {
		await removeTempProfile(profileDir);
	}
}

async function runQuestion6(
	browserType: BrowserType,
	browserName: BrowserName,
	baseUrl: string,
): Promise<Question6Result> {
	const profileDir = await createTempProfile(`${browserName}-q6`);

	try {
		const context = await browserType.launchPersistentContext(profileDir, {
			headless: true,
		});
		const page = await context.newPage();
		await page.goto(baseUrl, {waitUntil: 'load'});

		const result = await page.evaluate(async () => {
			const dbName = 'pixelsortgui-upgrade';

			const db1 = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = globalThis.indexedDB.open(dbName, 1);
				req.addEventListener('upgradeneeded', () => {
					const db = req.result;
					db.createObjectStore('projects', {keyPath: 'id'});
					db.createObjectStore('meta', {keyPath: 'key'});
				});
				req.addEventListener('success', () => resolve(req.result));
				req.addEventListener('error', () =>
					reject(req.error ?? new Error('IDB open failed')),
				);
			});

			await new Promise<void>((resolve, reject) => {
				const tx = db1.transaction(['projects', 'meta'], 'readwrite');
				tx.objectStore('projects').put({
					id: 'p1',
					name: 'Old Project',
					schemaVersion: 1,
				});
				tx.objectStore('meta').put({key: 'schemaInfo', dbVersion: 1});
				tx.addEventListener('complete', () => resolve());
				tx.addEventListener('error', () =>
					reject(tx.error ?? new Error('IDB tx error')),
				);
			});
			db1.close();

			const db2 = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = globalThis.indexedDB.open(dbName, 2);
				req.addEventListener('upgradeneeded', () => {
					const db = req.result;
					const tx = req.transaction!;
					db.createObjectStore('masks', {keyPath: 'id'});
					const projectsStore = tx.objectStore('projects');
					const cursorReq = projectsStore.openCursor();
					cursorReq.addEventListener('success', () => {
						const cursor = cursorReq.result;
						if (!cursor) {
							return;
						}

						const value = cursor.value as {
							id: string;
							name: string;
							schemaVersion: number;
						};
						cursor.update({
							...value,
							schemaVersion: 2,
							migratedFromV1: true,
						});
						cursor.continue();
					});

					tx.objectStore('meta').put({key: 'schemaInfo', dbVersion: 2});
				});
				req.addEventListener('success', () => resolve(req.result));
				req.addEventListener('error', () =>
					reject(req.error ?? new Error('IDB open failed')),
				);
			});

			const newStoreCreated = db2.objectStoreNames.contains('masks');
			const v2State = await new Promise<{
				project: {
					id: string;
					name: string;
					schemaVersion: number;
					migratedFromV1?: boolean;
				};
				schemaInfo: {dbVersion: number};
			}>((resolve, reject) => {
				const tx = db2.transaction(['projects', 'meta'], 'readonly');
				const pReq = tx.objectStore('projects').get('p1');
				const mReq = tx.objectStore('meta').get('schemaInfo');
				tx.addEventListener('complete', () =>
					resolve({
						project: pReq.result as {
							id: string;
							name: string;
							schemaVersion: number;
							migratedFromV1?: boolean;
						},
						schemaInfo: mReq.result as {dbVersion: number},
					}),
				);
				tx.addEventListener('error', () =>
					reject(tx.error ?? new Error('IDB tx error')),
				);
			});
			db2.close();

			let downgradeErrorName: string | null = null;
			try {
				await new Promise<IDBDatabase>((resolve, reject) => {
					const req = globalThis.indexedDB.open(dbName, 1);
					req.addEventListener('success', () => resolve(req.result));
					req.addEventListener('error', () =>
						reject(req.error ?? new Error('IDB open failed')),
					);
				});
			} catch (error) {
				downgradeErrorName =
					error instanceof Error ? error.name : String(error ?? 'unknown');
			}

			const db2Again = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = globalThis.indexedDB.open(dbName, 2);
				req.addEventListener('success', () => resolve(req.result));
				req.addEventListener('error', () =>
					reject(req.error ?? new Error('IDB open failed')),
				);
			});
			const stillIntact = await new Promise<boolean>((resolve, reject) => {
				const tx = db2Again.transaction('projects', 'readonly');
				const req = tx.objectStore('projects').get('p1');
				req.addEventListener('success', () =>
					resolve(
						(req.result as {name?: string} | undefined)?.name === 'Old Project',
					),
				);
				req.addEventListener('error', () =>
					reject(req.error ?? new Error('IDB get failed')),
				);
			});
			db2Again.close();

			return {
				v1ToV2Migrated: v2State.schemaInfo.dbVersion === 2,
				oldDataSurvived: v2State.project.name === 'Old Project',
				newStoreCreated,
				recordTransformed:
					v2State.project.schemaVersion === 2 &&
					v2State.project.migratedFromV1 === true,
				downgradeErrorName,
				v2IntactAfterDowngradeAttempt: stillIntact,
			};
		});

		await context.close();

		return {
			pass:
				result.v1ToV2Migrated &&
				result.oldDataSurvived &&
				result.newStoreCreated &&
				result.recordTransformed &&
				result.downgradeErrorName === 'VersionError' &&
				result.v2IntactAfterDowngradeAttempt,
			...result,
		};
	} finally {
		await removeTempProfile(profileDir);
	}
}

async function runForBrowser(
	browserType: BrowserType,
	browserName: BrowserName,
	baseUrl: string,
): Promise<BrowserReport> {
	const browser = await browserType.launch({headless: true});
	const version = browser.version();
	await browser.close();

	console.error(`[s3] ${browserName} ${version}: q1...`);
	const q1 = await runQuestion1(browserType, browserName, baseUrl);
	console.error(`[s3] ${browserName}: q2...`);
	const q2 = await runQuestion2(browserType, browserName, baseUrl);
	console.error(`[s3] ${browserName}: q3...`);
	const q3 = await runQuestion3(browserType, browserName, baseUrl);
	console.error(`[s3] ${browserName}: q4...`);
	const q4 = await runQuestion4(browserType, browserName, baseUrl);
	console.error(`[s3] ${browserName}: q5...`);
	const q5 = await runQuestion5(browserType, browserName, baseUrl);
	console.error(`[s3] ${browserName}: q6...`);
	const q6 = await runQuestion6(browserType, browserName, baseUrl);
	console.error(`[s3] ${browserName}: done`);

	return {
		browser: browserName,
		version,
		q1,
		q2,
		q3,
		q4,
		q5,
		q6,
	};
}

async function main(): Promise<void> {
	const {server, url} = await startStaticServer();
	try {
		const reports: BrowserReport[] = [
			await runForBrowser(chromium, 'chromium', url),
			await runForBrowser(firefox, 'firefox', url),
		];

		console.log(JSON.stringify({baseUrl: url, reports}, null, 2));

		const failed = reports.some(
			(report) =>
				!report.q1.pass ||
				!report.q2.pass ||
				!report.q3.pass ||
				!report.q4.pass ||
				!report.q5.pass ||
				!report.q6.pass,
		);

		if (failed) {
			process.exitCode = 1;
		}
	} finally {
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	}
}

await main();
