import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import process from 'node:process';
import {expect, test, type Page} from '@playwright/test';
import type {EffectInstance} from '../../src/engine/types.ts';
import type {AppRuntime} from '../../src/state/index.ts';
import type {ViewState} from '../../src/storage/types.ts';
import {assertNoA11yViolations} from './axe.ts';
import {importSyntheticProject} from './seed.ts';
import {PROOF_VIEWPORTS, type ProofViewport} from './viewports.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

type EditorSnapshot = {
	instances: EffectInstance[];
	historyHeadSeq: number;
	historyMinSeq: number;
	historyMaxSeq: number;
	viewState: ViewState;
	theme: string;
	presetNames: string[];
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

async function readEditorState(page: Page): Promise<EditorSnapshot> {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const state = booted.bundle.store.getState();
		const project = state.activeProject;
		if (!project) {
			throw new Error('No active project');
		}

		return {
			instances: project.stack.instances,
			historyHeadSeq: project.historyHeadSeq,
			historyMinSeq: project.historyMinSeq,
			historyMaxSeq: project.historyMaxSeq,
			viewState: project.viewState,
			theme: state.theme,
			presetNames: state.presets.map((preset) => preset.name),
		};
	});
}

async function seedProjectWithEffects(
	page: Page,
	effects: readonly string[],
	name = 'Toolbar test',
): Promise<string> {
	await page.goto('/');
	const projectId = await importSyntheticProject(page, name);
	if (effects.length > 0) {
		await page.evaluate(async (types) => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			const booted = await runtime!.ready;
			if (booted.status !== 'ready') {
				throw new Error('Not ready');
			}

			for (const type of types) {
				await booted.bundle.store.getState().addEffect(type);
			}
		}, effects);
	}

	return projectId;
}

async function openPresets(page: Page): Promise<void> {
	await page.getByRole('button', {name: 'Presets'}).click();
	await expect(
		page.getByRole('list', {name: 'Built-in presets'}),
	).toBeVisible();
}

test('AC-F9.1 AC-F9.2: undo and redo buttons, shortcuts, tooltips, and exact parameter value restoration', async ({
	page,
}) => {
	const consoleErrors = collectConsoleErrors(page);
	await seedProjectWithEffects(page, ['pixelSort']);

	const undoButton = page.getByRole('button', {name: /^Undo/});
	const redoButton = page.getByRole('button', {name: /^Redo/});
	await expect(undoButton).toBeEnabled();
	await expect(undoButton).toHaveAccessibleName('Undo Add Pixel sort');
	await expect(redoButton).toBeDisabled();

	const angleInput = page.getByRole('textbox', {name: 'Angle'});
	await angleInput.fill('37.5');
	await angleInput.press('Enter');

	await expect(undoButton).toHaveAccessibleName('Undo Change Angle');
	await undoButton.hover();
	await expect(page.getByRole('tooltip')).toContainText('Undo Change Angle');
	await expect(page.getByRole('tooltip')).toContainText(/Ctrl\+Z|⌘Z/);

	// Click Undo button
	await undoButton.click();
	await expect(angleInput).toHaveValue('0.0');
	await expect(redoButton).toBeEnabled();
	await expect(redoButton).toHaveAccessibleName('Redo Change Angle');
	await expect(page.getByRole('status', {name: 'Status messages'})).toHaveText(
		'Undid Change Angle',
	);

	// Click Redo button
	await redoButton.click();
	await expect(angleInput).toHaveValue('37.5');
	await expect(page.getByRole('status', {name: 'Status messages'})).toHaveText(
		'Redid Change Angle',
	);

	// Keyboard shortcuts: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y
	await page.getByRole('region', {name: 'Canvas toolbar'}).click();
	await page.keyboard.press('Control+z');
	await expect(angleInput).toHaveValue('0.0');

	await page.keyboard.press('Control+Shift+Z');
	await expect(angleInput).toHaveValue('37.5');

	await page.keyboard.press('Control+z');
	await expect(angleInput).toHaveValue('0.0');

	await page.keyboard.press('Control+y');
	await expect(angleInput).toHaveValue('37.5');

	const snapshot = await readEditorState(page);
	expect(snapshot.instances[0].params.angle).toBe(37.5);
	expect(consoleErrors).toEqual([]);
});

test('AC-F9.1: shortcut pressed inside a number field or modal dialog does not undo the stack', async ({
	page,
}) => {
	await seedProjectWithEffects(page, ['pixelSort']);
	const angleInput = page.getByRole('textbox', {name: 'Angle'});
	await angleInput.fill('90');
	await angleInput.press('Enter');
	await expect(
		page.getByRole('button', {name: 'Undo Change Angle'}),
	).toBeEnabled();

	// Focus number field and press Ctrl+Z -> stack must NOT undo
	await angleInput.focus();
	await page.keyboard.press('Control+z');
	const afterInputKey = await readEditorState(page);
	expect(afterInputKey.instances[0].params.angle).toBe(90);

	// Open Save preset modal dialog and press Ctrl+Z -> stack must NOT undo
	await openPresets(page);
	await page.getByRole('button', {name: 'Save as preset'}).click();
	await expect(
		page.getByRole('dialog', {name: 'Save as preset'}),
	).toBeVisible();
	await page.getByRole('button', {name: 'Cancel'}).focus();
	await page.keyboard.press('Control+z');
	const afterModalKey = await readEditorState(page);
	expect(afterModalKey.instances[0].params.angle).toBe(90);
});

test('AC-F9.3: after 205 commits, 200 undos are possible and the 201st disables Undo', async ({
	page,
}) => {
	await seedProjectWithEffects(page, ['pixelSort']);

	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const {store} = booted.bundle;
		const instanceId = store.getState().activeProject!.stack.instances[0].id;
		for (let step = 1; step <= 205; step++) {
			await store
				.getState()
				.commitParam(instanceId, 'angle', step % 360, `Step ${step}`);
		}
	});

	const before = await readEditorState(page);
	expect(before.historyHeadSeq - before.historyMinSeq).toBe(200);

	const undoCount = await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		let count = 0;
		while (await booted.bundle.store.getState().undo()) {
			count++;
		}

		return count;
	});

	expect(undoCount).toBe(200);
	await expect(page.getByRole('button', {name: /^Undo/})).toBeDisabled();
	await expect(page.getByRole('button', {name: /^Redo/})).toBeEnabled();
});

test('AC-F9.4 AC-F9.5: undo preserves zoom, pan, and theme, and history survives a page reload', async ({
	page,
}) => {
	await seedProjectWithEffects(page, ['pixelSort']);
	const angleInput = page.getByRole('textbox', {name: 'Angle'});
	await angleInput.fill('135');
	await angleInput.press('Enter');

	// Set custom zoom, pan, and theme
	await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const state = booted.bundle.store.getState();
		await state.setTheme('dark');
		state.setViewState({fitMode: 'custom', zoom: 2, centerX: 80, centerY: 60});
		await state.flushViewState();
	});

	await page.reload();
	await expect(
		page.getByRole('button', {name: 'Undo Change Angle'}),
	).toBeEnabled();

	await page.getByRole('button', {name: 'Undo Change Angle'}).click();
	await expect(angleInput).toHaveValue('0.0');

	const after = await readEditorState(page);
	expect(after.viewState.fitMode).toBe('custom');
	expect(after.viewState.zoom).toBe(2);
	expect(after.viewState.centerX).toBe(80);
	expect(after.viewState.centerY).toBe(60);
	expect(after.theme).toBe('dark');
});

test('AC-F10.1: applying ASDF classic yields 2 pixelSort instances as one history entry and Add to stack appends', async ({
	page,
}) => {
	await seedProjectWithEffects(page, []);
	const before = await readEditorState(page);
	expect(before.instances).toHaveLength(0);

	await openPresets(page);
	await page.getByRole('button', {name: /^ASDF classic/}).click();

	await expect(
		page.getByRole('button', {name: 'Undo Apply ASDF classic'}),
	).toBeEnabled();
	const afterApply = await readEditorState(page);
	expect(afterApply.instances).toHaveLength(2);
	expect(afterApply.instances[0].type).toBe('pixelSort');
	expect(afterApply.instances[0].params.angle).toBe(270);
	expect(afterApply.instances[1].type).toBe('pixelSort');
	expect(afterApply.instances[1].params.angle).toBe(0);
	expect(afterApply.historyHeadSeq).toBe(before.historyHeadSeq + 1);

	// One undo restores the previous empty stack
	await page.getByRole('button', {name: 'Undo Apply ASDF classic'}).click();
	await expect(
		page.getByRole('button', {name: 'Redo Apply ASDF classic'}),
	).toBeEnabled();
	const afterUndo = await readEditorState(page);
	expect(afterUndo.instances).toHaveLength(0);

	// Add to stack appends to existing effect
	await page.getByRole('button', {name: 'Redo Apply ASDF classic'}).click();
	await expect(
		page.getByRole('button', {name: 'Undo Apply ASDF classic'}),
	).toBeEnabled();
	await openPresets(page);
	await page.getByRole('button', {name: 'Add Bright streaks to stack'}).click();
	await expect(
		page.getByRole('button', {name: 'Undo Add Bright streaks'}),
	).toBeEnabled();
	const afterAdd = await readEditorState(page);
	expect(afterAdd.instances).toHaveLength(3);
	expect(afterAdd.instances[2].params.threshold).toEqual([0.5, 1]);
});

test('AC-F10.2 AC-F10.3 AC-F10.4: save, reload, apply to another project, rename, delete user preset; built-ins read-only', async ({
	page,
}) => {
	await seedProjectWithEffects(page, ['pixelSort']);
	const instanceId = (await readEditorState(page)).instances[0].id;
	await page.evaluate(async (id) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		const booted = await runtime!.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		await booted.bundle.store.getState().commitParam(id, 'angle', 45);
		await booted.bundle.store.getState().commitParam(id, 'seed', 424_242);
	}, instanceId);

	// AC-F10.3: built-in presets have no rename/delete actions
	await openPresets(page);
	const builtinList = page.getByRole('list', {name: 'Built-in presets'});
	await expect(builtinList.getByRole('listitem')).toHaveCount(6);
	await expect(builtinList.getByRole('button', {name: /actions$/})).toHaveCount(
		0,
	);

	// Save current stack as "Mine"
	await page.getByRole('button', {name: 'Save as preset'}).click();
	const saveDialog = page.getByRole('dialog', {name: 'Save as preset'});
	await saveDialog.getByLabel('Preset name').fill('Mine');
	await saveDialog.getByRole('button', {name: 'Save preset'}).click();
	await expect(saveDialog).toHaveCount(0);

	// AC-F10.4: reload and confirm "Mine" survives
	await page.reload();
	await openPresets(page);
	await expect(
		page.getByRole('list', {name: 'Saved presets'}).getByText('Mine'),
	).toBeVisible();
	await page.keyboard.press('Escape');

	// AC-F10.2: apply "Mine" to a second project and verify params & seed match
	await importSyntheticProject(page, 'Second project');
	expect((await readEditorState(page)).instances).toHaveLength(0);

	await openPresets(page);
	await page.getByRole('button', {name: /^Mine\s+1 effect$/}).click();
	await expect(
		page.getByRole('button', {name: 'Undo Apply Mine'}),
	).toBeEnabled();
	const secondState = await readEditorState(page);
	expect(secondState.instances).toHaveLength(1);
	expect(secondState.instances[0].params.angle).toBe(45);
	expect(secondState.instances[0].params.seed).toBe(424_242);

	// Rename "Mine" -> "Renamed Mine"
	await openPresets(page);
	await page.getByRole('button', {name: 'Mine actions'}).click();
	await page.getByRole('menuitem', {name: 'Rename'}).click();
	const renameDialog = page.getByRole('dialog', {name: 'Rename preset'});
	await renameDialog.getByLabel('Preset name').fill('Renamed Mine');
	await renameDialog.getByRole('button', {name: 'Save'}).click();
	await expect(renameDialog).toHaveCount(0);

	await openPresets(page);
	await expect(
		page.getByRole('list', {name: 'Saved presets'}).getByText('Renamed Mine'),
	).toBeVisible();

	// Delete "Renamed Mine" with confirmation dialog
	await page.getByRole('button', {name: 'Renamed Mine actions'}).click();
	await page.getByRole('menuitem', {name: 'Delete'}).click();
	const confirmDialog = page.getByRole('alertdialog', {
		name: 'Delete preset?',
	});
	await expect(confirmDialog).toContainText('Renamed Mine');
	await confirmDialog.getByRole('button', {name: 'Delete'}).click();
	await expect(confirmDialog).toHaveCount(0);

	const finalState = await readEditorState(page);
	expect(finalState.presetNames).toEqual([]);
});

async function openToolbarInTheme(
	page: Page,
	theme: (typeof THEMES)[number],
	viewport: ProofViewport,
): Promise<void> {
	await page.emulateMedia({colorScheme: theme.media});
	await page.addInitScript((stored) => {
		globalThis.localStorage.setItem('psg:theme', stored);
	}, theme.stored);
	await page.setViewportSize({width: viewport.width, height: viewport.height});
	await seedProjectWithEffects(page, ['pixelSort']);
}

for (const theme of THEMES) {
	for (const viewport of PROOF_VIEWPORTS) {
		test(`AC-F18.1 AC-F18.3 AC-F19.2: toolbar lays out cleanly at ${viewport.name} in ${theme.name} with no scroll or a11y violations @a11y`, async ({
			page,
			browserName,
		}) => {
			const consoleErrors = collectConsoleErrors(page);
			await openToolbarInTheme(page, theme, viewport);

			const toolbar = page.getByRole('toolbar', {name: 'Editor actions'});
			await expect(toolbar).toBeVisible();

			// Check every interactive target in toolbar is at least 24x24 px
			const buttons = toolbar.getByRole('button');
			const count = await buttons.count();
			expect(count).toBeGreaterThanOrEqual(3);
			for (let index = 0; index < count; index++) {
				const box = await buttons.nth(index).boundingBox();
				expect(box, `toolbar button ${index} box`).not.toBeNull();
				expect(box!.width).toBeGreaterThanOrEqual(24);
				expect(box!.height).toBeGreaterThanOrEqual(24);
			}

			// No horizontal page scroll
			const metrics = await page.evaluate(() => ({
				scrollWidth: globalThis.document.documentElement.scrollWidth,
				innerWidth: globalThis.innerWidth,
			}));
			expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);

			await assertNoA11yViolations(page);

			// Also verify Presets popover/dialog opens cleanly and passes axe
			await openPresets(page);
			await assertNoA11yViolations(page);

			if (
				process.env.CAPTURE_TOOLBAR_PROOF === '1' &&
				browserName === 'chromium'
			) {
				const outDir = join(process.cwd(), '.proof', 'toolbar');
				await mkdir(outDir, {recursive: true});
				await page.screenshot({
					path: join(outDir, `${viewport.name}-${theme.name}.png`),
				});
			}

			await page.keyboard.press('Escape');
			expect(consoleErrors, 'Console errors').toEqual([]);
		});
	}
}
