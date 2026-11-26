import {readFile} from 'node:fs/promises';
import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {startDistServer, waitForServiceWorkerControl} from './dist-server.ts';
import {importSyntheticProject} from './seed.ts';
import {DESKTOP_VIEWPORT} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

async function readPersistedProject(
	page: Page,
	projectId: string,
): Promise<{name: string; effectTypes: string[]} | null> {
	return page.evaluate(async (id) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			return null;
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			return null;
		}

		const record = await booted.bundle.repository.getProject(id);
		if (!record) {
			return null;
		}

		return {
			name: record.name,
			effectTypes: record.stack.instances.map((effect) => effect.type),
		};
	}, projectId);
}

test.describe('PWA offline, manifest, update toast, and install UI (F15)', () => {
	test('AC-F15.2: serves valid local manifest and icons with zero external-origin requests across the core loop', async ({
		page,
		context,
	}) => {
		const capturedRequests: string[] = [];
		const externalRequests: string[] = [];
		let appOrigin = '';

		context.on('request', (request) => {
			const url = request.url();
			if (url.startsWith('data:') || url.startsWith('blob:')) {
				return;
			}

			appOrigin ||= new URL(url).origin;
			capturedRequests.push(url);

			if (new URL(url).origin !== appOrigin) {
				externalRequests.push(url);
			}
		});

		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');
		appOrigin = new URL(page.url()).origin;
		await waitForServiceWorkerControl(page);

		// Verify built service worker precache manifest entries are all same-origin
		const swUrl = new URL('/sw.js', page.url());
		const swResponse = await page.request.get(swUrl.href);
		expect(swResponse.status()).toBe(200);
		const swSource = await swResponse.text();
		const precacheBlockMatch = /precacheAndRoute\(\[([\s\S]*?)\]/.exec(
			swSource,
		);
		expect(precacheBlockMatch).not.toBeNull();
		const precacheUrls = [
			...(precacheBlockMatch?.[1] ?? '').matchAll(/url:"([^"]+)"/g),
		].map((match) => match[1] ?? '');
		expect(precacheUrls.length).toBeGreaterThan(0);
		for (const entryUrl of precacheUrls) {
			const resolved = new URL(entryUrl, appOrigin);
			expect(
				resolved.origin,
				`Precache entry ${entryUrl} should be same-origin`,
			).toBe(appOrigin);
		}

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
		expect(manifest.name).toBe('Drift');
		expect(manifest.short_name).toBe('Drift');
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

		expect(capturedRequests.length).toBeGreaterThan(0);
		expect(externalRequests).toEqual([]);
	});

	test('AC-F15.1: reloads, edits, and exports while offline after first visit', async ({
		page,
		context,
	}) => {
		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');
		await waitForServiceWorkerControl(page);

		const projectId = await importSyntheticProject(page, 'Offline project');
		await page.getByRole('button', {name: 'Add effect'}).click();
		await page.getByRole('button', {name: /pixel sort/i}).click();
		await expect(page.getByRole('heading', {name: 'Pixel sort'})).toBeVisible();

		// Wait until the persisted project and effect are committed in IndexedDB
		await expect
			.poll(async () => readPersistedProject(page, projectId))
			.toEqual({
				name: 'Offline project',
				effectTypes: ['pixelSort'],
			});

		await context.setOffline(true);
		try {
			await page.reload({waitUntil: 'load'});

			// Specific persisted project and effect stack restored offline
			await expect(page).toHaveURL(new RegExp(`#/p/${projectId}$`));
			await expect(
				page.getByRole('button', {name: 'Back to library'}),
			).toBeVisible();
			await expect(
				page.locator('header').getByText('Offline project', {exact: true}),
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

			// Clicking "Reload to update" triggers exactly one reload and activates
			// the updated service worker controller.
			let reloadCount = 0;
			page.on('load', () => {
				reloadCount += 1;
			});

			await Promise.all([page.waitForEvent('load'), reloadButton.click()]);
			const sentinelAfterReload = await page.evaluate(
				() => globalThis.document.documentElement.dataset.psgNoReloadSentinel,
			);
			expect(sentinelAfterReload).toBeUndefined();
			await expect(
				page.getByRole('button', {name: 'Back to library'}),
			).toBeVisible();

			const swState = await page.evaluate(async () => {
				const registration = await navigator.serviceWorker.ready;
				return {
					controllerScriptUrl:
						navigator.serviceWorker.controller?.scriptURL ?? null,
					hasWaiting: registration.waiting !== null,
				};
			});
			expect(swState.controllerScriptUrl).toBe(`${server.url}/sw.js`);
			expect(swState.hasWaiting).toBe(false);
			expect(reloadCount).toBe(1);
		} finally {
			await server.close();
		}
	});

	test('AC-F15.3 (Later): dismisses update toast cleanly without reloading', async ({
		page,
	}) => {
		const server = await startDistServer();
		try {
			await page.setViewportSize(DESKTOP_VIEWPORT);
			await page.goto(server.url);
			await waitForServiceWorkerControl(page);

			await importSyntheticProject(page, 'Keep editing');
			await expect(
				page.getByRole('button', {name: 'Back to library'}),
			).toBeVisible();

			await page.evaluate(() => {
				globalThis.document.documentElement.dataset.psgNoReloadSentinel =
					'alive';
			});

			let reloadCount = 0;
			page.on('load', () => {
				reloadCount += 1;
			});

			server.setSwVersion(2);
			await page.evaluate(() => {
				globalThis.dispatchEvent(new Event('focus'));
			});

			const toastText = page.getByText('A new version is ready.');
			await expect(toastText).toBeVisible({timeout: 10_000});

			await page.getByRole('button', {name: 'Later'}).click();
			await expect(toastText).toBeHidden();

			await page.waitForTimeout(300);
			const sentinel = await page.evaluate(
				() => globalThis.document.documentElement.dataset.psgNoReloadSentinel,
			);
			expect(sentinel).toBe('alive');
			expect(reloadCount).toBe(0);
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
