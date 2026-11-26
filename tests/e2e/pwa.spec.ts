import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import {expect, test, type Page} from '@playwright/test';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';
import {DESKTOP_VIEWPORT} from './viewports.ts';

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.txt': 'text/plain; charset=utf-8',
};

async function startDistServer(): Promise<{
	url: string;
	setSwVersion: (version: number) => void;
	close: () => Promise<void>;
}> {
	const distDir = path.resolve(import.meta.dirname, '../../dist');
	let swVersion = 1;

	const server = http.createServer((request, response) => {
		const requestPath = (request.url ?? '/').split('?', 1)[0] ?? '/';
		const relativePath =
			requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
		const filePath = path.resolve(distDir, relativePath);
		if (!filePath.startsWith(distDir)) {
			response.writeHead(403).end();
			return;
		}

		void readFile(filePath)
			.then((data) => {
				const extension = path.extname(filePath);
				const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
				if (relativePath === 'sw.js') {
					const body =
						swVersion === 1
							? data
							: Buffer.concat([
									data,
									Buffer.from(`\n// simulated-update-v${swVersion}\n`),
								]);
					response
						.writeHead(200, {
							'Content-Type': contentType,
							'Cache-Control': 'no-cache',
						})
						.end(body);
					return;
				}

				response.writeHead(200, {'Content-Type': contentType}).end(data);
			})
			.catch(() => {
				response.writeHead(404).end();
			});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	const {port} = server.address() as AddressInfo;

	return {
		url: `http://localhost:${port}`,
		setSwVersion(version) {
			swVersion = version;
		},
		async close() {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			});
		},
	};
}

async function waitForServiceWorkerControl(page: Page): Promise<void> {
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});

	const hasController = await page.evaluate(
		() => navigator.serviceWorker.controller !== null,
	);
	if (!hasController) {
		await page.reload({waitUntil: 'load'});
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
		});
	}

	await expect
		.poll(async () =>
			page.evaluate(() => navigator.serviceWorker.controller !== null),
		)
		.toBe(true);
}

test.describe('PWA offline, manifest, update toast, and install UI (F15)', () => {
	test('AC-F15.2: serves valid local manifest and icons with zero external-origin requests across the core loop', async ({
		page,
	}) => {
		const externalRequests: string[] = [];
		let appOrigin = '';

		page.on('request', (request) => {
			const url = request.url();
			if (url.startsWith('data:') || url.startsWith('blob:')) {
				return;
			}

			appOrigin ||= new URL(url).origin;

			if (new URL(url).origin !== appOrigin) {
				externalRequests.push(url);
			}
		});

		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');
		appOrigin = new URL(page.url()).origin;

		// Verify web app manifest and all declared local icons
		const manifestLink = page.locator('link[rel="manifest"]');
		await expect(manifestLink).toHaveAttribute(
			'href',
			/manifest\.webmanifest$/,
		);

		const manifestHref = (await manifestLink.getAttribute('href')) ?? '';
		const manifestUrl = new URL(manifestHref, page.url());
		expect(manifestUrl.origin).toBe(appOrigin);

		const manifestResponse = await page.request.get(manifestUrl.href);
		expect(manifestResponse.status()).toBe(200);
		const manifest = (await manifestResponse.json()) as {
			name: string;
			short_name: string;
			display: string;
			start_url: string;
			icons: Array<{src: string; sizes: string; type: string}>;
		};
		expect(manifest.name).toBe('PixelSortGUI');
		expect(manifest.short_name).toBe('PixelSortGUI');
		expect(manifest.display).toBe('standalone');
		expect(manifest.start_url).toBe('/');
		expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

		for (const icon of manifest.icons) {
			const iconUrl = new URL(icon.src, page.url());
			expect(iconUrl.origin).toBe(appOrigin);
			const iconResponse = await page.request.get(iconUrl.href);
			expect(iconResponse.status(), `Icon ${icon.src} should load`).toBe(200);
		}

		// Core loop: import -> add effect -> open settings -> export
		await importSyntheticProject(page, 'Offline check');
		await page.getByRole('button', {name: 'Add effect'}).click();
		await page.getByRole('button', {name: /pixel sort/i}).click();
		await expect(page.getByRole('heading', {name: 'Pixel sort'})).toBeVisible();

		await page.getByRole('button', {name: 'Settings'}).click();
		await expect(page.getByRole('dialog', {name: 'Settings'})).toBeVisible();
		await page.keyboard.press('Escape');

		await page.getByRole('button', {name: 'Export'}).click();
		const exportDialog = page.getByRole('dialog', {name: 'Export'});
		await expect(exportDialog).toBeVisible();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			exportDialog.getByRole('button', {name: 'Download'}).click(),
		]);
		expect(download.suggestedFilename()).toMatch(/\.png$/);

		expect(externalRequests).toEqual([]);
	});

	test('AC-F15.1: reloads, edits, and exports while offline after first visit', async ({
		page,
		context,
	}) => {
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');
		await waitForServiceWorkerControl(page);

		await importSyntheticProject(page, 'Offline project');
		await page.getByRole('button', {name: 'Add effect'}).click();
		await page.getByRole('button', {name: /pixel sort/i}).click();
		await expect(page.getByRole('heading', {name: 'Pixel sort'})).toBeVisible();

		// Wait briefly for state persistence before going offline
		await page.waitForTimeout(300);

		await context.setOffline(true);
		try {
			await page.reload({waitUntil: 'load'});

			// Project and effect stack restored offline
			await expect(
				page.getByRole('button', {name: 'Back to library'}),
			).toBeVisible();
			await expect(
				page.getByRole('heading', {name: 'Pixel sort'}),
			).toBeVisible();

			// Edit a parameter while offline
			const angleInput = page.getByRole('textbox', {name: 'Angle'});
			await angleInput.fill('90');
			await angleInput.press('Enter');
			await expect(angleInput).toHaveValue(/^90(?:\.0)?$/);

			// Export PNG while offline
			await page.getByRole('button', {name: 'Export'}).click();
			const exportDialog = page.getByRole('dialog', {name: 'Export'});
			await expect(exportDialog).toBeVisible();
			const [download] = await Promise.all([
				page.waitForEvent('download'),
				exportDialog.getByRole('button', {name: 'Download'}).click(),
			]);
			const filePath = await download.path();
			expect(filePath).not.toBeNull();
			if (!filePath) {
				throw new Error('Expected downloaded PNG path');
			}

			const bytes = await readFile(filePath);
			// PNG magic header: 89 50 4E 47
			expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
		} finally {
			await context.setOffline(false);
		}
	});

	test('AC-F15.3: shows Reload to update toast on service worker update without auto-reloading', async ({
		page,
	}) => {
		const server = await startDistServer();
		try {
			await page.setViewportSize(DESKTOP_VIEWPORT);
			await page.goto(server.url);
			await waitForServiceWorkerControl(page);

			await importSyntheticProject(page, 'Active edit');
			await expect(
				page.getByRole('button', {name: 'Back to library'}),
			).toBeVisible();

			await page.evaluate(() => {
				globalThis.document.documentElement.dataset.psgNoReloadSentinel =
					'alive';
			});

			// Bump the served sw.js bytes and trigger focus so the browser installs
			// a real waiting service worker.
			server.setSwVersion(2);
			await page.evaluate(() => {
				globalThis.dispatchEvent(new Event('focus'));
			});

			await expect(page.getByText('A new version is ready.')).toBeVisible({
				timeout: 10_000,
			});
			const reloadButton = page.getByRole('button', {name: 'Reload to update'});
			const laterButton = page.getByRole('button', {name: 'Later'});
			await expect(reloadButton).toBeVisible();
			await expect(laterButton).toBeVisible();

			// Confirm the page did NOT auto-reload while editing
			await page.waitForTimeout(500);
			const sentinelBeforeReload = await page.evaluate(
				() => globalThis.document.documentElement.dataset.psgNoReloadSentinel,
			);
			expect(sentinelBeforeReload).toBe('alive');

			await assertNoA11yViolations(page);

			// Clicking "Reload to update" reloads the page cleanly
			await Promise.all([page.waitForEvent('load'), reloadButton.click()]);
			const sentinelAfterReload = await page.evaluate(
				() => globalThis.document.documentElement.dataset.psgNoReloadSentinel,
			);
			expect(sentinelAfterReload).toBeUndefined();
			await expect(
				page.getByRole('button', {name: 'Back to library'}),
			).toBeVisible();
		} finally {
			await server.close();
		}
	});

	test('captures beforeinstallprompt, exposes Install app in Settings, and hides after use', async ({
		page,
	}) => {
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');

		// Initially hidden when beforeinstallprompt has not fired
		await page.getByRole('button', {name: 'Settings'}).click();
		const dialog = page.getByRole('dialog', {name: 'Settings'});
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('button', {name: 'Install app'})).toHaveCount(
			0,
		);
		await page.keyboard.press('Escape');

		// Dispatch a synthetic beforeinstallprompt event
		await page.evaluate(() => {
			globalThis.document.documentElement.dataset.psgInstallPromptCalls = '0';
			const event = new Event('beforeinstallprompt', {cancelable: true});
			Object.defineProperties(event, {
				prompt: {
					async value() {
						const current = Number(
							globalThis.document.documentElement.dataset
								.psgInstallPromptCalls ?? '0',
						);
						globalThis.document.documentElement.dataset.psgInstallPromptCalls =
							String(current + 1);
					},
				},
				userChoice: {
					value: Promise.resolve({outcome: 'accepted'}),
				},
			});
			globalThis.dispatchEvent(event);
		});

		await page.getByRole('button', {name: 'Settings'}).click();
		await expect(dialog).toBeVisible();
		const installButton = dialog.getByRole('button', {name: 'Install app'});
		await expect(installButton).toBeVisible();

		await assertNoA11yViolations(page);

		await installButton.click();
		await expect(installButton).toHaveCount(0);

		const promptCalls = await page.evaluate(() =>
			Number(
				globalThis.document.documentElement.dataset.psgInstallPromptCalls ??
					'0',
			),
		);
		expect(promptCalls).toBe(1);
	});
});
