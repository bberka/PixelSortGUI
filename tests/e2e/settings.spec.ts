import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {expect, test, type Page} from '@playwright/test';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';
import {DESKTOP_VIEWPORT, PROOF_VIEWPORTS} from './viewports.ts';

async function openSettings(page: Page) {
	const button = page.getByRole('button', {name: 'Settings'});
	await expect(button).toBeVisible();
	await button.click();
	const dialog = page.getByRole('dialog', {name: 'Settings'});
	await expect(dialog).toBeVisible();
	return dialog;
}

test.describe('Settings, storage status, and About', () => {
	test('AC-F14 & AC-F16.1: opens from Library and Editor, switches theme, shows usage, persistence, and About notices', async ({
		page,
	}) => {
		const externalRequests: string[] = [];
		page.on('request', (request) => {
			const url = request.url();
			if (
				!url.startsWith('http://127.0.0.1:') &&
				!url.startsWith('http://localhost:') &&
				!url.startsWith('data:') &&
				!url.startsWith('blob:')
			) {
				externalRequests.push(url);
			}
		});

		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');

		const dialog = await openSettings(page);

		// Usage line matches persistence.md §7.2 format or unavailable fallback
		const usageLine = dialog.locator('p').filter({
			hasText:
				/^(Using \d+(?:\.\d)? (?:MB|GB) of \d+(?:\.\d)? (?:MB|GB)|Storage usage unavailable)$/,
		});
		await expect(usageLine).toBeVisible();

		// Persistence status and private browsing note
		await expect(
			dialog.getByText(
				/Storage protection: (Persistent|Best-effort \(browser may clear data when space is low\))/,
			),
		).toBeVisible();
		await expect(
			dialog.getByText(
				'If you use a private or incognito window, everything Drift saves in it is deleted when you close it.',
			),
		).toBeVisible();

		// Theme switching in Settings updates html[data-theme]
		await dialog.getByRole('radio', {name: 'Light'}).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await dialog.getByRole('radio', {name: 'True Black'}).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

		// About: product name, ASDFPixelSort credit, MIT licence, third-party notices
		await expect(
			dialog.getByText(
				"Pixel sorting lineage: inspired by Kim Asendorf's ASDFPixelSort.",
			),
		).toBeVisible();

		await expect(
			dialog.getByRole('button', {name: 'View licence'}),
		).toHaveCount(0);
		await expect(
			dialog.getByRole('link', {name: /Licence \(MIT\)/}),
		).toBeVisible();

		await dialog.getByRole('button', {name: 'View notices'}).click();
		const noticesList = dialog.locator('#settings-third-party-notices');
		await expect(noticesList).toBeVisible();
		await expect(noticesList.getByText('react', {exact: true})).toBeVisible();
		await expect(noticesList.getByText('zustand', {exact: true})).toBeVisible();

		// Close with Escape
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();

		// Also reachable from Editor screen
		await importSyntheticProject(page, 'Settings check');
		await expect(
			page.getByRole('button', {name: 'Back to library'}),
		).toBeVisible();
		const editorDialog = await openSettings(page);
		await expect(editorDialog.getByText('Drift', {exact: true})).toBeVisible();

		expect(externalRequests).toEqual([]);
	});

	test('Full licence texts opens a same-origin file that names every listed package', async ({
		page,
	}) => {
		await page.goto('/');
		const dialog = await openSettings(page);

		await dialog.getByRole('button', {name: 'View notices'}).click();
		const noticesList = dialog.locator('#settings-third-party-notices');
		await expect(noticesList).toBeVisible();
		// A locator call that reads many of these items crashes Playwright's
		// Firefox page (Page crashed), so read the names in one page evaluation.
		const names = await page.evaluate(() =>
			[
				...globalThis.document.querySelectorAll(
					'#settings-third-party-notices li > div > :first-child',
				),
			].map((element) => element.textContent?.trim() ?? ''),
		);
		expect(names.length).toBeGreaterThan(10);
		expect(names).toContain('react');
		expect(names).toContain('lucide-react');

		const link = dialog.getByRole('link', {name: 'Full licence texts'});
		await expect(link).toBeVisible();
		const target = new URL((await link.getAttribute('href')) ?? '', page.url());
		expect(target.origin).toBe(new URL(page.url()).origin);

		const response = await page.request.get(target.href);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('text/plain');
		const text = await response.text();
		expect(text).toContain('Permission is hereby granted');
		for (const name of names) {
			expect(text, `${name} is missing from the licence texts`).toContain(name);
		}

		const [popup] = await Promise.all([
			page.waitForEvent('popup'),
			link.click(),
		]);
		await popup.waitForLoadState();
		expect(new URL(popup.url()).origin).toBe(target.origin);
		await expect(popup.locator('body')).toContainText(
			'Permission is hereby granted',
		);
	});

	// The service worker precaches lazy chunks in the background after load.
	// Blocking it leaves only the requests the page itself makes.
	test.describe('changelog (F24)', () => {
		test.use({serviceWorkers: 'block'});

		test('AC-F24.1 & AC-F24.2: expands the CHANGELOG.md release notes offline with zero network requests', async ({
			page,
			context,
		}) => {
			const changelog = await readFile(
				path.resolve(import.meta.dirname, '../../CHANGELOG.md'),
				'utf8',
			);
			await page.goto('/');
			const dialog = await openSettings(page);
			const toggle = dialog.getByRole('button', {name: 'View changelog'});
			await expect(toggle).toHaveAttribute('aria-expanded', 'false');
			await page.waitForLoadState('networkidle');

			const requests: string[] = [];
			context.on('request', (request) => {
				requests.push(request.url());
			});
			await context.setOffline(true);
			await toggle.click();

			const notes = dialog.getByRole('region', {name: 'Release notes'});
			await expect(notes).toBeVisible();
			expect(await notes.locator('p').textContent()).toBe(changelog);
			const hide = dialog.getByRole('button', {name: 'Hide changelog'});
			await expect(hide).toHaveAttribute('aria-expanded', 'true');
			await hide.click();
			await expect(notes).toBeHidden();
			expect(requests).toEqual([]);
		});
	});

	test('persistence request stays non-blocking while pending', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			if (!navigator.storage) {
				return;
			}

			Object.defineProperties(navigator.storage, {
				persisted: {
					configurable: true,
					value: async () => false,
				},
				persist: {
					configurable: true,
					value: () => new Promise<boolean>(() => {}),
				},
			});
		});

		await page.setViewportSize(DESKTOP_VIEWPORT);
		await page.goto('/');

		const dialog = await openSettings(page);
		const requestButton = dialog.getByRole('button', {
			name: 'Request protection',
		});
		await expect(requestButton).toBeVisible();
		await requestButton.click();

		await expect(
			dialog.getByRole('button', {name: 'Requesting protection...'}),
		).toBeDisabled();

		// Dialog remains interactive while persist() is pending
		await dialog.getByRole('radio', {name: 'Light'}).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	for (const answer of ['granted', 'denied', 'rejected', 'missing'] as const) {
		test(`AC-F16.5: a ${answer} protection request shows its result`, async ({
			page,
			browserName,
		}) => {
			await page.addInitScript((mode) => {
				let persisted = false;
				Object.defineProperties(navigator.storage, {
					persisted: {configurable: true, value: async () => persisted},
					persist: {
						configurable: true,
						value:
							mode === 'missing'
								? undefined
								: async () => {
										if (mode === 'rejected') {
											throw new Error('rejected');
										}

										persisted = mode === 'granted';
										return persisted;
									},
					},
				});
			}, answer);
			await page.goto('/');
			const dialog = await openSettings(page);
			await dialog.getByRole('button', {name: 'Request protection'}).click();

			const denied =
				browserName === 'firefox' ? 'choose Allow' : 'Bookmark Drift';
			const expected = {
				granted: 'Storage protection granted.',
				denied,
				rejected: 'The protection request failed.',
				missing: 'Storage protection is not available here.',
			}[answer];
			await expect(dialog.getByTestId('protection-feedback')).toContainText(
				expected,
			);
			await expect(
				dialog.getByText(
					answer === 'granted'
						? 'Storage protection: Persistent'
						: 'Storage protection: Best-effort',
				),
			).toBeVisible();
		});
	}

	test('AC-F16.6: an unanswered protection request releases the button', async ({
		page,
		browserName,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperties(navigator.storage, {
				persisted: {configurable: true, value: async () => false},
				persist: {
					configurable: true,
					value: () => new Promise<boolean>(() => {}),
				},
			});
		});
		await page.clock.install();
		await page.goto('/');
		const dialog = await openSettings(page);
		await dialog.getByRole('button', {name: 'Request protection'}).click();
		await page.clock.fastForward(5000);

		await expect(dialog.getByTestId('protection-feedback')).toContainText(
			browserName === 'firefox'
				? 'Waiting for your answer.'
				: 'The browser has not answered yet.',
		);
		await expect(
			dialog.getByRole('button', {name: 'Request protection'}),
		).toBeEnabled();
	});

	for (const theme of ['light', 'dark'] as const) {
		for (const viewport of PROOF_VIEWPORTS) {
			test(`@a11y layout and axe clean in ${theme} theme at ${viewport.width}x${viewport.height}`, async ({
				page,
			}) => {
				await page.addInitScript((selectedTheme) => {
					globalThis.localStorage.setItem('drift:theme', selectedTheme);
				}, theme);

				await page.setViewportSize({
					width: viewport.width,
					height: viewport.height,
				});
				await page.goto('/');

				const dialog = await openSettings(page);
				await expect(
					dialog.getByRole('heading', {name: 'Appearance'}),
				).toBeVisible();

				await dialog.getByRole('button', {name: 'View changelog'}).click();
				await expect(
					dialog.getByRole('region', {name: 'Release notes'}),
				).toBeVisible();

				const overflow = await page.evaluate(
					() =>
						globalThis.document.documentElement.scrollWidth >
						globalThis.document.documentElement.clientWidth,
				);
				expect(overflow).toBe(false);

				await assertNoA11yViolations(page);
			});
		}
	}
});
