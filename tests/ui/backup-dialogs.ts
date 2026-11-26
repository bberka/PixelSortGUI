// Mounting and querying shared by the backup dialog tests.
import {act, createElement, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {vi} from 'vite-plus/test';
import {AppRuntimeProvider} from '../../src/app/runtime-context.tsx';
import type {AppRuntime} from '../../src/state/index.ts';
import {MemoryStorageAdapter} from '../../src/storage/memory-adapter.ts';
import {createTestStore} from '../state/fixtures.ts';
import {transferDependencies} from '../storage/project-transfer-fixtures.ts';

const runtime: AppRuntime = {
	ready: Promise.resolve({status: 'insecure-context'}),
	result: null,
	dispose() {},
};

let root: ReturnType<typeof createRoot> | undefined;

export function setupStore() {
	const repository = new MemoryStorageAdapter(transferDependencies());
	return createTestStore({repository});
}

export type TestContext = ReturnType<typeof setupStore>;

export function mount(context: TestContext, node: ReactNode) {
	const container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	const render = (next: ReactNode) => {
		act(() => {
			root!.render(
				createElement(AppRuntimeProvider, {
					value: {runtime, bundle: context.bundle},
					// eslint-disable-next-line @eslint-react/jsx-no-children-prop -- The provider requires the prop.
					children: next,
				}),
			);
		});
	};

	render(node);
	return {render};
}

// Call before and after each test.
export function startDialogTest(): void {
	vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
}

export function endDialogTest(): void {
	act(() => {
		root?.unmount();
	});
	root = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
}

// The archive codec and hashing run on real timers, and React applies updates
// only as each `act` ends.
export async function until(check: () => void): Promise<void> {
	await vi.waitFor(async () => {
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});
		check();
	});
}

function find(selector: string, name: string | RegExp): HTMLElement {
	const matches = (text: string) =>
		typeof name === 'string' ? text === name : name.test(text);
	const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
		(candidate) => matches(candidate.textContent.trim()),
	);
	if (!element) {
		throw new Error(`No ${selector} named ${String(name)}`);
	}

	return element;
}

export const button = (name: string | RegExp) =>
	find('button', name) as HTMLButtonElement;
// A checkbox row: its text names the checkbox inside it.
export const row = (name: string | RegExp) =>
	find('[data-slot="check-row"]', name);
export const checkbox = (name: string | RegExp) =>
	row(name).querySelector<HTMLButtonElement>('[role="checkbox"]')!;
export const isChecked = (name: string | RegExp) =>
	checkbox(name).getAttribute('aria-checked') === 'true';
export const alertText = () =>
	document.querySelector('[role="alert"]')?.textContent;
export const pageText = () => document.body.textContent;

export async function click(element: HTMLElement): Promise<void> {
	await act(async () => {
		element.click();
	});
}
