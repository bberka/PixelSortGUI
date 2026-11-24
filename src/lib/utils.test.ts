import {describe, expect, it} from 'vite-plus/test';
import {cn} from './utils.ts';

describe('cn', () => {
	it('joins class names and ignores falsy values', () => {
		expect(cn('px-4', false, undefined, null, 'py-2')).toBe('px-4 py-2');
	});

	it('resolves conflicting Tailwind utility classes in favor of the last one', () => {
		expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
	});
});
