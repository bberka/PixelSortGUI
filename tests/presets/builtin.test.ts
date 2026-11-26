import {describe, expect, it} from 'vite-plus/test';
import {effectRegistry} from '../../src/engine/effects/index.ts';
import {
	defaultParams,
	resolveInstance,
	validateParams,
} from '../../src/engine/params.ts';
import {renderStack} from '../../src/engine/pipeline.ts';
import {canonicalJson} from '../../src/engine/types.ts';
import {BUILTIN_PRESETS, getBuiltinPreset} from '../../src/presets/builtin.ts';
import {createGradient64x48} from '../fixtures/synthetic.ts';

describe('built-in presets (engine.md section 7)', () => {
	it('defines the eight presets with unique ids', () => {
		const ids = BUILTIN_PRESETS.map((preset) => preset.id);
		expect(ids).toEqual([
			'builtin:bright-streaks',
			'builtin:dark-drips',
			'builtin:asdf-classic',
			'builtin:grey-band',
			'builtin:hue-bands',
			'builtin:edge-melt',
			'builtin:vhs-split',
			'builtin:tile-scramble',
		]);
		expect(new Set(ids).size).toBe(8);
		for (const preset of BUILTIN_PRESETS) {
			expect(getBuiltinPreset(preset.id)).toBe(preset);
		}
	});

	it('every preset instance passes validateParams unchanged, uses a registered effect at current version, and has a unique id', () => {
		const allInstanceIds = new Set<string>();

		for (const preset of BUILTIN_PRESETS) {
			const stackInstanceIds = new Set<string>();
			expect(preset.stack.schemaVersion).toBe(1);
			expect(preset.stack.instances.length).toBeGreaterThan(0);

			for (const instance of preset.stack.instances) {
				expect(instance.id).toMatch(/^[0-9a-z]{8}$/);
				expect(stackInstanceIds.has(instance.id)).toBe(false);
				expect(allInstanceIds.has(instance.id)).toBe(false);
				stackInstanceIds.add(instance.id);
				allInstanceIds.add(instance.id);

				const definition = effectRegistry.get(instance.type);
				expect(definition, `${preset.id} -> ${instance.type}`).toBeDefined();
				if (!definition) {
					continue;
				}

				expect(instance.version).toBe(definition.version);

				const validated = validateParams(definition.params, instance.params);
				expect(canonicalJson(validated)).toBe(canonicalJson(instance.params));

				const resolved = resolveInstance(instance, effectRegistry);
				expect(resolved.status).toBe('ok');
				if (resolved.status !== 'ok') {
					continue;
				}

				expect(resolved.migrated).toBe(false);
				expect(resolved.fixed).toBe(false);
			}
		}
	});

	it('gives vhs-split and tile-scramble the instances and values of the spec table', () => {
		const instances = (id: string) =>
			getBuiltinPreset(id)?.stack.instances.map(({type, params}) => ({
				type,
				params,
			}));
		const defaults = (type: string) =>
			defaultParams(effectRegistry.get(type)!.params);

		expect(instances('builtin:vhs-split')).toEqual([
			{type: 'sliceShift', params: {...defaults('sliceShift'), seed: 7}},
			{type: 'channelShift', params: defaults('channelShift')},
		]);
		expect(instances('builtin:tile-scramble')).toEqual([
			{type: 'blockShuffle', params: {tileSize: 96, amount: 0.25, seed: 3}},
			{type: 'channelSwap', params: {order: 'gbr'}},
		]);
	});

	it('applying each preset to gradient-64x48 runs without error or warnings and changes the image', async () => {
		const source = createGradient64x48();

		for (const preset of BUILTIN_PRESETS) {
			const result = await renderStack(source, preset.stack, effectRegistry, {
				level: 'full',
				sourceWidth: source.width,
				sourceHeight: source.height,
				checkpoint() {},
			});

			expect(result.warnings).toEqual([]);
			expect(result.image.width).toBe(source.width);
			expect(result.image.height).toBe(source.height);

			let changedBytes = 0;
			for (let i = 0; i < source.data.length; i++) {
				if (result.image.data[i] !== source.data[i]) {
					changedBytes++;
				}
			}

			expect(
				changedBytes,
				`${preset.id} should change gradient-64x48`,
			).toBeGreaterThan(0);
		}
	});
});
