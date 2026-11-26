export type HistoryShortcut = 'undo' | 'redo';

export type ShortcutLabels = {
	readonly undo: string;
	readonly redo: string;
};

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isEditableTarget(target: EventTarget | null): boolean {
	if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
		return false;
	}

	if (EDITABLE_TAGS.has(target.tagName) || target.isContentEditable) {
		return true;
	}

	const editableAncestor = target.closest('[contenteditable]');
	if (editableAncestor instanceof HTMLElement) {
		const value = editableAncestor.getAttribute('contenteditable');
		return value !== 'false';
	}

	return false;
}

const MODAL_DIALOG_SELECTOR = [
	'[data-slot="dialog-content"][data-state="open"]',
	'[data-slot="alert-dialog-content"][data-state="open"]',
	'[data-slot="sheet-content"][data-state="open"]',
	'[aria-modal="true"]',
	'dialog[open]',
].join(', ');

export function isModalDialogOpen(doc: Document | undefined): boolean {
	return doc ? doc.querySelector(MODAL_DIALOG_SELECTOR) !== null : false;
}

export function matchHistoryShortcut(
	event: Pick<
		KeyboardEvent,
		'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
	>,
): HistoryShortcut | null {
	if (event.altKey) {
		return null;
	}

	const primary = event.ctrlKey || event.metaKey;
	if (!primary) {
		return null;
	}

	const key = event.key.toLowerCase();
	if (key === 'z') {
		return event.shiftKey ? 'redo' : 'undo';
	}

	return key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey
		? 'redo'
		: null;
}

export function isMacPlatform(platform?: string, userAgent?: string): boolean {
	const value = `${platform ?? ''} ${userAgent ?? ''}`;
	return /mac|iphone|ipad|ipod/i.test(value);
}

export function getShortcutLabels(isMac?: boolean): ShortcutLabels {
	const mac =
		isMac ??
		(typeof navigator === 'undefined'
			? false
			: isMacPlatform(navigator.platform, navigator.userAgent));
	return mac
		? {undo: '⌘Z', redo: '⇧⌘Z'}
		: {undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z'};
}

export function formatUndoAriaLabel(label: string | null): string {
	return label ? `Undo ${label}` : 'Undo';
}

export function formatRedoAriaLabel(label: string | null): string {
	return label ? `Redo ${label}` : 'Redo';
}
