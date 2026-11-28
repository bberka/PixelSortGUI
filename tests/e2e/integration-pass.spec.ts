import {expect, test} from '@playwright/test';
import {ABOUT_EXTERNAL_LINKS} from '../../src/features/settings/about-links.ts';

test.describe('integration pass: database reload banner and Settings/About links', () => {
	test('shows a reload banner when another tab upgrades IndexedDB', async ({
		page,
	}) => {
		await page.goto('/');
		await expect(
			page.getByRole('heading', {
				name: 'Glitch art and pixel sorting for your photos',
			}),
		).toBeVisible();

		// Trigger a real browser `versionchange` event on the open `drift` database.
		await page.evaluate(async () => {
			await new Promise<void>((resolve) => {
				const request = globalThis.indexedDB.open('drift', 99);
				request.addEventListener('upgradeneeded', () => {
					request.transaction?.abort();
				});
				request.addEventListener('error', () => {
					resolve();
				});
				request.addEventListener('success', () => {
					request.result.close();
					resolve();
				});
			});
		});

		const alert = page.getByRole('alert');
		await expect(alert).toContainText(
			'Storage was updated in another tab. Reload to continue saving changes.',
		);
		await expect(alert.getByRole('button', {name: 'Reload'})).toBeVisible();
	});

	test('shows GitHub links and in-app third-party notices in Settings/About with zero external requests', async ({
		page,
	}) => {
		const externalRequests: string[] = [];
		page.on('request', (request) => {
			const url = new URL(request.url());
			if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
				externalRequests.push(request.url());
			}
		});

		await page.goto('/');
		await page.getByRole('button', {name: 'Settings'}).click();

		const dialog = page.getByRole('dialog', {name: 'Settings'});
		await expect(dialog).toBeVisible();
		await expect(dialog).not.toContainText('0.x (dev)');

		for (const expected of ABOUT_EXTERNAL_LINKS) {
			const link = dialog.getByRole('link', {name: expected.accessibleName});
			await expect(link).toBeVisible();
			await expect(link).toHaveAttribute('href', expected.href);
			await expect(link).toHaveAttribute('target', '_blank');
			await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
		}

		await dialog.getByRole('button', {name: /^Third-party notices/}).click();
		await expect(
			page
				.getByRole('dialog', {name: 'Third-party notices'})
				.getByTestId('third-party-notices'),
		).toBeVisible();

		expect(externalRequests).toEqual([]);
	});
});
