import {describe, expect, it} from 'vite-plus/test';
import {createRegistry} from '../../src/engine/registry.ts';
import {addEffect, invertEffect, noiseEffect} from './sample-effects.ts';

describe('createRegistry', () => {
	it('finds a definition by type', () => {
		const registry = createRegistry([invertEffect, noiseEffect]);
		expect(registry.get('testNoise')).toBe(noiseEffect);
		expect(registry.get('missing')).toBeUndefined();
	});

	it('lists definitions in registration order', () => {
		const add = addEffect();
		const registry = createRegistry([noiseEffect, add, invertEffect]);
		expect(registry.list()).toEqual([noiseEffect, add, invertEffect]);
	});

	it('throws on a duplicate type', () => {
		expect(() =>
			createRegistry([addEffect(), invertEffect, addEffect()]),
		).toThrow('Duplicate effect type "testAdd"');
	});

	it('is not changed by later edits to the array it was built from', () => {
		const definitions = [invertEffect];
		const registry = createRegistry(definitions);
		definitions.push(noiseEffect);
		expect(registry.list()).toEqual([invertEffect]);
	});

	it('does not treat Object.prototype members as registered types', () => {
		expect(createRegistry([invertEffect]).get('constructor')).toBeUndefined();
	});
});
