// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {EffectStackPanel} from './stack-panel.tsx';
import {LiveRegion} from '@/app/live-region.tsx';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import {effects} from '@/engine/effects/index.ts';
import {createRegistry, listedEffects} from '@/engine/registry.ts';
import {pixelSortEffect} from '@/engine/effects/pixel-sort/index.ts';
import type {EffectRegistry} from '@/engine/types.ts';
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

function mountPanel(context: TestContext, registry?: EffectRegistry) {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			<AppRuntimeProvider
				value={{runtime: stubRuntime(), bundle: context.bundle}}
			>
				<EffectStackPanel registry={registry} />
				<LiveRegion />
			</AppRuntimeProvider>,
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
		name: 'stack.png',
		blob: makeTestBlob('stack'),
		width: 8,
		height: 8,
	});
	for (const type of options.effects ?? []) {
		await context.store.getState().addEffect(type);
	}

	return context;
}

function rowElements(): HTMLLIElement[] {
	return [
		...(container?.querySelectorAll<HTMLLIElement>('li[data-index]') ?? []),
	];
}

function rowTexts(): string[] {
	return rowElements().map((row) => row.textContent ?? '');
}

function selectButton(index: number): HTMLButtonElement {
	const button = rowElements()[index].querySelector<HTMLButtonElement>(
		'button:not([aria-label])',
	);
	if (!button) {
		throw new Error(`Row ${index} has no select button`);
	}

	return button;
}

function switchOf(index: number): HTMLElement {
	const element = rowElements()[index].querySelector('[role="switch"]');
	if (!element) {
		throw new Error(`Row ${index} has no switch`);
	}

	return element as HTMLElement;
}

function menuTrigger(index: number): HTMLButtonElement {
	const button = rowElements()[index].querySelector<HTMLButtonElement>(
		'button[aria-haspopup="menu"]',
	);
	if (!button) {
		throw new Error(`Row ${index} has no menu trigger`);
	}

	return button;
}

function press(element: Element, key: string, altKey = false): void {
	act(() => {
		element.dispatchEvent(
			new KeyboardEvent('keydown', {key, altKey, bubbles: true}),
		);
	});
}

async function openMenu(index: number): Promise<HTMLElement[]> {
	act(() => {
		menuTrigger(index).dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				pointerType: 'mouse',
			}),
		);
	});
	await flush();
	return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function menuItem(items: HTMLElement[], label: string): HTMLElement {
	const item = items.find((element) => element.textContent?.includes(label));
	if (!item) {
		throw new Error(`No menu item ${label}`);
	}

	return item;
}

async function choose(items: HTMLElement[], label: string): Promise<void> {
	act(() => {
		menuItem(items, label).click();
	});
	await flush();
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

describe('effect stack empty state', () => {
	it('shows the empty note and the add trigger for a project without effects', async () => {
		const context = await setup();
		mountPanel(context);

		expect(container?.textContent).toContain('No effects yet');
		const add = container?.querySelector<HTMLButtonElement>(
			'button[aria-label="Add effect"]',
		);
		expect(add).toBeDefined();
		expect(add?.disabled).toBe(false);
		expect(rowElements()).toHaveLength(0);
	});
});

describe('add effect picker', () => {
	it('lists every registered effect with its label and description and appends the chosen one', async () => {
		const context = await setup();
		const extra = {
			...pixelSortEffect,
			type: 'extraEffect',
			label: 'Extra effect',
			description: 'Registered only for this test.',
		} as const;
		const registry = createRegistry([...effects, extra]);
		mountPanel(context, registry);

		const add = container!.querySelector<HTMLButtonElement>(
			'button[aria-label="Add effect"]',
		);
		act(() => {
			add!.click();
		});
		await flush();

		for (const definition of listedEffects(registry)) {
			expect(document.body.textContent).toContain(definition.label);
			expect(document.body.textContent).toContain(definition.description);
		}

		expect(document.body.textContent).not.toContain('Image blend');

		const choice = [...document.querySelectorAll('button')].find((button) =>
			button.textContent?.startsWith('Channel shift'),
		);
		expect(choice).toBeDefined();
		act(() => {
			choice!.click();
		});
		await flush();

		const stack = context.store.getState().activeProject?.stack.instances;
		expect(stack?.map((instance) => instance.type)).toEqual(['channelShift']);
		expect(context.store.getState().activeProject?.selectedInstanceId).toBe(
			stack?.[0].id,
		);
		expect(rowTexts()[0]).toContain('Channel shift');
		expect(selectButton(0).getAttribute('aria-current')).toBe('true');
	});
});

describe('stack rows', () => {
	it('renders instances in stack order and marks only the selected one', async () => {
		const context = await setup({effects: ['pixelSort', 'channelShift']});
		const {instances} = context.store.getState().activeProject!.stack;
		const [, second] = instances;
		context.store.getState().selectEffect(second.id);
		mountPanel(context);

		expect(rowTexts()).toEqual(['Pixel sort', 'Channel shift']);
		expect(selectButton(0).hasAttribute('aria-current')).toBe(false);
		expect(selectButton(1).getAttribute('aria-current')).toBe('true');
		expect(container!.querySelectorAll('[aria-current="true"]')).toHaveLength(
			1,
		);

		act(() => {
			selectButton(0).click();
		});
		await flush();
		expect(context.store.getState().activeProject?.selectedInstanceId).toBe(
			instances[0].id,
		);
	});

	it('switches an instance off, shows the Off icon and text, and sends the disabled stack to the renderer', async () => {
		const context = await setup({effects: ['pixelSort']});
		mountPanel(context);
		context.coordinator.calls.length = 0;

		act(() => {
			switchOf(0).click();
		});
		await flush();

		const instance = context.store.getState().activeProject!.stack.instances[0];
		expect(instance.enabled).toBe(false);
		expect(switchOf(0).getAttribute('aria-checked')).toBe('false');
		expect(rowTexts()[0]).toContain('Off');
		const badge = rowElements()[0].querySelector('[data-slot="badge"]');
		expect(badge?.querySelector('svg')).not.toBeNull();
		expect(badge?.textContent).toBe('Off');

		const dispatched = context.coordinator.calls.filter(
			(call) => call.type === 'setStack',
		);
		expect(dispatched).toHaveLength(1);
		expect(
			dispatched[0].type === 'setStack' &&
				dispatched[0].request.stack.instances[0].enabled,
		).toBe(false);
	});
});

describe('reordering', () => {
	it('moves an instance with the Alt+Arrow shortcut, commits once, and announces the new position', async () => {
		const context = await setup({effects: ['pixelSort', 'channelShift']});
		const {instances} = context.store.getState().activeProject!.stack;
		mountPanel(context);
		const historyBefore = context.store.getState().history.length;

		press(rowElements()[1], 'ArrowUp', true);
		await flush();

		expect(
			context.store
				.getState()
				.activeProject!.stack.instances.map((item) => item.id),
		).toEqual([instances[1].id, instances[0].id]);
		expect(context.store.getState().history).toHaveLength(historyBefore + 1);
		expect(context.store.getState().history.at(-1)?.label).toBe(
			'Reorder Channel shift',
		);
		expect(container!.textContent).toContain(
			'Moved Channel shift to position 1 of 2',
		);
		expect(rowTexts()).toEqual(['Channel shift', 'Pixel sort']);
	});

	it('does nothing at the top of the stack', async () => {
		const context = await setup({effects: ['pixelSort', 'channelShift']});
		mountPanel(context);
		const historyBefore = context.store.getState().history.length;

		press(rowElements()[0], 'ArrowUp', true);
		await flush();

		expect(context.store.getState().history).toHaveLength(historyBefore);
		expect(rowTexts()).toEqual(['Pixel sort', 'Channel shift']);
	});

	it('moves an instance down from its menu and commits once', async () => {
		const context = await setup({effects: ['pixelSort', 'channelShift']});
		const {instances} = context.store.getState().activeProject!.stack;
		mountPanel(context);
		const historyBefore = context.store.getState().history.length;

		const items = await openMenu(0);
		expect(items.map((item) => item.textContent)).toEqual([
			'Move upAlt+Up',
			'Move downAlt+Down',
			'Duplicate',
			'Remove',
		]);
		expect(items[0].dataset.disabled).not.toBeNull();
		await choose(items, 'Move down');

		expect(
			context.store
				.getState()
				.activeProject!.stack.instances.map((item) => item.id),
		).toEqual([instances[1].id, instances[0].id]);
		expect(context.store.getState().history).toHaveLength(historyBefore + 1);
	});
});

describe('duplicate and remove', () => {
	it('duplicates an instance directly below it with the same parameters and selects the copy', async () => {
		const context = await setup({effects: ['pixelSort', 'channelShift']});
		const [original] = context.store.getState().activeProject!.stack.instances;
		mountPanel(context);

		await choose(await openMenu(0), 'Duplicate');

		const {instances} = context.store.getState().activeProject!.stack;
		expect(instances.map((item) => item.type)).toEqual([
			'pixelSort',
			'pixelSort',
			'channelShift',
		]);
		expect(instances[1].id).not.toBe(original.id);
		expect(instances[1].params).toEqual(original.params);
		expect(context.store.getState().activeProject?.selectedInstanceId).toBe(
			instances[1].id,
		);
	});

	it('removes an instance as one commit and Undo restores it at the same position', async () => {
		const context = await setup({
			effects: ['pixelSort', 'channelShift', 'pixelSort'],
		});
		const before = context.store.getState().activeProject!.stack.instances;
		mountPanel(context);
		const idsBefore = before.map((instance) => instance.id);

		await choose(await openMenu(1), 'Remove');

		expect(
			context.store
				.getState()
				.activeProject!.stack.instances.map((instance) => instance.id),
		).toEqual([idsBefore[0], idsBefore[2]]);
		expect(context.store.getState().history.at(-1)?.label).toBe(
			'Remove Channel shift',
		);

		await act(async () => {
			await context.store.getState().undo();
		});
		await flush();

		const restored = context.store.getState().activeProject!.stack.instances;
		expect(restored.map((instance) => instance.id)).toEqual(idsBefore);
		expect(restored[1].params).toEqual(before[1].params);
		expect(rowTexts()).toEqual(['Pixel sort', 'Channel shift', 'Pixel sort']);
	});
});

describe('stack limit', () => {
	it('disables the add trigger at 32 instances and explains why', async () => {
		const context = await setup();
		for (let index = 0; index < 32; index++) {
			await context.store.getState().addEffect('pixelSort');
		}

		mountPanel(context);

		const add = container!.querySelector<HTMLButtonElement>(
			'button[aria-label="Add effect"]',
		);
		expect(add?.disabled).toBe(true);
		const note = container!.querySelector<HTMLElement>('#stack-limit-note');
		expect(note?.textContent).toBe('32 effects maximum');
		expect(add?.getAttribute('aria-describedby')).toBe('stack-limit-note');
		expect(rowElements()).toHaveLength(32);
	});
});

describe('unsupported effect instance', () => {
	async function setupUnsupported() {
		const context = await setup({effects: ['pixelSort']});
		const project = context.store.getState().activeProject!;
		const unsupported = {
			id: 'future01',
			type: 'futureEffect',
			version: 7,
			enabled: true,
			params: {},
			mix: 1,
			blend: 'normal',
		} as const;
		await context.repository.saveProjectStack(project.id, {
			schemaVersion: 1,
			instances: [project.stack.instances[0], unsupported],
		});
		await context.store.getState().openProject(project.id);
		return context;
	}

	it('renders the unknown instance as a kept, labelled row without editing controls', async () => {
		const context = await setupUnsupported();
		mountPanel(context);

		const row = rowElements()[1];
		expect(row.dataset.unsupported).toBe('');
		expect(row.className).toContain('border-dashed');
		expect(row.textContent).toContain('Unsupported effect (futureEffect v7)');
		expect(row.querySelector('[role="switch"]')).toBeNull();
		expect(row.querySelector('[aria-current]')).toBeNull();
		expect(
			context.store
				.getState()
				.activeProject!.stack.instances.map((instance) => instance.type),
		).toEqual(['pixelSort', 'futureEffect']);

		const items = await openMenu(1);
		expect(items.map((item) => item.textContent)).toEqual([
			'Move upAlt+Up',
			'Move downAlt+Down',
			'Remove',
		]);
	});

	it('keeps the unknown instance removable', async () => {
		const context = await setupUnsupported();
		mountPanel(context);

		await choose(await openMenu(1), 'Remove');

		expect(
			context.store
				.getState()
				.activeProject!.stack.instances.map((instance) => instance.type),
		).toEqual(['pixelSort']);
		expect(rowElements()).toHaveLength(1);
	});
});

describe('live announcements and focus restoration', () => {
	it('announces adding and removing the last effect and restores focus to Add effect', async () => {
		const context = await setup();
		mountPanel(context);

		const triggerButton = container!.querySelector<HTMLButtonElement>(
			'button[aria-label="Add effect"]',
		);
		expect(triggerButton).not.toBeNull();

		act(() => {
			triggerButton!.click();
		});
		await flush();

		const pixelSortOption = [...document.querySelectorAll('button')].find(
			(button) => button.textContent?.includes('Pixel sort'),
		);
		expect(pixelSortOption).toBeDefined();
		act(() => {
			pixelSortOption!.click();
		});
		await flush();

		const status = container!.querySelector('[role="status"]');
		expect(status?.textContent).toBe('Added Pixel sort');

		await choose(await openMenu(0), 'Remove');

		expect(status?.textContent).toBe('Removed Pixel sort');
		expect(globalThis.document.activeElement?.getAttribute('aria-label')).toBe(
			'Add effect',
		);
	});

	it('moves focus to the clamped sibling row when removing one of multiple effects', async () => {
		const context = await setup({effects: ['pixelSort', 'channelShift']});
		mountPanel(context);

		const status = container!.querySelector('[role="status"]');

		await choose(await openMenu(1), 'Remove');

		expect(status?.textContent).toBe('Removed Channel shift');
		expect(rowElements()).toHaveLength(1);
		expect(globalThis.document.activeElement).toBe(selectButton(0));
	});
});
