import {afterEach, describe, expect, it} from 'vite-plus/test';
import {
	createBrowserHashRouterEnv,
	DEV_GALLERY_HASH,
	formatHashRoute,
	parseHashRoute,
} from '../../src/state/router.ts';

describe('parseHashRoute', () => {
	it('maps empty hash and root hash to library', () => {
		expect(parseHashRoute('')).toEqual({screen: 'library'});
		expect(parseHashRoute('#')).toEqual({screen: 'library'});
		expect(parseHashRoute('#/')).toEqual({screen: 'library'});
		expect(parseHashRoute('  #/  ')).toEqual({screen: 'library'});
	});

	it('parses the dev gallery route with or without leading #', () => {
		expect(parseHashRoute(DEV_GALLERY_HASH)).toEqual({screen: 'gallery'});
		expect(parseHashRoute('/dev/gallery')).toEqual({screen: 'gallery'});
		expect(parseHashRoute('dev/gallery')).toEqual({screen: 'gallery'});
	});

	it('parses a project editor route and decodes URI-encoded project ids', () => {
		expect(parseHashRoute('#/p/abc-123')).toEqual({
			screen: 'editor',
			projectId: 'abc-123',
		});
		expect(parseHashRoute('#/p/my%20project%2B1')).toEqual({
			screen: 'editor',
			projectId: 'my project+1',
		});
		expect(parseHashRoute('p/raw-id')).toEqual({
			screen: 'editor',
			projectId: 'raw-id',
		});
	});

	it('falls back to library for malformed percent-encoding or unknown paths', () => {
		expect(parseHashRoute('#/p/%E0%A4%A')).toEqual({screen: 'library'});
		expect(parseHashRoute('#/p/')).toEqual({screen: 'library'});
		expect(parseHashRoute('#/p/a/b')).toEqual({screen: 'library'});
		expect(parseHashRoute('#/p/abc?foo=1')).toEqual({screen: 'library'});
		expect(parseHashRoute('#/unknown')).toEqual({screen: 'library'});
	});
});

describe('formatHashRoute', () => {
	it('parses and formats the guide route', () => {
		expect(parseHashRoute('#/guide')).toEqual({screen: 'guide'});
		expect(formatHashRoute({screen: 'guide'})).toBe('#/guide');
	});

	it('formats library, editor (URI-encoded), and gallery routes', () => {
		expect(formatHashRoute({screen: 'library'})).toBe('#/');
		expect(formatHashRoute({screen: 'gallery'})).toBe(DEV_GALLERY_HASH);
		expect(
			formatHashRoute({screen: 'editor', projectId: 'id with spaces'}),
		).toBe('#/p/id%20with%20spaces');
	});
});

describe('createBrowserHashRouterEnv', () => {
	const originalLocation = Object.getOwnPropertyDescriptor(
		globalThis,
		'location',
	);
	const originalHistory = Object.getOwnPropertyDescriptor(
		globalThis,
		'history',
	);
	const originalAddEventListener = Object.getOwnPropertyDescriptor(
		globalThis,
		'addEventListener',
	);
	const originalRemoveEventListener = Object.getOwnPropertyDescriptor(
		globalThis,
		'removeEventListener',
	);

	afterEach(() => {
		if (originalLocation) {
			Object.defineProperty(globalThis, 'location', originalLocation);
		} else {
			Reflect.deleteProperty(globalThis, 'location');
		}

		if (originalHistory) {
			Object.defineProperty(globalThis, 'history', originalHistory);
		} else {
			Reflect.deleteProperty(globalThis, 'history');
		}

		if (originalAddEventListener) {
			Object.defineProperty(
				globalThis,
				'addEventListener',
				originalAddEventListener,
			);
		} else {
			Reflect.deleteProperty(globalThis, 'addEventListener');
		}

		if (originalRemoveEventListener) {
			Object.defineProperty(
				globalThis,
				'removeEventListener',
				originalRemoveEventListener,
			);
		} else {
			Reflect.deleteProperty(globalThis, 'removeEventListener');
		}
	});

	it('reads and updates location.hash while skipping redundant writes', () => {
		let writeCount = 0;
		let currentHash = '#/p/first';
		Object.defineProperty(globalThis, 'location', {
			configurable: true,
			value: {
				pathname: '/app',
				search: '?v=1',
				get hash() {
					return currentHash;
				},
				set hash(next: string) {
					writeCount++;
					currentHash = next;
				},
			},
		});

		const env = createBrowserHashRouterEnv();
		expect(env.getHash()).toBe('#/p/first');

		env.setHash('#/p/first');
		expect(writeCount).toBe(0);

		env.setHash('#/p/second');
		expect(writeCount).toBe(1);
		expect(env.getHash()).toBe('#/p/second');
	});

	it('uses history.replaceState with pathname and search on replaceHash, and falls back to location.hash', () => {
		let currentHash = '#/p/old';
		const replacedCalls: Array<{state: unknown; url: string}> = [];
		Object.defineProperties(globalThis, {
			location: {
				configurable: true,
				value: {
					pathname: '/editor',
					search: '?debug=1',
					get hash() {
						return currentHash;
					},
					set hash(next: string) {
						currentHash = next;
					},
				},
			},
			history: {
				configurable: true,
				value: {
					state: {marker: 42},
					replaceState(state: unknown, _title: string, url: string) {
						replacedCalls.push({state, url});
						currentHash = url.slice(url.indexOf('#'));
					},
				},
			},
		});

		const env = createBrowserHashRouterEnv();
		env.replaceHash('#/p/old');
		expect(replacedCalls).toHaveLength(0);

		env.replaceHash('#/');
		expect(replacedCalls).toEqual([
			{state: {marker: 42}, url: '/editor?debug=1#/'},
		]);

		// Fallback when history is absent
		Reflect.deleteProperty(globalThis, 'history');
		env.replaceHash('#/p/fallback');
		expect(currentHash).toBe('#/p/fallback');
	});

	it('registers and unregisters a hashchange listener on globalThis', () => {
		const target = new EventTarget();
		Object.defineProperties(globalThis, {
			addEventListener: {
				configurable: true,
				value: target.addEventListener.bind(target),
			},
			removeEventListener: {
				configurable: true,
				value: target.removeEventListener.bind(target),
			},
		});

		const env = createBrowserHashRouterEnv();
		let fired = 0;
		const detach = env.addHashChangeListener(() => {
			fired++;
		});

		target.dispatchEvent(new Event('hashchange'));
		expect(fired).toBe(1);

		detach();
		target.dispatchEvent(new Event('hashchange'));
		expect(fired).toBe(1);
	});
});
