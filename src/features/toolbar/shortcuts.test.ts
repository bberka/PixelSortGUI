// @vitest-environment happy-dom
import {afterEach, describe, expect, it} from 'vite-plus/test';
import {
	formatRedoAriaLabel,
	formatRedoTooltip,
	formatUndoAriaLabel,
	formatUndoTooltip,
	getShortcutLabels,
	isEditableTarget,
	isMacPlatform,
	isModalDialogOpen,
	matchHistoryShortcut,
} from './shortcuts.ts';

afterEach(() => {
	document.body.replaceChildren();
});

describe('matchHistoryShortcut', () => {
	it('matches Ctrl+Z and Cmd+Z as undo', () => {
		expect(
			matchHistoryShortcut({
				key: 'z',
				ctrlKey: true,
				metaKey: false,
				shiftKey: false,
				altKey: false,
			}),
		).toBe('undo');
		expect(
			matchHistoryShortcut({
				key: 'Z',
				ctrlKey: false,
				metaKey: true,
				shiftKey: false,
				altKey: false,
			}),
		).toBe('undo');
	});

	it('matches Ctrl+Shift+Z, Cmd+Shift+Z, and Ctrl+Y as redo', () => {
		expect(
			matchHistoryShortcut({
				key: 'Z',
				ctrlKey: true,
				metaKey: false,
				shiftKey: true,
				altKey: false,
			}),
		).toBe('redo');
		expect(
			matchHistoryShortcut({
				key: 'z',
				ctrlKey: false,
				metaKey: true,
				shiftKey: true,
				altKey: false,
			}),
		).toBe('redo');
		expect(
			matchHistoryShortcut({
				key: 'y',
				ctrlKey: true,
				metaKey: false,
				shiftKey: false,
				altKey: false,
			}),
		).toBe('redo');
	});

	it('ignores plain keys, Alt combos, and Shift+Ctrl+Y', () => {
		expect(
			matchHistoryShortcut({
				key: 'z',
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,
				altKey: false,
			}),
		).toBeNull();
		expect(
			matchHistoryShortcut({
				key: 'z',
				ctrlKey: true,
				metaKey: false,
				shiftKey: false,
				altKey: true,
			}),
		).toBeNull();
		expect(
			matchHistoryShortcut({
				key: 'y',
				ctrlKey: true,
				metaKey: false,
				shiftKey: true,
				altKey: false,
			}),
		).toBeNull();
	});
});

describe('isEditableTarget', () => {
	it('returns true for inputs, textareas, selects, and contenteditable elements', () => {
		const input = document.createElement('input');
		const textarea = document.createElement('textarea');
		const select = document.createElement('select');
		const editable = document.createElement('div');
		editable.setAttribute('contenteditable', 'true');
		const child = document.createElement('span');
		editable.append(child);
		document.body.append(input, textarea, select, editable);

		expect(isEditableTarget(input)).toBe(true);
		expect(isEditableTarget(textarea)).toBe(true);
		expect(isEditableTarget(select)).toBe(true);
		expect(isEditableTarget(editable)).toBe(true);
		expect(isEditableTarget(child)).toBe(true);
	});

	it('returns false for buttons, divs, and null', () => {
		const button = document.createElement('button');
		document.body.append(button);
		expect(isEditableTarget(button)).toBe(false);
		expect(isEditableTarget(null)).toBe(false);
	});
});

describe('isModalDialogOpen', () => {
	it('returns true when a dialog, alert-dialog, or aria-modal is open', () => {
		expect(isModalDialogOpen(document)).toBe(false);

		const dialog = document.createElement('div');
		dialog.dataset.slot = 'dialog-content';
		dialog.dataset.state = 'open';
		document.body.append(dialog);
		expect(isModalDialogOpen(document)).toBe(true);

		dialog.dataset.state = 'closed';
		expect(isModalDialogOpen(document)).toBe(false);

		const popover = document.createElement('div');
		popover.dataset.slot = 'popover-content';
		popover.dataset.state = 'open';
		document.body.append(popover);
		expect(isModalDialogOpen(document)).toBe(false);
	});
});

describe('label and shortcut formatters', () => {
	it('formats platform shortcut labels and accessible names', () => {
		expect(isMacPlatform('MacIntel', '')).toBe(true);
		expect(isMacPlatform('Linux x86_64', 'Mozilla/5.0 X11')).toBe(false);
		expect(getShortcutLabels(true)).toEqual({undo: '⌘Z', redo: '⇧⌘Z'});
		expect(getShortcutLabels(false)).toEqual({
			undo: 'Ctrl+Z',
			redo: 'Ctrl+Shift+Z',
		});

		expect(formatUndoAriaLabel(null)).toBe('Undo');
		expect(formatUndoAriaLabel('Change Angle')).toBe('Undo Change Angle');
		expect(formatRedoAriaLabel(null)).toBe('Redo');
		expect(formatRedoAriaLabel('Add Pixel sort')).toBe('Redo Add Pixel sort');
		expect(formatUndoTooltip('Change Angle', 'Ctrl+Z')).toBe(
			'Undo Change Angle (Ctrl+Z)',
		);
		expect(formatRedoTooltip('Add Pixel sort', 'Ctrl+Shift+Z')).toBe(
			'Redo Add Pixel sort (Ctrl+Shift+Z)',
		);
	});
});
