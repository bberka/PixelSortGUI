import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';
import type {EffectInstance} from '../../src/engine/types.ts';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';
import {PROOF_VIEWPORTS, type ProofViewport} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

type StackSnapshot = {
	instances: EffectInstance[];
	selectedInstanceId: string | null;
	historyHeadSeq: number;
	historyLength: number;
};

const THEMES = [
	{name: 'light', media: 'light', stored: 'light'},
	{name: 'dark', media: 'dark', stored: 'dark'},
] as const;

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

async function seedStack(
	page: Page,
	types: readonly string[],
	name = 'Stack proof',
): Promise<string> {
	await page.goto('/');
	const projectId = await importSyntheticProject(page, name);
	await page.evaluate(async (list) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const {store} = booted.bundle;
		for (const type of list) {
			await store.getState().addEffect(type);
		}
	}, types);
	return projectId;
}

async function readStack(page: Page): Promise<StackSnapshot> {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const {store} = booted.bundle;
		const state = store.getState();
		const project = state.activeProject;
		if (!project) {
			throw new Error('No active project');
		}

		return {
			instances: project.stack.instances,
			selectedInstanceId: project.selectedInstanceId,
			historyHeadSeq: project.historyHeadSeq,
			historyLength: state.history.length,
		};
	});
}

async function undo(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		await booted.bundle.store.getState().undo();
	});
}

function stackRows(page: Page) {
	return page.getByRole('listitem');
}

function rowTexts(page: Page): Promise<string[]> {
	return stackRows(page).allTextContents();
}

async function openRowMenu(page: Page, index: number): Promise<void> {
	await page
		.getByRole('button', {name: /actions$/})
		.nth(index)
		.click();
}

async function dragRowOnto(
	page: Page,
	from: number,
	to: number,
): Promise<void> {
	const handle = page.locator('[data-drag-handle]').nth(from);
	const target = stackRows(page).nth(to);
	const handleBox = await handle.boundingBox();
	const targetBox = await target.boundingBox();
	if (!handleBox || !targetBox) {
		throw new Error('Rows must have a layout box to drag');
	}

	await page.mouse.move(
		handleBox.x + handleBox.width / 2,
		handleBox.y + handleBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		handleBox.x + handleBox.width / 2,
		targetBox.y + targetBox.height / 2,
		{steps: 8},
	);
	await page.mouse.up();
}

test('a project without effects shows the empty stack and the add trigger', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedStack(page, []);

	await expect(page.getByText('No effects yet')).toBeVisible();
	await expect(page.getByRole('button', {name: 'Add effect'})).toBeEnabled();
	await expect(stackRows(page)).toHaveCount(0);
	expect(consoleErrors).toEqual([]);
});

test('Add effect lists every registered effect with its label and description, then appends and selects the chosen one', async ({
	page,
}) => {
	await seedStack(page, []);
	await page.getByRole('button', {name: 'Add effect'}).click();

	const chooser = page.getByRole('dialog', {name: 'Add effect'});
	await expect(chooser).toBeVisible();
	await expect(chooser.getByText('Pixel sort')).toBeVisible();
	await expect(
		chooser.getByText(
			'Sort runs of pixels along a direction by brightness, hue or a channel.',
		),
	).toBeVisible();
	await expect(chooser.getByText('Channel shift')).toBeVisible();
	await expect(
		chooser.getByText('Offset the red, green and blue channels.'),
	).toBeVisible();

	await chooser.getByRole('button', {name: /^Channel shift/}).click();

	await expect(stackRows(page)).toHaveCount(1);
	await expect(stackRows(page).first()).toContainText('Channel shift');
	const snapshot = await readStack(page);
	expect(snapshot.instances.map((instance) => instance.type)).toEqual([
		'channelShift',
	]);
	expect(snapshot.instances[0].enabled).toBe(true);
	expect(snapshot.instances[0].mix).toBe(1);
	expect(snapshot.instances[0].blend).toBe('normal');
	expect(snapshot.selectedInstanceId).toBe(snapshot.instances[0].id);
	await expect(
		stackRows(page).first().locator('button[aria-current="true"]'),
	).toHaveCount(1);
});

test('switching an instance off shows the Off icon and text and stores it disabled', async ({
	page,
}) => {
	await seedStack(page, ['pixelSort']);
	const toggle = page.getByRole('switch', {name: 'Pixel sort'});
	await expect(toggle).toHaveAttribute('aria-checked', 'true');

	const before = await readStack(page);
	await toggle.click();

	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	const row = stackRows(page).first();
	await expect(row.getByText('Off', {exact: true})).toBeVisible();
	await expect(row.locator('[data-slot="badge"] svg')).toHaveCount(1);
	const after = await readStack(page);
	expect(after.instances[0].enabled).toBe(false);
	expect(after.historyHeadSeq).toBe(before.historyHeadSeq + 1);
});

test('the row menu moves an instance down as one commit', async ({page}) => {
	await seedStack(page, ['pixelSort', 'channelShift']);
	const before = await readStack(page);
	expect(await rowTexts(page)).toEqual(['Pixel sort', 'Channel shift']);

	await openRowMenu(page, 0);
	await expect(page.getByRole('menuitem', {name: /^Move up/})).toBeDisabled();
	await page.getByRole('menuitem', {name: /^Move down/}).click();

	await expect
		.poll(() => rowTexts(page))
		.toEqual(['Channel shift', 'Pixel sort']);
	const after = await readStack(page);
	expect(after.instances.map((instance) => instance.id)).toEqual([
		before.instances[1].id,
		before.instances[0].id,
	]);
	expect(after.historyHeadSeq).toBe(before.historyHeadSeq + 1);
	await expect(page.getByRole('status', {name: 'Status messages'})).toHaveText(
		'Moved Pixel sort to position 2 of 2',
	);
});

test('Alt+Arrow reorders the focused row as one commit and announces it', async ({
	page,
}) => {
	await seedStack(page, ['pixelSort', 'channelShift']);
	const before = await readStack(page);

	await stackRows(page).nth(1).locator('button[aria-current]').focus();
	await page.keyboard.press('Alt+ArrowUp');

	await expect
		.poll(() => rowTexts(page))
		.toEqual(['Channel shift', 'Pixel sort']);
	const after = await readStack(page);
	expect(after.instances.map((instance) => instance.id)).toEqual([
		before.instances[1].id,
		before.instances[0].id,
	]);
	expect(after.historyHeadSeq).toBe(before.historyHeadSeq + 1);
	await expect(page.getByRole('status', {name: 'Status messages'})).toHaveText(
		'Moved Channel shift to position 1 of 2',
	);
});

test('dragging the grip reorders the stack', async ({page}) => {
	await seedStack(page, ['pixelSort', 'channelShift', 'pixelSort']);
	const before = await readStack(page);
	expect(await rowTexts(page)).toEqual([
		'Pixel sort',
		'Channel shift',
		'Pixel sort',
	]);

	await dragRowOnto(page, 1, 0);

	await expect
		.poll(async () => {
			const snapshot = await readStack(page);
			return snapshot.instances.map((instance) => instance.id);
		})
		.toEqual([
			before.instances[1].id,
			before.instances[0].id,
			before.instances[2].id,
		]);
	const after = await readStack(page);
	expect(after.historyHeadSeq).toBe(before.historyHeadSeq + 1);
});

test('Duplicate inserts a copy directly below with the same parameters and selects it', async ({
	page,
}) => {
	await seedStack(page, ['pixelSort', 'channelShift']);
	const before = await readStack(page);
	const original = before.instances[0];

	await openRowMenu(page, 0);
	await page.getByRole('menuitem', {name: 'Duplicate'}).click();

	await expect
		.poll(() => rowTexts(page))
		.toEqual(['Pixel sort', 'Pixel sort', 'Channel shift']);
	const after = await readStack(page);
	expect(after.instances).toHaveLength(3);
	expect(after.instances[0].id).toBe(original.id);
	expect(after.instances[1].id).not.toBe(original.id);
	expect(after.instances[1].type).toBe(original.type);
	expect(after.instances[1].params).toEqual(original.params);
	expect(after.instances[1].mix).toBe(original.mix);
	expect(after.instances[1].blend).toBe(original.blend);
	expect(after.selectedInstanceId).toBe(after.instances[1].id);
});

test('Remove is one commit and Undo restores the instance in place', async ({
	page,
}) => {
	await seedStack(page, ['pixelSort', 'channelShift', 'pixelSort']);
	const before = await readStack(page);
	const removed = before.instances[1];

	await openRowMenu(page, 1);
	await page.getByRole('menuitem', {name: 'Remove'}).click();

	await expect.poll(() => rowTexts(page)).toEqual(['Pixel sort', 'Pixel sort']);
	const afterRemove = await readStack(page);
	expect(afterRemove.instances.map((instance) => instance.id)).toEqual([
		before.instances[0].id,
		before.instances[2].id,
	]);
	expect(afterRemove.historyHeadSeq).toBe(before.historyHeadSeq + 1);

	await undo(page);

	await expect
		.poll(() => rowTexts(page))
		.toEqual(['Pixel sort', 'Channel shift', 'Pixel sort']);
	const restored = await readStack(page);
	expect(restored.instances.map((instance) => instance.id)).toEqual(
		before.instances.map((instance) => instance.id),
	);
	expect(restored.instances[1]).toEqual(removed);
});

test('an unknown effect type is shown as an unsupported row, kept when saved, and removable', async ({
	page,
}) => {
	const projectId = await seedStack(page, ['pixelSort']);
	const unknown = {
		id: 'future01',
		type: 'futureEffect',
		version: 7,
		enabled: true,
		params: {},
		mix: 1,
		blend: 'normal',
	} as const;
	await page.evaluate(async (instance) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const {store, repository} = booted.bundle;
		const project = store.getState().activeProject;
		if (!project) {
			throw new Error('No active project');
		}

		await repository.saveProjectStack(project.id, {
			schemaVersion: 1,
			instances: [...project.stack.instances, instance],
		});
		await store.getState().openProject(project.id);
	}, unknown);

	const unsupported = stackRows(page).nth(1);
	await expect(unsupported).toContainText(
		'Unsupported effect (futureEffect v7)',
	);
	expect(
		await unsupported.evaluate(
			(element) => globalThis.getComputedStyle(element).borderTopStyle,
		),
	).toBe('dashed');
	await expect(unsupported.getByRole('switch')).toHaveCount(0);
	await expect(unsupported.locator('button[aria-current]')).toHaveCount(0);

	await unsupported.getByRole('button', {name: /actions$/}).click();
	await expect(page.getByRole('menuitem')).toHaveText([
		/Move up/,
		/Move down/,
		'Remove',
	]);
	await page.keyboard.press('Escape');

	// A later commit keeps the unknown instance unchanged in storage.
	await page.getByRole('switch', {name: 'Pixel sort'}).click();
	const persisted = await page.evaluate(async (id) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const project = await booted.bundle.repository.getProject(id);
		return project?.stack.instances.at(-1) ?? null;
	}, projectId);
	expect(persisted).toEqual(unknown);

	await unsupported.getByRole('button', {name: /actions$/}).click();
	await page.getByRole('menuitem', {name: 'Remove'}).click();
	await expect(stackRows(page)).toHaveCount(1);
	await expect(stackRows(page).first()).toContainText('Pixel sort');
});

test('the add trigger is disabled and explained at the 32-instance limit', async ({
	page,
}) => {
	await seedStack(
		page,
		Array.from({length: 32}, () => 'pixelSort'),
	);
	await expect(stackRows(page)).toHaveCount(32);

	const add = page.getByRole('button', {name: 'Add effect'});
	await expect(add).toBeDisabled();
	await expect(page.getByText('32 effects maximum')).toBeVisible();
	await expect(add).toHaveAttribute('aria-describedby', 'stack-limit-note');
});

async function openEditorInTheme(
	page: Page,
	theme: (typeof THEMES)[number],
	viewport: ProofViewport,
): Promise<void> {
	await page.emulateMedia({colorScheme: theme.media});
	await page.addInitScript((stored) => {
		globalThis.localStorage.setItem('drift:theme', stored);
	}, theme.stored);
	await page.setViewportSize({width: viewport.width, height: viewport.height});
	await seedStack(page, ['pixelSort', 'channelShift', 'pixelSort']);
	await expect(stackRows(page)).toHaveCount(3);
}

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`effect stack follows the ${viewport.name} layout with no a11y violations in ${theme.name} @a11y`, async ({
			page,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await openEditorInTheme(page, theme, viewport);
			// A phone chip carries its switch only while selected.
			await stackRows(page)
				.nth(1)
				.getByRole('button', {name: 'Channel shift', exact: true})
				.click();
			await page.getByRole('switch', {name: 'Channel shift'}).click();
			await expect(
				stackRows(page).nth(1).getByText('Off', {exact: true}),
			).toBeVisible();

			const boxes = await Promise.all(
				[0, 1, 2].map(async (index) => {
					const box = await stackRows(page).nth(index).boundingBox();
					if (!box) {
						throw new Error(`Row ${index} has no layout box`);
					}

					return box;
				}),
			);
			const stacked = boxes[1].y > boxes[0].y && boxes[2].y > boxes[1].y;
			if (viewport.name === 'phone') {
				expect(stacked, 'phone rows form a horizontal strip').toBe(false);
				expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
				expect(boxes[2].x).toBeGreaterThan(boxes[1].x);
			} else {
				expect(stacked, `${viewport.name} rows form a vertical list`).toBe(
					true,
				);
			}

			await page.getByRole('button', {name: 'Add effect'}).click();
			const picker = page.locator(
				viewport.name === 'phone'
					? '[data-slot="dialog-content"]'
					: '[data-slot="popover-content"]',
			);
			await expect(
				picker,
				`${viewport.name} opens the add-effect picker as ${
					viewport.name === 'phone' ? 'a dialog' : 'a popover'
				}`,
			).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(picker).toHaveCount(0);

			const metrics = await page.evaluate(() => ({
				scrollWidth: globalThis.document.documentElement.scrollWidth,
				innerWidth: globalThis.innerWidth,
			}));
			expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
			await assertNoA11yViolations(page);
			expect(consoleErrors, 'Console errors').toEqual([]);
		});
	}
}
