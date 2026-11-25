import process from 'node:process';
import {defineConfig, devices} from '@playwright/test';
import {DESKTOP_VIEWPORT} from './tests/e2e/viewports.ts';

export const PERF_TAG = /@perf\b/;

const previewPort = process.env.PLAYWRIGHT_PORT ?? '4173';
const previewUrl = `http://localhost:${previewPort}`;

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [
				['github'],
				['html', {open: 'never'}],
				['json', {outputFile: 'test-results/report.json'}],
			]
		: 'list',
	use: {
		// eslint-disable-next-line @typescript-eslint/naming-convention -- Playwright config option name
		baseURL: previewUrl,
		viewport: {
			width: DESKTOP_VIEWPORT.width,
			height: DESKTOP_VIEWPORT.height,
		},
		trace: 'on-first-retry',
	},
	// Speed budgets are tagged @perf and run by playwright.perf.config.ts, so
	// every project here leaves them out, including those in files added later.
	projects: [
		{
			name: 'chromium',
			grepInvert: PERF_TAG,
			use: {
				...devices['Desktop Chrome'],
				viewport: {
					width: DESKTOP_VIEWPORT.width,
					height: DESKTOP_VIEWPORT.height,
				},
			},
		},
		{
			name: 'firefox',
			grepInvert: PERF_TAG,
			use: {
				...devices['Desktop Firefox'],
				viewport: {
					width: DESKTOP_VIEWPORT.width,
					height: DESKTOP_VIEWPORT.height,
				},
			},
		},
	],
	webServer: {
		command: `pnpm exec vp build && pnpm exec vp preview --port ${previewPort} --strictPort`,
		url: previewUrl,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
