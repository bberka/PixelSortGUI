import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import process from 'node:process';
import {expect, test, type Locator, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';
import {PROOF_VIEWPORTS} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

const THEMES = ['light', 'dark'] as const;

// Newest first, as the panel lists them.
const FIVE_COMMITS = [
	'Angle 50°',
	'Angle 40°',
	'Angle 30°',
	'Angle 20°',
	'Add Pixel sort',
	'Initial',
];

function collectConsoleErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') {
			errors.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		errors.push(error.message);
	});
	return errors;
}

async function commitAngles(
	page: Page,
	angles: readonly number[],
): Promise<void> {
	await page.evaluate(async (values) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {store} = booted.bundle;
		const instanceId = store.getState().activeProject!.stack.instances[0].id;
		for (const value of values) {
			await store
				.getState()
				.commitParam(instanceId, 'angle', value, `Angle ${value}°`);
		}
	}, angles);
}

/**
`Initial`, `Add Pixel sort` and four angle commits: 5 commits, 6 entries.
*/
async function seedHistory(page: Page): Promise<void> {
	await page.goto('/');
	await importSyntheticProject(page, 'History test');
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		await booted.bundle.store.getState().addEffect('pixelSort');
	});
	await commitAngles(page, [20, 30, 40, 50]);
}

async function readProject(page: Page) {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const project = booted.bundle.store.getState().activeProject!;
		return {
			head: project.historyHeadSeq,
			max: project.historyMaxSeq,
			angle: project.stack.instances[0]?.params.angle,
			viewState: project.viewState,
		};
	});
}

function historyList(page: Page): Locator {
	return page.getByRole('list', {name: 'Project history'});
}

function entry(page: Page, label: string): Locator {
	return historyList(page)
		.getByRole('button')
		.filter({has: page.getByTitle(label, {exact: true})});
}

async function expectRows(
	page: Page,
	labels: readonly string[],
	current: string,
	redo: readonly string[] = [],
): Promise<void> {
	await expect(historyList(page).locator('button span[title]')).toHaveText([
		...labels,
	]);
	const currentRows = historyList(page).locator('[aria-current="step"]');
	await expect(currentRows).toHaveCount(1);
	await expect(currentRows.locator('span[title]')).toHaveText(current);
	await expect(currentRows.getByText('Current', {exact: true})).toBeVisible();
	await expect(
		historyList(page).locator('button[data-redo] span[title]'),
	).toHaveText([...redo]);
}

test('Shift+Tab leaves the panel tabs and Tab returns to the selected one', async ({
	page,
}) => {
	await seedHistory(page);
	await openHistoryTab(page);
	const selected = page.getByRole('tab', {name: 'History'});
	await selected.focus();

	await page.keyboard.press('Shift+Tab');
	await expect(
		page.getByRole('region', {name: 'Canvas'}).locator(':focus'),
	).toHaveCount(1);
	await page.keyboard.press('Tab');
	await expect(selected).toBeFocused();
});

async function openHistoryTab(page: Page): Promise<void> {
	await page.getByRole('tab', {name: 'History'}).click();
	await expect(historyList(page)).toBeVisible();
}

test('AC-F23.1: lists Initial plus 5 commits newest first and marks the current step', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedHistory(page);
	await openHistoryTab(page);

	await expectRows(page, FIVE_COMMITS, 'Angle 50°');
	await expect(page.getByRole('region', {name: 'Effect stack'})).toBeHidden();
	await expect(page.getByRole('region', {name: 'Parameters'})).toBeHidden();

	await page.getByRole('tab', {name: 'Stack'}).click();
	await expect(page.getByRole('textbox', {name: 'Angle'})).toHaveValue('50.0');
	await expect(historyList(page)).toHaveCount(0);
	expect(consoleErrors).toEqual([]);
});

test('AC-F23.2 AC-F23.3: a jump keeps the view and the later entries until a new commit replaces them', async ({
	page,
}) => {
	await seedHistory(page);
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		booted.bundle.store
			.getState()
			.setViewState({fitMode: 'custom', zoom: 2, centerX: 80, centerY: 60});
	});
	const before = await readProject(page);
	await openHistoryTab(page);

	// Entry 2 is seq 2, the first angle commit.
	await entry(page, 'Angle 20°').click();
	await expectRows(page, FIVE_COMMITS, 'Angle 20°', [
		'Angle 50°',
		'Angle 40°',
		'Angle 30°',
	]);
	const jumped = await readProject(page);
	expect(jumped).toMatchObject({head: 2, max: 5, angle: 20});
	expect(jumped.viewState).toEqual(before.viewState);
	await expect(page.getByRole('status', {name: 'Status messages'})).toHaveText(
		'Jumped to Angle 20°',
	);
	const labelColor = async (label: string) =>
		entry(page, label)
			.locator('span[title]')
			.evaluate((element) => getComputedStyle(element).color);
	expect(await labelColor('Angle 50°')).not.toBe(
		await labelColor('Add Pixel sort'),
	);

	await commitAngles(page, [77]);
	await expectRows(
		page,
		['Angle 77°', 'Angle 20°', 'Add Pixel sort', 'Initial'],
		'Angle 77°',
	);
	expect(await readProject(page)).toMatchObject({head: 3, max: 3});
});

test('the open list follows undo, redo, and commits', async ({page}) => {
	await seedHistory(page);
	await openHistoryTab(page);
	const toolbar = page.getByRole('toolbar', {name: 'Editor actions'});

	await toolbar.getByRole('button', {name: /^Undo/}).click();
	await expectRows(page, FIVE_COMMITS, 'Angle 40°', ['Angle 50°']);

	await toolbar.getByRole('button', {name: /^Redo/}).click();
	await expectRows(page, FIVE_COMMITS, 'Angle 50°');

	await commitAngles(page, [60]);
	await expectRows(page, ['Angle 60°', ...FIVE_COMMITS], 'Angle 60°');
});

test('AC-F23.4: reload restores the full list and the current position', async ({
	page,
}) => {
	await seedHistory(page);
	await openHistoryTab(page);
	await entry(page, 'Angle 30°').click();
	const redo = ['Angle 50°', 'Angle 40°'];
	await expectRows(page, FIVE_COMMITS, 'Angle 30°', redo);

	await page.reload();
	await openHistoryTab(page);
	await expectRows(page, FIVE_COMMITS, 'Angle 30°', redo);
	expect(await readProject(page)).toMatchObject({head: 3, max: 5, angle: 30});
});

test('AC-F23.5: after 205 commits the panel shows 201 entries', async ({
	page,
}) => {
	await page.goto('/');
	await importSyntheticProject(page, 'History cap');
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		await booted.bundle.store.getState().addEffect('pixelSort');
	});
	await openHistoryTab(page);
	await commitAngles(
		page,
		Array.from({length: 204}, (_, index) => index + 1),
	);

	const rows = historyList(page).getByRole('button');
	await expect(rows).toHaveCount(201);
	await expect(rows.first()).toContainText('Angle 204°');
	// Commits 1 to 4 fell off; commit 5 is the oldest state still reachable.
	await expect(rows.last()).toContainText('Angle 4°');

	await rows.last().click();
	await expect(rows.last()).toHaveAttribute('aria-current', 'step');
	await expect(page.getByRole('button', {name: /^Undo/})).toBeDisabled();
});

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`AC-F23.6: keyboard jumps at ${viewport.name} in ${theme} without overflow or a11y violations @a11y`, async ({
			page,
			browserName,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await page.emulateMedia({colorScheme: theme});
			await page.addInitScript((stored) => {
				globalThis.localStorage.setItem('drift:theme', stored);
			}, theme);
			await page.setViewportSize(viewport);
			await seedHistory(page);
			// A label far wider than any column has to truncate.
			await page.evaluate(async () => {
				const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
				const booted = await runtime!.ready;
				if (booted.status !== 'ready') {
					throw new Error('Not ready');
				}

				const {store} = booted.bundle;
				const instanceId =
					store.getState().activeProject!.stack.instances[0].id;
				await store
					.getState()
					.commitParam(
						instanceId,
						'angle',
						60,
						`Apply preset ${'A very long preset name '.repeat(6)}`,
					);
				await store.getState().undo();
			});

			const long = `Apply preset ${'A very long preset name '.repeat(6)}`;
			const labels = [long, ...FIVE_COMMITS];
			if (viewport.name === 'phone') {
				await page.getByRole('button', {name: 'History', exact: true}).focus();
				await page.keyboard.press('Enter');
				await expect(page.getByRole('dialog', {name: 'History'})).toBeVisible();
			} else {
				await page.getByRole('tab', {name: 'Stack'}).focus();
				await page.keyboard.press('ArrowRight');
				// Radix moves the roving focus after the key event.
				await expect(page.getByRole('tab', {name: 'History'})).toBeFocused();
				await page.keyboard.press('Tab');
				await expect(
					historyList(page).getByRole('button').first(),
				).toBeFocused();
			}

			await expectRows(page, labels, 'Angle 50°', [long]);

			// Tab to an older row and jump with Enter, then to another with Space.
			await entry(page, 'Angle 40°').focus();
			await page.keyboard.press('Shift+Tab');
			await expect(entry(page, 'Angle 50°')).toBeFocused();
			await page.keyboard.press('Tab');
			await page.keyboard.press('Enter');
			await expectRows(page, labels, 'Angle 40°', [long, 'Angle 50°']);
			await expect(entry(page, 'Angle 40°')).toBeFocused();
			await page.keyboard.press('Tab');
			await page.keyboard.press('Space');
			await expectRows(page, labels, 'Angle 30°', [
				long,
				'Angle 50°',
				'Angle 40°',
			]);

			const overflow = await historyList(page).evaluate((list) => {
				const bounds = list.getBoundingClientRect();
				return {
					page: document.documentElement.scrollWidth - globalThis.innerWidth,
					list: list.scrollWidth - list.clientWidth,
					rows: [...list.querySelectorAll('button, time')].filter(
						(element) =>
							element.getBoundingClientRect().right > bounds.right + 0.5,
					).length,
					right: bounds.right - globalThis.innerWidth,
				};
			});
			expect(overflow.page).toBeLessThanOrEqual(0);
			expect(overflow.list).toBeLessThanOrEqual(0);
			expect(overflow.rows).toBe(0);
			expect(overflow.right).toBeLessThanOrEqual(0);

			await assertNoA11yViolations(page);

			if (
				process.env.CAPTURE_HISTORY_PROOF === '1' &&
				browserName === 'chromium'
			) {
				const outDir = join(process.cwd(), '.proof', 'history');
				await mkdir(outDir, {recursive: true});
				await page.screenshot({
					path: join(outDir, `${viewport.name}-${theme}.png`),
					animations: 'disabled',
				});
			}

			if (viewport.name === 'phone') {
				await page.keyboard.press('Escape');
				await expect(page.getByRole('dialog')).toHaveCount(0);
				await expect(
					page.getByRole('button', {name: 'History', exact: true}),
				).toBeFocused();
			}

			expect(consoleErrors).toEqual([]);
		});
	}
}
