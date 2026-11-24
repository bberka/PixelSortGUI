import {describe, expect, it} from 'vite-plus/test';
import {
	createStageCache,
	renderStack,
	STAGE_CACHE_MAX_BYTES,
	STAGE_CACHE_MAX_ENTRIES,
	stageCacheKey,
} from '../../src/engine/pipeline.ts';
import {createRegistry} from '../../src/engine/registry.ts';
import {createImage, type EffectInstance} from '../../src/engine/types.ts';
import {
	addEffect,
	bytes,
	instance,
	invertEffect,
	noiseImage,
	options,
	selectionEffect,
	stack,
} from './sample-effects.ts';

describe('createStageCache', () => {
	it('uses the limits of engine.md section 8.5 by default', () => {
		expect(STAGE_CACHE_MAX_ENTRIES).toBe(6);
		expect(STAGE_CACHE_MAX_BYTES).toBe(167_772_160);
		const cache = createStageCache();
		for (let i = 0; i < 7; i++) {
			cache.set(`k${i}`, createImage(1, 1));
		}

		expect(cache.size).toBe(6);
		expect(cache.get('k0')).toBeUndefined();
		expect(cache.get('k1')).toBeDefined();
	});

	it('returns what was stored and undefined for a miss', () => {
		const cache = createStageCache();
		const stored = createImage(2, 2);
		cache.set('a', stored);
		expect(cache.get('a')).toBe(stored);
		expect(cache.get('b')).toBeUndefined();
		expect(cache.size).toBe(1);
		expect(cache.byteLength).toBe(16);
	});

	it('evicts the least recently used entry, counting a get as a use', () => {
		const cache = createStageCache({maxEntries: 3});
		cache.set('a', createImage(1, 1));
		cache.set('b', createImage(1, 1));
		cache.set('c', createImage(1, 1));
		cache.get('a');
		cache.set('d', createImage(1, 1));
		expect(cache.get('b')).toBeUndefined();
		expect(cache.get('a')).toBeDefined();
		expect(cache.get('c')).toBeDefined();
		expect(cache.get('d')).toBeDefined();
	});

	it('evicts by total bytes before the entry limit is reached', () => {
		const cache = createStageCache({maxBytes: 40});
		cache.set('a', createImage(2, 2));
		cache.set('b', createImage(2, 2));
		expect(cache.byteLength).toBe(32);
		cache.set('c', createImage(2, 2));
		expect(cache.size).toBe(2);
		expect(cache.byteLength).toBe(32);
		expect(cache.get('a')).toBeUndefined();
	});

	it('does not store an image larger than the byte limit', () => {
		const cache = createStageCache({maxBytes: 40});
		cache.set('a', createImage(2, 2));
		cache.set('big', createImage(4, 4));
		expect(cache.get('big')).toBeUndefined();
		expect(cache.get('a')).toBeDefined();
	});

	it('replaces an entry stored under the same key', () => {
		const cache = createStageCache();
		const second = createImage(1, 1);
		cache.set('a', createImage(2, 2));
		cache.set('a', second);
		expect(cache.size).toBe(1);
		expect(cache.byteLength).toBe(4);
		expect(cache.get('a')).toBe(second);
	});

	it('clear empties it', () => {
		const cache = createStageCache();
		cache.set('a', createImage(2, 2));
		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.byteLength).toBe(0);
		expect(cache.get('a')).toBeUndefined();
	});
});

describe('stageCacheKey', () => {
	it('joins level, size, source key and the canonical stack', () => {
		expect(
			stageCacheKey('drag', 640, 480, 'sha:abc', {
				schemaVersion: 1,
				instances: [],
			}),
		).toBe('drag:640x480:sha:abc:{"instances":[],"schemaVersion":1}');
	});
});

describe('renderStack with a stage cache', () => {
	const source = noiseImage(5, 4, 8);

	function setup() {
		const rendered: number[] = [];
		const registry = createRegistry([
			addEffect((amount) => {
				rendered.push(amount);
			}),
			invertEffect,
			selectionEffect,
		]);
		const add = (amount: number, overrides: Partial<EffectInstance> = {}) =>
			instance('testAdd', {params: {amount}, ...overrides});
		const cache = createStageCache();
		const render = async (
			instances: EffectInstance[],
			overrides: Parameters<typeof options>[1] = {},
		) => {
			rendered.length = 0;
			const result = await renderStack(
				source,
				stack(...instances),
				registry,
				options(source, {cache, sourceKey: 'photo', ...overrides}),
			);
			return {result, ran: [...rendered]};
		};

		return {add, cache, render, registry};
	}

	it('stores one entry per rendered instance and renders nothing on a repeat', async () => {
		const {add, cache, render} = setup();
		const instances = [add(1), add(2), add(3)];
		const first = await render(instances);
		expect(first.ran).toEqual([1, 2, 3]);
		expect(cache.size).toBe(3);

		const second = await render(instances);
		expect(second.ran).toEqual([]);
		expect(second.result.image).toEqual(first.result.image);
		expect(second.result.perInstanceMs).toEqual([0, 0, 0]);
	});

	it('re-renders from the edited instance onward and no earlier', async () => {
		const {add, render} = setup();
		const [a, b, c] = [add(1), add(2), add(3)];
		await render([a, b, c]);

		const editedMiddle = {...b, params: {amount: 20}};
		const afterMiddle = await render([a, editedMiddle, c]);
		expect(afterMiddle.ran).toEqual([20, 3]);

		const editedLast = {...c, mix: 0.5};
		const afterLast = await render([a, editedMiddle, editedLast]);
		expect(afterLast.ran).toEqual([3]);

		const editedFirst = {...a, params: {amount: 7}};
		const afterFirst = await render([editedFirst, editedMiddle, editedLast]);
		expect(afterFirst.ran).toEqual([7, 20, 3]);
	});

	it('gives the same bytes with and without the cache after an edit', async () => {
		const {add, render, registry} = setup();
		const [a, b, c] = [add(1), add(2, {mix: 0.4, blend: 'difference'}), add(3)];
		await render([a, b, c]);
		const edited = [a, {...b, params: {amount: 90}}, c];
		const cached = await render(edited);
		const fresh = await renderStack(
			source,
			stack(...edited),
			registry,
			options(source),
		);
		expect(cached.result.image).toEqual(fresh.image);
	});

	it('reuses a shorter prefix when instances are appended', async () => {
		const {add, render} = setup();
		const [a, b] = [add(1), add(2)];
		await render([a, b]);
		expect((await render([a, b, add(3)])).ran).toEqual([3]);
	});

	it('ignores disabled instances in the key', async () => {
		const {add, render} = setup();
		const [a, b] = [add(1), add(2)];
		const off = add(50, {enabled: false});
		await render([a, off, b]);
		const edited = {...off, params: {amount: 99}};
		expect((await render([a, edited, b])).ran).toEqual([]);
		expect((await render([a, b])).ran).toEqual([]);
		expect((await render([a, {...off, enabled: true}, b])).ran).toEqual([
			50, 2,
		]);
	});

	it('misses when the level, the source key or the render size differs', async () => {
		const {add, cache, render, registry} = setup();
		const instances = [add(1)];
		await render(instances);
		expect((await render(instances, {level: 'drag'})).ran).toEqual([1]);
		expect((await render(instances, {sourceKey: 'other'})).ran).toEqual([1]);
		expect((await render(instances)).ran).toEqual([]);

		const smaller = noiseImage(4, 4, 8);
		const before = cache.size;
		await renderStack(
			smaller,
			stack(...instances),
			registry,
			options(smaller, {cache, sourceKey: 'photo'}),
		);
		expect(cache.size).toBe(before + 1);
	});

	it('still reports warnings when the result comes from the cache', async () => {
		const {add, render} = setup();
		const wild = add(9999);
		const unknown = instance('fromTheFuture');
		const first = await render([wild, unknown]);
		const second = await render([wild, unknown]);
		expect(second.ran).toEqual([]);
		expect(second.result.warnings).toEqual(first.result.warnings);
		expect(second.result.warnings).toHaveLength(2);
	});

	it('hands out copies: writing to a result does not change the cached stage', async () => {
		const {add, render} = setup();
		const instances = [add(1)];
		const first = await render(instances);
		const expected = bytes(first.result.image);
		first.result.image.data.fill(0);
		const second = await render(instances);
		second.result.image.data.fill(0);
		const third = await render(instances);
		expect(third.ran).toEqual([]);
		expect(bytes(third.result.image)).toEqual(expected);
	});

	it('does not write during a debug render, but reads earlier stages', async () => {
		const {add, cache, render} = setup();
		const a = add(1);
		const target = instance('testSelection');
		const debug = {instanceId: target.id, view: 'selection'} as const;

		await render([a, target], {debug});
		expect(cache.size).toBe(0);

		await render([a, target]);
		expect(cache.size).toBe(2);
		const shown = await render([a, target], {debug});
		expect(shown.ran).toEqual([]);
		expect(bytes(shown.result.image)).toEqual(
			Array.from({length: 80}, () => 255),
		);
		expect(cache.size).toBe(2);

		const normal = await render([a, target]);
		expect(bytes(normal.result.image)).not.toEqual(bytes(shown.result.image));
	});

	it('keeps at most six stages, so a longer stack re-renders its start', async () => {
		const {add, cache, render} = setup();
		const instances = [1, 2, 3, 4, 5, 6, 7, 8].map((amount) => add(amount));
		await render(instances);
		expect(cache.size).toBe(6);
		expect((await render(instances)).ran).toEqual([]);
		expect((await render(instances.slice(0, 2))).ran).toEqual([1, 2]);
	});
});
