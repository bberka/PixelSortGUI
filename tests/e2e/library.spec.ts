import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {startDistServer, waitForServiceWorkerControl} from './dist-server.ts';
import {seedLibraryProjects, seedProjectWithHistory} from './library-seed.ts';
import {PROOF_VIEWPORTS, type ProofViewport} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

const THEMES = [
	{name: 'light', media: 'light', stored: 'light'},
	{name: 'dark', media: 'dark', stored: 'dark'},
] as const;

type ThemeCase = (typeof THEMES)[number];

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

async function openInTheme(
	page: Page,
	theme: ThemeCase,
	viewport?: ProofViewport,
): Promise<void> {
	await page.emulateMedia({colorScheme: theme.media});
	await page.addInitScript((value) => {
		globalThis.localStorage.setItem('drift:theme', value);
	}, theme.stored);

	if (viewport) {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
	}

	await page.goto('/');
}

async function expectNoHorizontalScroll(
	page: Page,
	viewport: ProofViewport,
): Promise<void> {
	const metrics = await page.evaluate(() => ({
		scrollWidth: globalThis.document.documentElement.scrollWidth,
		innerWidth: globalThis.innerWidth,
	}));

	expect(
		metrics.scrollWidth,
		`Expected no horizontal page scroll at ${viewport.width}x${viewport.height}`,
	).toBeLessThanOrEqual(metrics.innerWidth);
}

// Toasts are list items too, so count only the items that open a project.
function libraryCards(page: Page) {
	return page.getByRole('listitem').filter({
		has: page.locator('button[aria-label^="Open "]'),
	});
}

function cardNames(page: Page) {
	return libraryCards(page).locator('button[aria-label^="Open "]');
}

function columnCount(page: Page): Promise<number> {
	return page.evaluate(() => {
		const list = globalThis.document.querySelector('ul');
		if (!list) {
			throw new Error('No project grid');
		}

		return globalThis
			.getComputedStyle(list)
			.getPropertyValue('grid-template-columns')
			.split(' ')
			.filter((value) => value.length > 0).length;
	});
}

const status = (page: Page) =>
	page.getByRole('status', {name: 'Status messages'});

async function openCardMenu(page: Page, name: string): Promise<void> {
	await page.getByRole('button', {name: `Actions for ${name}`}).click();
}

test('the empty library shows the heading, the note and the import action', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await page.goto('/');

	await expect(
		page.getByRole('heading', {
			level: 2,
			name: 'Glitch art and pixel sorting for your photos',
		}),
	).toBeVisible();
	await expect(page.getByText('Images stay on this device.')).toBeVisible();
	await expect(page.getByRole('button', {name: 'Open images'})).toBeEnabled();
	await expect(libraryCards(page)).toHaveCount(0);
	expect(consoleErrors, 'Console errors').toEqual([]);
});

test('cards show the result thumbnail, name, dimensions and opened date, newest first', async ({
	page,
}) => {
	await page.goto('/');
	const ids = await seedLibraryProjects(page, ['Alpha', 'Beta', 'Gamma']);
	// A thumbnail is written after its card mounts, so remount the grid to read
	// the stored thumbnails, as returning from the editor does.
	await page.reload();

	await expect(libraryCards(page)).toHaveCount(3);
	await expect(cardNames(page)).toHaveText(['Gamma', 'Beta', 'Alpha']);

	const first = libraryCards(page).first();
	await expect(first).toContainText('64 × 48 px');
	await expect(first).toContainText('Today');
	const thumbnail = first.locator('img');
	await expect(thumbnail).toHaveAttribute('src', /^blob:/);
	expect(
		await thumbnail.evaluate(
			(image) => (image as HTMLImageElement).naturalWidth,
		),
	).toBe(160);

	// Opening one project moves it to the front of the default order.
	await page.evaluate(async (projectId) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error('Expected a ready boot');
		}

		await booted.bundle.store.getState().openProject(projectId);
		await booted.bundle.store.getState().closeProject();
	}, ids[0]);

	await expect(cardNames(page)).toHaveText(['Alpha', 'Gamma', 'Beta']);
});

test('the update toast is not counted as a library card', async ({page}) => {
	const server = await startDistServer();
	try {
		await page.goto(server.url);
		await waitForServiceWorkerControl(page);
		await seedLibraryProjects(page, ['Alpha', 'Beta']);
		await expect(libraryCards(page)).toHaveCount(2);

		server.setSwVersion(2);
		await page.evaluate(() => {
			globalThis.dispatchEvent(new Event('focus'));
		});
		await expect(
			page.getByRole('button', {name: 'Reload to update'}),
		).toBeVisible({timeout: 10_000});

		await expect(page.getByRole('listitem')).toHaveCount(3);
		await expect(libraryCards(page)).toHaveCount(2);
		await expect(cardNames(page)).toHaveText(['Beta', 'Alpha']);
	} finally {
		await server.close();
	}
});

test('clicking a card opens the project in the editor', async ({page}) => {
	await page.goto('/');
	const [projectId] = await seedLibraryProjects(page, ['Alpha']);

	await page.getByRole('button', {name: 'Open Alpha'}).click();

	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
	expect(new URL(page.url()).hash).toBe(`#/p/${projectId}`);
});

test('the card menu offers Open, Rename, Duplicate, Save and Delete', async ({
	page,
}) => {
	await page.goto('/');
	await seedLibraryProjects(page, ['Alpha']);

	await openCardMenu(page, 'Alpha');

	await expect(page.getByRole('menuitem')).toHaveText([
		'Open',
		'Rename',
		'Duplicate',
		'Save project file',
		'Delete',
	]);
});

test('rename trims the name, announces it and survives a reload', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await page.goto('/');
	await seedLibraryProjects(page, ['Alpha']);

	await openCardMenu(page, 'Alpha');
	await page.getByRole('menuitem', {name: 'Rename'}).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('textbox', {name: 'Name'})).toHaveValue(
		'Alpha',
	);

	await dialog.getByRole('textbox', {name: 'Name'}).fill('  Sunset horizon  ');
	await dialog.getByRole('button', {name: 'Rename'}).click();

	await expect(dialog).toHaveCount(0);
	await expect(
		page.getByRole('button', {name: 'Open Sunset horizon'}),
	).toBeVisible();
	await expect(status(page)).toHaveText('Renamed to Sunset horizon');
	expect(consoleErrors, 'Console errors').toEqual([]);

	await page.reload();
	await expect(
		page.getByRole('button', {name: 'Open Sunset horizon'}),
	).toBeVisible();
});

test('rename keeps the dialog open and rejects an empty name', async ({
	page,
}) => {
	await page.goto('/');
	await seedLibraryProjects(page, ['Alpha']);

	await openCardMenu(page, 'Alpha');
	await page.getByRole('menuitem', {name: 'Rename'}).click();
	const dialog = page.getByRole('dialog');
	const input = dialog.getByRole('textbox', {name: 'Name'});

	await input.fill(' '.repeat(3));
	await dialog.getByRole('button', {name: 'Rename'}).click();

	await expect(dialog.getByRole('alert')).toHaveText(
		'Enter a name between 1 and 120 characters.',
	);
	await expect(dialog).toBeVisible();

	await dialog.getByRole('button', {name: 'Cancel'}).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole('button', {name: 'Open Alpha'})).toBeVisible();
});

test('duplicate creates "<name> copy" with the same stack and its own edits', async ({
	page,
}) => {
	await page.goto('/');
	const {id, historyCount} = await seedProjectWithHistory(page, 'Portrait');
	await expect(page.getByRole('button', {name: 'Open Portrait'})).toBeVisible();

	await openCardMenu(page, 'Portrait');
	await page.getByRole('menuitem', {name: 'Duplicate'}).click();

	await expect(
		page.getByRole('button', {name: 'Open Portrait copy'}),
	).toBeVisible();
	await expect(status(page)).toHaveText('Duplicated Portrait copy');

	await page.getByRole('button', {name: 'Open Portrait copy'}).click();
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();

	const result = await page.evaluate(async (originalId) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error('Expected a ready boot');
		}

		const {store, repository} = booted.bundle;
		const state = store.getState();
		const copy = state.activeProject;
		const original = state.projects.find((item) => item.id === originalId);
		if (!copy || !original) {
			throw new Error('Expected the copy to be open and the original listed');
		}

		const copyHistory = await repository.getHistory(copy.id);
		// Editing the copy must not touch the original.
		await store.getState().addEffect('channelShift');
		const originalAfter = await repository.getProject(originalId);

		return {
			copyName: copy.name,
			sameStackParams:
				JSON.stringify(
					copy.stack.instances.map((instance) => instance.params),
				) ===
				JSON.stringify(
					original.stack.instances.map((instance) => instance.params),
				),
			copyHistoryCount: copyHistory.length,
			originalStackAfter:
				originalAfter?.stack.instances.map((instance) => instance.type) ?? [],
		};
	}, id);

	expect(result.copyName).toBe('Portrait copy');
	expect(result.sameStackParams).toBe(true);
	expect(result.copyHistoryCount).toBe(historyCount);
	expect(result.originalStackAfter).toEqual(['pixelSort']);
});

test('delete asks with the exact wording, cancels, then removes the project', async ({
	page,
}) => {
	await page.goto('/');
	await seedLibraryProjects(page, ['Alpha', 'Beta']);
	const betaSource = await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error('Expected a ready boot');
		}

		const projects = await booted.bundle.repository.listProjects();
		return (
			projects.find((project) => project.name === 'Beta')?.sourceHash ?? null
		);
	});
	expect(betaSource).not.toBeNull();

	await openCardMenu(page, 'Beta');
	await page.getByRole('menuitem', {name: 'Delete'}).click();
	const confirm = page.getByRole('alertdialog');
	await expect(confirm).toContainText(
		'Delete Beta? This removes it from this device.',
	);

	await confirm.getByRole('button', {name: 'Cancel'}).click();
	await expect(confirm).toHaveCount(0);
	await expect(page.getByRole('button', {name: 'Open Beta'})).toBeVisible();

	await openCardMenu(page, 'Beta');
	await page.getByRole('menuitem', {name: 'Delete'}).click();
	await page
		.getByRole('alertdialog')
		.getByRole('button', {name: 'Delete'})
		.click();

	await expect(page.getByRole('button', {name: 'Open Beta'})).toHaveCount(0);
	await expect(cardNames(page)).toHaveText(['Alpha']);
	await expect(status(page)).toHaveText('Deleted Beta');
	await expect(page.getByRole('button', {name: 'Open Alpha'})).toBeFocused();

	const remaining = await page.evaluate(async (sourceHash) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error('Expected a ready boot');
		}

		const {repository} = booted.bundle;
		const projects = await repository.listProjects();
		return {
			projectCount: projects.length,
			sourceStillStored: (await repository.getSource(sourceHash)) !== undefined,
		};
	}, betaSource!);
	expect(remaining.projectCount).toBe(1);
	// No other project uses the source image, so deleting the project frees it.
	expect(remaining.sourceStillStored).toBe(false);

	await page.reload();
	await expect(page.getByRole('button', {name: 'Open Beta'})).toHaveCount(0);
	await expect(page.getByRole('button', {name: 'Open Alpha'})).toBeVisible();
});

test('the last card action keeps working from the keyboard', async ({page}) => {
	await page.goto('/');
	await seedLibraryProjects(page, ['Alpha', 'Beta']);

	await page.getByRole('button', {name: 'Open Alpha'}).focus();
	await page.keyboard.press('Enter');
	await expect(
		page.getByRole('region', {name: 'Canvas', exact: true}),
	).toBeVisible();
	await page.getByRole('button', {name: 'Back to library'}).click();
	await expect(page.getByRole('button', {name: 'Open Alpha'})).toBeVisible();

	await page.getByRole('button', {name: 'Actions for Alpha'}).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('menuitem', {name: 'Open'})).toBeFocused();
	for (const name of ['Rename', 'Duplicate', 'Save project file', 'Delete']) {
		await page.keyboard.press('ArrowDown');
		// Each step waits for the menu to move focus before the next key arrives.
		await expect(page.getByRole('menuitem', {name})).toBeFocused();
	}

	await page.keyboard.press('Escape');
	await expect(page.getByRole('menuitem')).toHaveCount(0);
	await expect(
		page.getByRole('button', {name: 'Actions for Alpha'}),
	).toBeFocused();
});

test('100 projects scroll smoothly and decode thumbnails only in view', async ({
	page,
	browserName,
}, testInfo) => {
	await page.goto('/');
	const names = Array.from({length: 100}, (_, index) => `Project ${index}`);
	await seedLibraryProjects(page, names);

	await page.addInitScript(() => {
		const urls = {created: 0, revoked: 0};
		const create = URL.createObjectURL.bind(URL);
		const revoke = URL.revokeObjectURL.bind(URL);
		URL.createObjectURL = (object: Blob | MediaSource) => {
			urls.created += 1;
			return create(object);
		};

		URL.revokeObjectURL = (url: string) => {
			urls.revoked += 1;
			revoke(url);
		};

		Object.defineProperty(globalThis, '__thumbnailUrls', {
			value: urls,
			configurable: true,
		});
	});
	await page.reload();
	await expect(libraryCards(page)).toHaveCount(100);

	const measure = () =>
		page.evaluate(() => {
			const urls = (
				globalThis as unknown as {
					__thumbnailUrls?: {created: number; revoked: number};
				}
			).__thumbnailUrls;
			const {memory} = (
				globalThis as unknown as {
					performance: Performance & {memory?: {usedJSHeapSize: number}};
				}
			).performance;
			return {
				imagesInDom:
					globalThis.document.querySelectorAll('img[src^="blob:"]').length,
				created: urls?.created ?? 0,
				revoked: urls?.revoked ?? 0,
				usedHeapMb: memory
					? Math.round(memory.usedJSHeapSize / 1_048_576)
					: null,
			};
		});

	const before = await measure();
	expect(before.imagesInDom).toBeLessThan(40);
	expect(before.revoked).toBe(0);
	await expect(libraryCards(page).last().locator('img')).toHaveCount(0);

	const lastCardThumbnail = libraryCards(page).last().locator('img');

	const scrollStats = await page.evaluate(async () => {
		const scroller = globalThis.document
			.querySelector('ul')
			?.closest('[data-slot="scroll-area-viewport"]');
		if (!scroller) {
			throw new Error('No scroll container');
		}

		const frameTimes: number[] = [];
		let previous = performance.now();
		let scrolled = 0;
		const maxScroll = scroller.scrollHeight - scroller.clientHeight;
		await new Promise<void>((resolve) => {
			const step = () => {
				previous = performance.now();
				scrolled = Math.min(maxScroll, scrolled + 220);
				scroller.scrollTop = scrolled;
				globalThis.requestAnimationFrame(() => {
					frameTimes.push(performance.now() - previous);
					if (scrolled < maxScroll) {
						globalThis.requestAnimationFrame(step);
					} else {
						resolve();
					}
				});
			};

			step();
		});

		return {
			frames: frameTimes.length,
			maxFrameMs: Math.round(Math.max(...frameTimes)),
			droppedFrames: frameTimes.filter((time) => time > 32).length,
		};
	});

	await expect(lastCardThumbnail).toHaveAttribute('src', /^blob:/);
	const after = await measure();
	expect(after.revoked).toBeGreaterThan(0);
	expect(after.imagesInDom).toBeLessThan(40);

	const nearBottom = await page.evaluate(() => {
		const scroller = globalThis.document
			.querySelector('ul')
			?.closest('[data-slot="scroll-area-viewport"]');
		return scroller
			? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
			: 0;
	});
	expect(nearBottom).toBeLessThanOrEqual(2);

	await page.evaluate(() => {
		const cards = globalThis.document.querySelectorAll('ul > li');
		cards[0]?.scrollIntoView();
	});
	await expect(libraryCards(page).first().locator('img')).toHaveAttribute(
		'src',
		/^blob:/,
	);

	const report = [
		`browser: ${browserName}`,
		`before scroll: ${JSON.stringify(before)}`,
		`after scroll: ${JSON.stringify(after)}`,
		`scroll frames: ${scrollStats.frames}, max ${scrollStats.maxFrameMs} ms, ${scrollStats.droppedFrames} over 32 ms`,
	].join('\n');
	console.log(report);
	await testInfo.attach('lazy-thumbnail-report.txt', {
		body: report,
		contentType: 'text/plain',
	});
});

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`library grid has no a11y violations or horizontal scroll in ${theme.name} at ${viewport.name} @a11y`, async ({
			page,
		}, testInfo) => {
			const consoleErrors = collectConsoleErrors(page);
			await openInTheme(page, theme, viewport);
			await seedLibraryProjects(page, ['One', 'Two', 'Three', 'Four', 'Five']);
			await expect(libraryCards(page)).toHaveCount(5);

			await expectNoHorizontalScroll(page, viewport);
			await assertNoA11yViolations(page);

			const columns = await columnCount(page);
			const expected =
				viewport.name === 'phone' ? 2 : viewport.name === 'tablet' ? 3 : null;
			if (expected === null) {
				expect(columns).toBeGreaterThanOrEqual(4);
			} else {
				expect(columns, `columns at ${viewport.name}`).toBe(expected);
			}

			await page.screenshot({
				path: testInfo.outputPath(`library-${viewport.name}-${theme.name}.png`),
				fullPage: false,
			});
			expect(consoleErrors, 'Console errors').toEqual([]);
		});
	}
}

const DIALOG_CASES = [
	{viewport: PROOF_VIEWPORTS[0], theme: THEMES[0]},
	{viewport: PROOF_VIEWPORTS[1], theme: THEMES[0]},
	{viewport: PROOF_VIEWPORTS[2], theme: THEMES[0]},
	{viewport: PROOF_VIEWPORTS[2], theme: THEMES[1]},
];

for (const {viewport, theme} of DIALOG_CASES) {
	test(`library menus and dialogs have no a11y violations in ${theme.name} at ${viewport.name} @a11y`, async ({
		page,
	}) => {
		await openInTheme(page, theme, viewport);
		await seedLibraryProjects(page, ['Alpha']);

		// The Radix modal menu marks the rest of the app `aria-hidden` while it
		// is open, so audit the menu itself, which is what this state adds.
		await openCardMenu(page, 'Alpha');
		await assertNoA11yViolations(page, {
			include: ['[data-slot="dropdown-menu-content"]'],
		});

		await page.getByRole('menuitem', {name: 'Rename'}).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await assertNoA11yViolations(page);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);

		await openCardMenu(page, 'Alpha');
		await page.getByRole('menuitem', {name: 'Delete'}).click();
		await expect(page.getByRole('alertdialog')).toBeVisible();
		await assertNoA11yViolations(page);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expectNoHorizontalScroll(page, viewport);
	});
}
