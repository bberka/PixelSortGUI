import {describe, expect, it} from 'vite-plus/test';
import {GUIDE_SECTIONS, SHORTCUTS} from './content.ts';
import {isGuideShortcut} from './navigation.ts';
import {stepSplitPosition} from '@/features/canvas/compare-logic.ts';
import {viewCommandFor} from '@/features/canvas/gestures.ts';
import {dialValue, steppedValue} from '@/features/params/keyboard.ts';
import {matchHistoryShortcut} from '@/features/toolbar/shortcuts.ts';

function keysFor(where: string): string[] {
	return SHORTCUTS.filter((item) => item.where === where).flatMap(
		(item) => item.keys,
	);
}

const NAMED_KEYS: Readonly<Record<string, string>> = {
	Left: 'ArrowLeft',
	Right: 'ArrowRight',
	'Page Up': 'PageUp',
	'Page Down': 'PageDown',
};

const key = (name: string) => ({
	key: NAMED_KEYS[name] ?? name,
	shiftKey: false,
});

describe('guide content', () => {
	it('uses unique section ids', () => {
		const ids = GUIDE_SECTIONS.map((section) => section.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('lists only editor keys that a handler reacts to, and all view keys', () => {
		const editor = keysFor('Editor');
		for (const name of ['+', '=', '-', '_', '0', '1']) {
			expect(editor).toContain(name);
			expect(viewCommandFor(name)).not.toBeNull();
		}

		const modifiers = (ctrlKey: boolean, shiftKey: boolean) => ({
			ctrlKey,
			metaKey: !ctrlKey,
			shiftKey,
			altKey: false,
		});
		expect(editor).toEqual(
			expect.arrayContaining(['Ctrl+Z', '⌘Z', 'Ctrl+Shift+Z', '⇧⌘Z', 'Ctrl+Y']),
		);
		expect(matchHistoryShortcut({key: 'z', ...modifiers(true, false)})).toBe(
			'undo',
		);
		expect(matchHistoryShortcut({key: 'z', ...modifiers(false, false)})).toBe(
			'undo',
		);
		expect(matchHistoryShortcut({key: 'Z', ...modifiers(true, true)})).toBe(
			'redo',
		);
		expect(matchHistoryShortcut({key: 'y', ...modifiers(true, false)})).toBe(
			'redo',
		);
	});

	it('lists split divider, slider and dial keys their handlers accept', () => {
		const range = {min: 0, max: 100, step: 1};
		for (const name of keysFor('Split divider')) {
			expect(stepSplitPosition(0.5, key(name).key, false)).not.toBeNull();
		}

		for (const name of keysFor('Angle dial')) {
			if (name !== 'Arrow keys') {
				expect(dialValue(key(name), 90)).not.toBeNull();
			}
		}

		for (const name of ['Home', 'End']) {
			expect(steppedValue(key(name), range, 50)).not.toBeNull();
		}

		expect(steppedValue({key: 'ArrowUp', shiftKey: true}, range, 50)).toBe(60);
		expect(dialValue({key: 'ArrowLeft', shiftKey: true}, 90)).toBe(75);
	});

	it('opens the guide on a bare question mark only', () => {
		const base = {key: '?', ctrlKey: false, metaKey: false, altKey: false};
		expect(keysFor('Anywhere')).toContain('?');
		expect(isGuideShortcut(base)).toBe(true);
		expect(isGuideShortcut({...base, ctrlKey: true})).toBe(false);
		expect(isGuideShortcut({...base, metaKey: true})).toBe(false);
		expect(isGuideShortcut({...base, key: '/'})).toBe(false);
	});
});
