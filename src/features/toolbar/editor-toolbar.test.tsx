// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {EditorToolbar} from './editor-toolbar.tsx';
import {LiveRegion} from '@/app/live-region.tsx';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import {TooltipProvider} from '@/components/ui/tooltip';
import {BUILTIN_PRESETS} from '@/presets/builtin.ts';
import type {AppRuntime} from '@/state/index.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type TestContext = ReturnType<typeof createTestStore>;

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function stubRuntime(): AppRuntime {
	return {
		ready: Promise.resolve({status: 'insecure-context'}),
		result: null,
		dispose() {},
	};
}

function mountToolbar(context: TestContext) {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			<TooltipProvider>
				<AppRuntimeProvider
					value={{runtime: stubRuntime(), bundle: context.bundle}}
				>
					<EditorToolbar />
					<LiveRegion />
				</AppRuntimeProvider>
			</TooltipProvider>,
		);
	});
	return container;
}

async function flush(turns = 8): Promise<void> {
	for (let index = 0; index < turns; index++) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

async function setup(options: {effects?: readonly string[]} = {}) {
	const context = createTestStore();
	await context.store.getState().importImage({
		name: 'photo.png',
		blob: makeTestBlob('photo'),
		width: 16,
		height: 16,
	});
	for (const type of options.effects ?? []) {
		await context.store.getState().addEffect(type);
	}

	return context;
}

function getButtonByLabel(pattern: RegExp): HTMLButtonElement {
	const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
	const match = buttons.find((button) => {
		const label = button.getAttribute('aria-label') ?? button.textContent ?? '';
		return pattern.test(label.trim());
	});
	if (!match) {
		throw new Error(`No button matching ${pattern}`);
	}

	return match;
}

function getLiveText(): string {
	return document.querySelector('[role="status"]')?.textContent ?? '';
}

afterEach(() => {
	if (root) {
		act(() => {
			root!.unmount();
		});
		root = undefined;
	}

	container?.remove();
	container = undefined;
	document.body.replaceChildren();
});

describe('EditorToolbar undo and redo', () => {
	it('disables undo and redo on a fresh project and enables them with commit labels after edits', async () => {
		const context = await setup();
		mountToolbar(context);

		const undoButton = getButtonByLabel(/^Undo/);
		const redoButton = getButtonByLabel(/^Redo/);
		expect(undoButton.disabled).toBe(true);
		expect(redoButton.disabled).toBe(true);
		expect(undoButton.getAttribute('aria-label')).toBe('Undo');
		expect(redoButton.getAttribute('aria-label')).toBe('Redo');

		await act(async () => {
			await context.store.getState().addEffect('pixelSort');
		});

		expect(undoButton.disabled).toBe(false);
		expect(undoButton.getAttribute('aria-label')).toBe('Undo Add Pixel sort');
		expect(redoButton.disabled).toBe(true);

		act(() => {
			undoButton.click();
		});
		await flush();

		expect(
			context.store.getState().activeProject?.stack.instances,
		).toHaveLength(0);
		expect(undoButton.disabled).toBe(true);
		expect(redoButton.disabled).toBe(false);
		expect(redoButton.getAttribute('aria-label')).toBe('Redo Add Pixel sort');
		expect(getLiveText()).toBe('Undid Add Pixel sort');

		act(() => {
			redoButton.click();
		});
		await flush();

		expect(
			context.store.getState().activeProject?.stack.instances,
		).toHaveLength(1);
		expect(getLiveText()).toBe('Redid Add Pixel sort');
	});

	it('handles Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y shortcuts and announces results', async () => {
		const context = await setup({effects: ['pixelSort']});
		const instanceId =
			context.store.getState().activeProject!.stack.instances[0].id;
		await context.store.getState().commitParam(instanceId, 'angle', 45);
		mountToolbar(context);

		act(() => {
			globalThis.dispatchEvent(
				new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true}),
			);
		});
		await flush();

		expect(
			context.store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(0);
		expect(getLiveText()).toBe('Undid Change Angle');

		act(() => {
			globalThis.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'z',
					ctrlKey: true,
					shiftKey: true,
					bubbles: true,
				}),
			);
		});
		await flush();

		expect(
			context.store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(45);
		expect(getLiveText()).toBe('Redid Change Angle');

		act(() => {
			globalThis.dispatchEvent(
				new KeyboardEvent('keydown', {key: 'z', metaKey: true, bubbles: true}),
			);
		});
		await flush();
		expect(
			context.store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(0);

		act(() => {
			globalThis.dispatchEvent(
				new KeyboardEvent('keydown', {key: 'y', ctrlKey: true, bubbles: true}),
			);
		});
		await flush();
		expect(
			context.store.getState().activeProject?.stack.instances[0].params.angle,
		).toBe(45);
	});

	it('ignores undo shortcut while focus is in an input or while a modal dialog is open', async () => {
		const context = await setup({effects: ['pixelSort']});
		mountToolbar(context);

		const input = document.createElement('input');
		input.type = 'number';
		document.body.append(input);
		input.focus();

		act(() => {
			input.dispatchEvent(
				new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true}),
			);
		});
		await flush();
		expect(
			context.store.getState().activeProject?.stack.instances,
		).toHaveLength(1);

		input.blur();
		const modal = document.createElement('div');
		modal.dataset.slot = 'dialog-content';
		modal.dataset.state = 'open';
		document.body.append(modal);

		act(() => {
			globalThis.dispatchEvent(
				new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true}),
			);
		});
		await flush();
		expect(
			context.store.getState().activeProject?.stack.instances,
		).toHaveLength(1);
	});
});

describe('EditorToolbar presets', () => {
	it('lists all 6 built-in presets with no rename/delete actions and applies one as a single commit', async () => {
		const context = await setup();
		mountToolbar(context);

		act(() => {
			getButtonByLabel(/^Presets$/).click();
		});
		await flush();

		const builtinList = document.querySelector(
			'ul[aria-label="Built-in presets"]',
		);
		expect(builtinList).not.toBeNull();
		const items = [...builtinList!.querySelectorAll('li')];
		expect(items).toHaveLength(BUILTIN_PRESETS.length);
		for (const item of items) {
			expect(item.querySelector('button[aria-haspopup="menu"]')).toBeNull();
		}

		const asdfButton = getButtonByLabel(/^ASDF classic/);
		act(() => {
			asdfButton.click();
		});
		await flush();

		const instances =
			context.store.getState().activeProject?.stack.instances ?? [];
		expect(instances).toHaveLength(2);
		expect(instances[0].params.angle).toBe(270);
		expect(instances[1].params.angle).toBe(0);
		expect(getLiveText()).toBe('Applied preset ASDF classic');

		// One undo restores the empty stack
		act(() => {
			getButtonByLabel(/^Undo Apply ASDF classic$/).click();
		});
		await flush();
		expect(
			context.store.getState().activeProject?.stack.instances,
		).toHaveLength(0);
	});

	it('appends a preset to the stack with Add to stack', async () => {
		const context = await setup({effects: ['channelShift']});
		mountToolbar(context);

		act(() => {
			getButtonByLabel(/^Presets$/).click();
		});
		await flush();

		act(() => {
			getButtonByLabel(/^Add ASDF classic to stack$/).click();
		});
		await flush();

		const instances =
			context.store.getState().activeProject?.stack.instances ?? [];
		expect(instances.map((item) => item.type)).toEqual([
			'channelShift',
			'pixelSort',
			'pixelSort',
		]);
		expect(getLiveText()).toBe('Added preset ASDF classic to stack');
	});

	it('saves a user preset, lists it under Saved, and rejects an empty name', async () => {
		const context = await setup({effects: ['pixelSort']});
		mountToolbar(context);

		act(() => {
			getButtonByLabel(/^Presets$/).click();
		});
		await flush();

		act(() => {
			getButtonByLabel(/^Save as preset$/).click();
		});
		await flush();

		const saveButton = getButtonByLabel(/^Save preset$/);
		act(() => {
			saveButton.click();
		});
		await flush();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			'Enter a preset name.',
		);

		const input = document.querySelector<HTMLInputElement>('input');
		expect(input).not.toBeNull();
		const valueSetter = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			'value',
		)?.set;
		act(() => {
			valueSetter?.call(input, 'My Drift');
			input!.dispatchEvent(new Event('input', {bubbles: true}));
		});
		act(() => {
			saveButton.click();
		});
		await flush();

		expect(context.store.getState().presets.map((p) => p.name)).toEqual([
			'My Drift',
		]);
		expect(getLiveText()).toBe('Saved preset My Drift');
	});
});
