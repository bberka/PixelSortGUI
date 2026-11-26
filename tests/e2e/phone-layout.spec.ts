/**
 The phone editor (DESIGN.md section 6.4) and the keyboard hint rule
 (section 8.4), under touch emulation and with a mouse.
 */
import {
	expect,
	test,
	type CDPSession,
	type Locator,
	type Page,
} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

const PHONE = {width: 390, height: 844};
const KEY_NAMES = /Ctrl|⌘|Shift\+|Alt\+/;
const TOOLS = [
	'Undo',
	'Redo',
	'Compare',
	'Split',
	'Transform',
	'Presets',
	'History',
];

const canvasRegion = (page: Page) =>
	page.locator('section[aria-label="Canvas"]');
const aside = (page: Page) => page.locator('aside[aria-label="Effects"]');
const toolbar = (page: Page) =>
	page.getByRole('toolbar', {name: 'Editor actions'});
const parameterTab = (page: Page, name: string) =>
	page
		.getByRole('tablist', {name: 'Parameters'})
		.getByRole('tab', {name, exact: true});

async function canvasShare(page: Page): Promise<number> {
	const box = await canvasRegion(page).boundingBox();
	return box!.height / page.viewportSize()!.height;
}

async function openEditor(page: Page): Promise<void> {
	await page.goto('/');
	await importSyntheticProject(page, 'Phone photo');
	await expect(page.locator('canvas')).toBeVisible();
}

async function addEffect(page: Page, name: string): Promise<void> {
	await page.getByRole('button', {name: 'Add effect'}).click();
	await page
		.getByRole('dialog', {name: 'Add effect'})
		.getByRole('button', {name: new RegExp(`^${name}`)})
		.click();
	await expect(
		page.getByRole('button', {name: `${name} actions`}),
	).toBeVisible();
}

async function readHistory(
	page: Page,
): Promise<{head: number; params: Record<string, unknown>}> {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const project = booted.bundle.store.getState().activeProject!;
		return {
			head: project.historyHeadSeq,
			params: project.stack.instances[0].params,
		};
	});
}

/**
 A real finger drag. `Input.synthesizeScrollGesture` does not scroll a nested
 scroll area in headless Chromium.
 */
async function swipe(
	session: CDPSession,
	from: {x: number; y: number},
	by: {x: number; y: number},
): Promise<void> {
	const steps = 10;
	await session.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [from],
	});
	for (let step = 1; step <= steps; step++) {
		await session.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [
				{
					x: from.x + (by.x * step) / steps,
					y: from.y + (by.y * step) / steps,
				},
			],
		});
	}

	await session.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	});
}

async function expectOnScreen(page: Page, control: Locator): Promise<void> {
	const box = (await control.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test.describe('on a touch phone', () => {
	test.skip(
		({browserName}) => browserName !== 'chromium',
		'Playwright emulates a coarse pointer in Chromium only',
	);
	test.use({viewport: PHONE, hasTouch: true, isMobile: true});

	test('AC-F18.4: the photo keeps half the screen while one control is edited', async ({
		page,
	}) => {
		await openEditor(page);
		await addEffect(page, 'Pixel sort');
		await expect(aside(page)).toHaveAttribute('data-controls', 'one');
		expect(await canvasShare(page)).toBeGreaterThanOrEqual(0.5);

		// One control at a time, and picking another never resizes the canvas.
		const angle = page.getByRole('slider', {name: 'Angle'});
		const low = page.getByRole('slider', {name: 'Threshold range low'});
		await expect(angle).toBeVisible();
		await expect(low).toHaveCount(0);
		const {height} = (await canvasRegion(page).boundingBox())!;
		for (const name of ['Threshold range', 'Mix', 'Blend', 'Angle']) {
			await parameterTab(page, name).tap();
			await expect(parameterTab(page, name)).toHaveAttribute(
				'aria-selected',
				'true',
			);
			expect((await canvasRegion(page).boundingBox())!.height).toBe(height);
		}

		// The control fits its area without scrolling.
		await expectOnScreen(page, angle);
		await expectOnScreen(page, page.getByRole('textbox', {name: 'Angle'}));

		await page.getByRole('button', {name: 'Split', exact: true}).tap();
		await expect(
			page.locator('[data-slot="split-side-switcher"]'),
		).toBeVisible();
		expect(await canvasShare(page)).toBeGreaterThanOrEqual(0.5);
		await page.getByRole('button', {name: 'Switch to top/bottom view'}).tap();
		await expect(page.getByRole('radio', {name: 'B · Bottom'})).toBeVisible();
		await assertNoA11yViolations(page);
	});

	test('all controls open from the button and the handle and leave 40% to the photo', async ({
		page,
	}) => {
		await openEditor(page);
		await addEffect(page, 'Pixel sort');

		await page.getByRole('button', {name: 'Show all controls'}).tap();
		await expect(aside(page)).toHaveAttribute('data-controls', 'all');
		await expect(page.getByRole('slider', {name: 'Angle'})).toBeVisible();
		await expect(
			page.getByRole('slider', {name: 'Threshold range low'}),
		).toBeAttached();
		await expect(
			page.getByRole('button', {name: 'Show one control'}),
		).toBeFocused();
		expect(await canvasShare(page)).toBeGreaterThanOrEqual(0.4);
		await assertNoA11yViolations(page);

		await page.getByRole('button', {name: 'Show one control'}).tap();
		await expect(aside(page)).toHaveAttribute('data-controls', 'one');

		const handle = page.locator('[data-slot="panel-handle"]');
		for (const [distance, state] of [
			[-60, 'all'],
			[60, 'one'],
		] as const) {
			const box = (await handle.boundingBox())!;
			const x = box.x + box.width / 2;
			const y = box.y + box.height / 2;
			await page.mouse.move(x, y);
			await page.mouse.down();
			await page.mouse.move(x, y + distance, {steps: 4});
			await page.mouse.up();
			await expect(aside(page)).toHaveAttribute('data-controls', state);
		}
	});

	test('AC-F18.5: every common action is one tap away and the selected effect stays in view', async ({
		page,
	}) => {
		await openEditor(page);
		// With nothing to edit the canvas takes the panel's room.
		await expect(page.locator('section[aria-label="Parameters"]')).toHaveCount(
			0,
		);
		await expect(page.getByRole('button', {name: 'Add effect'})).toHaveText(
			'Add effect',
		);

		for (const name of ['Pixel sort', 'Channel shift', 'Posterize']) {
			await addEffect(page, name);
		}

		const canvas = (await canvasRegion(page).boundingBox())!;
		for (const name of TOOLS) {
			const tool = toolbar(page).getByRole('button', {
				name: new RegExp(`^${name}`),
			});
			await expect(tool).toContainText(name);
			await expectOnScreen(page, tool);
			const box = (await tool.boundingBox())!;
			expect(box.width).toBeGreaterThanOrEqual(44);
			expect(box.height).toBeGreaterThanOrEqual(44);
			expect(box.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
		}

		await expectOnScreen(page, page.getByRole('button', {name: 'Add effect'}));
		// Only the selected chip carries its switch and menu.
		await expect(
			page.getByRole('button', {name: 'Posterize actions'}),
		).toBeInViewport({ratio: 1});
		await expect(page.getByRole('switch')).toHaveCount(1);

		await page.getByRole('button', {name: 'Pixel sort', exact: true}).tap();
		await expect(page.getByRole('switch', {name: 'Pixel sort'})).toBeInViewport(
			{ratio: 1},
		);
		await expect(page.getByRole('switch')).toHaveCount(1);

		await toolbar(page)
			.getByRole('button', {name: /^Undo Add Posterize/})
			.tap();
		await expect(
			page.getByRole('button', {name: 'Posterize', exact: true}),
		).toHaveCount(0);
	});

	test('AC-F18.6: a swipe up across a slider scrolls the panel and changes nothing', async ({
		page,
		context,
	}) => {
		await openEditor(page);
		await addEffect(page, 'Channel shift');
		await page.getByRole('button', {name: 'Show all controls'}).tap();

		const viewport = page
			.locator('section[aria-label="Parameters"]')
			.locator('[data-slot="scroll-area-viewport"]');
		const slider = page
			.locator('[data-slot="slider"]')
			.filter({has: page.getByRole('slider', {name: 'Red Y'})});
		const box = (await slider.boundingBox())!;
		const start = {x: box.x + box.width * 0.8, y: box.y + box.height / 2};
		const before = await readHistory(page);
		const session = await context.newCDPSession(page);
		await swipe(session, start, {x: 0, y: -150});

		await expect
			.poll(async () => viewport.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(50);
		expect(await readHistory(page)).toEqual(before);

		// A sideways drag on the same kind of slider still edits.
		// A tap during the swipe's momentum only stops the scroll.
		await expect(async () => {
			await page.getByRole('button', {name: 'Show one control'}).tap();
			await expect(aside(page)).toHaveAttribute('data-controls', 'one', {
				timeout: 500,
			});
		}).toPass();
		await parameterTab(page, 'Red X').tap();
		const redX = (await page
			.locator('[data-slot="slider"]')
			.filter({has: page.getByRole('slider', {name: 'Red X'})})
			.boundingBox())!;
		await swipe(
			session,
			{x: redX.x + redX.width * 0.5, y: redX.y + redX.height / 2},
			{x: 60, y: 0},
		);
		await expect
			.poll(async () => (await readHistory(page)).head)
			.toBe(before.head + 1);
		expect((await readHistory(page)).params.redX).not.toBe(before.params.redX);
	});

	test('Apply crop is on screen as soon as the Transform panel opens', async ({
		page,
	}) => {
		await openEditor(page);
		await toolbar(page).getByRole('button', {name: 'Transform'}).tap();
		await expect(page.getByRole('button', {name: 'Apply crop'})).toBeInViewport(
			{ratio: 1},
		);
		expect(await canvasShare(page)).toBeGreaterThanOrEqual(0.4);
	});

	test('phone landscape shows one whole control in the drawer', async ({
		page,
	}) => {
		await page.setViewportSize({width: 844, height: 390});
		await openEditor(page);
		await addEffect(page, 'Pixel sort');

		await expect(page.getByRole('slider', {name: 'Angle'})).toBeInViewport({
			ratio: 1,
		});
		await expect(page.getByRole('textbox', {name: 'Angle'})).toBeInViewport({
			ratio: 1,
		});
		const canvas = (await canvasRegion(page).boundingBox())!;
		expect(canvas.width / 844).toBeGreaterThanOrEqual(0.5);
		await page.getByRole('button', {name: 'Show all controls'}).tap();
		await expect(page.getByRole('button', {name: 'Reset all'})).toBeVisible();
		await assertNoA11yViolations(page);

		await toolbar(page).getByRole('button', {name: 'Transform'}).tap();
		await expect(page.getByRole('button', {name: 'Apply crop'})).toBeInViewport(
			{ratio: 1},
		);
	});

	test('AC-F18.7: nothing names a key on a touch screen', async ({page}) => {
		const noKeys = async () => {
			await expect(page.locator('kbd')).toHaveCount(0);
			await expect(page.locator('body')).not.toContainText(KEY_NAMES);
		};

		await page.goto('/');
		await expect(
			page.getByRole('button', {name: 'Try a sample'}),
		).toBeVisible();
		await noKeys();

		await openEditor(page);
		await addEffect(page, 'Pixel sort');
		await noKeys();

		await page.getByRole('button', {name: 'Pixel sort actions'}).tap();
		await expect(page.getByRole('menuitem', {name: 'Move left'})).toBeVisible();
		await noKeys();
		await page.keyboard.press('Escape');

		// Tooltips also open on focus, so a touch device can see them.
		for (const name of ['Guide', 'Split', 'Compare']) {
			const button = page.getByRole('button', {name, exact: true});
			await button.focus();
			await expect(page.getByRole('tooltip')).toBeVisible();
			await noKeys();
			await expect(page.getByRole('tooltip')).not.toContainText('(');
			await button.blur();
		}

		await page.getByRole('button', {name: 'Guide', exact: true}).tap();
		await expect(
			page.getByRole('heading', {name: 'Drift guide'}),
		).toBeVisible();
		await expect(
			page.getByRole('heading', {name: 'Keyboard shortcuts'}),
		).toHaveCount(0);
		await page.getByRole('button', {name: 'Contents'}).tap();
		await expect(
			page.getByRole('button', {name: 'Storage and privacy'}),
		).toBeVisible();
		await noKeys();
	});
});

test('AC-F18.7: with a mouse, keys appear in tooltips, menus and the guide only', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.getByRole('button', {name: 'Try a sample'})).toBeVisible();
	await expect(page.locator('kbd')).toHaveCount(0);

	await openEditor(page);
	await page.getByRole('button', {name: 'Add effect'}).click();
	await page.getByRole('button', {name: /^Pixel sort/}).click();
	for (const [name, keys] of [
		['Undo Add Pixel sort', /\((Ctrl\+Z|⌘Z)\)/],
		['Split', /\(S\)/],
		['Switch to top/bottom view', /\(Shift\+S\)/],
		['Compare', /\(\\, hold to peek\)/],
		['Guide', /\(\?\)/],
	] as const) {
		await page.getByRole('button', {name, exact: true}).hover();
		await expect(page.getByRole('tooltip')).toContainText(keys);
		await page.mouse.move(0, 0);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('tooltip')).toHaveCount(0);
	}

	await page.getByRole('button', {name: 'Pixel sort actions'}).click();
	await expect(page.getByRole('menuitem', {name: /Move up/})).toContainText(
		'Alt+Up',
	);
	await page.keyboard.press('Escape');

	await page.getByRole('button', {name: 'Guide', exact: true}).click();
	await expect(
		page.getByRole('heading', {name: 'Keyboard shortcuts'}),
	).toBeVisible();
	await expect(page.locator('kbd').first()).toBeAttached();
});
