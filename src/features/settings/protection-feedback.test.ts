import {describe, expect, it} from 'vite-plus/test';
import {browserFamily, protectionMessage} from './protection-feedback.ts';

describe('protection advice', () => {
	it.each([
		[
			'chromium',
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
		],
		[
			'chromium',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
		],
		[
			'firefox',
			'Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0',
		],
		[
			'safari',
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
		],
		[
			'safari',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
		],
		['other', 'Unknown/1.0'],
	])('reads %s from its user agent', (family, userAgent) => {
		expect(browserFamily(userAgent)).toBe(family);
	});

	it('tells Firefox users to allow the prompt and others that none appears', () => {
		expect(protectionMessage('denied', 'firefox')).toContain('Allow');
		expect(protectionMessage('pending', 'firefox')).toContain('Allow');
		expect(protectionMessage('denied', 'chromium')).toContain('Bookmark');
		expect(protectionMessage('denied', 'chromium')).toContain('install');
	});
});
