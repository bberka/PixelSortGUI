// @vitest-environment happy-dom
import {act, useState, type ReactElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vite-plus/test';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './dropdown-menu.tsx';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let root: Root | undefined;
let host: HTMLElement | undefined;

function render(element: ReactElement): HTMLElement {
	host = document.createElement('div');
	document.body.append(host);
	root = createRoot(host);
	act(() => {
		root?.render(element);
	});
	return host;
}

function openMenu(trigger: HTMLElement): void {
	act(() => {
		trigger.dispatchEvent(
			new PointerEvent('pointerdown', {
				button: 0,
				ctrlKey: false,
				pointerType: 'mouse',
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	// Radix DismissableLayer attaches its outside-pointerdown listener in a
	// setTimeout(..., 0) after mount so the opening click does not dismiss it.
	flushFocusTimer();
}

function flushFocusTimer(): void {
	act(() => {
		vi.advanceTimersByTime(0);
	});
}

function renderMenuHarness(options: {modal?: boolean} = {}) {
	const onSelect = vi.fn();
	const container = render(
		<div>
			<DropdownMenu modal={options.modal}>
				<DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem onSelect={onSelect}>First action</DropdownMenuItem>
					<DropdownMenuItem>Second action</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<button type="button">Outside button</button>
		</div>,
	);
	const buttons = [...container.querySelectorAll('button')];
	const trigger = buttons.find(
		(button) => button.textContent?.trim() === 'Open menu',
	)!;
	const outsideButton = buttons.find(
		(button) => button.textContent?.trim() === 'Outside button',
	)!;
	return {container, trigger, outsideButton, onSelect};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	host?.remove();
	root = undefined;
	host = undefined;
	document.body.replaceChildren();
	vi.useRealTimers();
});

describe('DropdownMenu', () => {
	it('restores focus to the trigger when closed with Escape', () => {
		const {trigger} = renderMenuHarness();
		openMenu(trigger);
		expect(document.querySelector('[role="menu"]')).not.toBeNull();

		act(() => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Escape',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		flushFocusTimer();

		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it('restores focus to the trigger when an item is selected with Enter', () => {
		const {trigger, onSelect} = renderMenuHarness();
		openMenu(trigger);

		const firstItem = document.querySelector<HTMLElement>('[role="menuitem"]');
		expect(firstItem).not.toBeNull();

		act(() => {
			firstItem!.focus();
			firstItem!.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		flushFocusTimer();

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(document.activeElement).toBe(trigger);
	});

	it('does not steal focus when another element outside the menu takes focus on close', () => {
		const {trigger, outsideButton} = renderMenuHarness();
		openMenu(trigger);

		const firstItem = document.querySelector<HTMLElement>('[role="menuitem"]');
		expect(firstItem).not.toBeNull();

		act(() => {
			firstItem!.dispatchEvent(
				new MouseEvent('click', {bubbles: true, cancelable: true}),
			);
		});
		act(() => {
			outsideButton.focus();
		});
		flushFocusTimer();

		expect(document.activeElement).toBe(outsideButton);
	});

	it('keeps focus on an outside control when dismissed by an outside click', () => {
		const {trigger, outsideButton} = renderMenuHarness();
		openMenu(trigger);

		act(() => {
			outsideButton.dispatchEvent(
				new PointerEvent('pointerdown', {
					button: 0,
					ctrlKey: false,
					pointerType: 'mouse',
					bubbles: true,
					cancelable: true,
				}),
			);
			outsideButton.focus();
		});
		flushFocusTimer();

		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(document.activeElement).toBe(outsideButton);
	});

	it('restores focus to the trigger on Escape after a prior right-click outside close', () => {
		const {trigger, outsideButton} = renderMenuHarness();
		openMenu(trigger);

		// Right-click outside the modal menu: Radix sets hasInteractedOutsideRef.
		act(() => {
			outsideButton.dispatchEvent(
				new PointerEvent('pointerdown', {
					button: 2,
					ctrlKey: false,
					pointerType: 'mouse',
					bubbles: true,
					cancelable: true,
				}),
			);
			outsideButton.focus();
		});
		flushFocusTimer();

		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(document.activeElement).toBe(outsideButton);

		// Reopen and close normally with Escape: trigger focus MUST be restored.
		openMenu(trigger);
		expect(document.querySelector('[role="menu"]')).not.toBeNull();

		act(() => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Escape',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		flushFocusTimer();

		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it('restores focus to the trigger on item selection after a prior right-click outside close', () => {
		const {trigger, outsideButton} = renderMenuHarness();
		openMenu(trigger);

		act(() => {
			outsideButton.dispatchEvent(
				new PointerEvent('pointerdown', {
					button: 2,
					ctrlKey: false,
					pointerType: 'mouse',
					bubbles: true,
					cancelable: true,
				}),
			);
			outsideButton.focus();
		});
		flushFocusTimer();

		expect(document.activeElement).toBe(outsideButton);

		// Reopen and pick an item via keyboard Enter.
		openMenu(trigger);
		const firstItem = document.querySelector<HTMLElement>('[role="menuitem"]');
		expect(firstItem).not.toBeNull();

		act(() => {
			firstItem!.focus();
			firstItem!.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		flushFocusTimer();

		expect(document.activeElement).toBe(trigger);
	});

	it('still restores focus to the trigger when activeElement is inside the menu content during close', () => {
		let setOpenRef: ((open: boolean) => void) | undefined;
		function ControlledHarness() {
			const [open, setOpen] = useState(true);
			setOpenRef = setOpen;
			return (
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<DropdownMenuTrigger>Controlled trigger</DropdownMenuTrigger>
					<DropdownMenuContent forceMount>
						<DropdownMenuItem>Only action</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			);
		}

		const container = render(<ControlledHarness />);
		const trigger = container.querySelector('button')!;
		const item = document.querySelector<HTMLElement>('[role="menuitem"]')!;
		act(() => {
			item.focus();
		});
		expect(document.activeElement).toBe(item);

		// Close while forceMount keeps the content (and focused item) connected,
		// simulating an exit animation where activeElement is still inside content.
		act(() => {
			setOpenRef?.(false);
		});
		flushFocusTimer();

		expect(document.activeElement).toBe(trigger);
	});
});
