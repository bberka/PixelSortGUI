import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vite-plus/test';
import {buildEffectsReference} from './effects-reference.ts';
import {Block} from './guide-blocks.tsx';
import {GUIDE_SECTIONS} from './content.ts';
import {effectRegistry} from '@/engine/effects/index.ts';
import {createRegistry, listedEffects} from '@/engine/registry.ts';
import type {EffectDefinition} from '@/engine/types.ts';

describe('guide effects reference (AC-F27.4)', () => {
	it('lists every registered effect with every parameter label', () => {
		const html = renderToStaticMarkup(<Block block={{kind: 'effects'}} />);

		expect(listedEffects(effectRegistry).length).toBeGreaterThan(0);
		for (const definition of listedEffects(effectRegistry)) {
			expect(html).toContain(`data-guide-effect="${definition.type}"`);
			expect(html).toContain(definition.label);
			const entry = buildEffectsReference(effectRegistry).find(
				(item) => item.type === definition.type,
			);
			expect(entry?.params.map((param) => param.label)).toEqual(
				Object.values(definition.params).map((spec) => spec.label),
			);
		}
	});

	it('lists Image blend with its image parameter', () => {
		const entry = buildEffectsReference(effectRegistry).find(
			(item) => item.type === 'imageBlend',
		);

		expect(entry?.params[0]).toMatchObject({
			label: 'Blend image',
			range: 'An image',
			defaultValue: 'None',
		});
	});

	it('leaves out unlisted effects', () => {
		const hidden = {...effectRegistry.list()[0], unlisted: true};

		expect(buildEffectsReference(createRegistry([hidden]))).toEqual([]);
	});

	it('is part of the guide', () => {
		expect(
			GUIDE_SECTIONS.flatMap((section) => section.blocks).filter(
				(block) => block.kind === 'effects',
			),
		).toHaveLength(1);
	});

	it('describes range, default and visibility of an effect added to the registry', () => {
		const added: EffectDefinition = {
			type: 'testEffect',
			version: 1,
			label: 'Test effect',
			description: 'Added by a test.',
			category: 'glitch',
			params: {
				mode: {
					kind: 'enum',
					label: 'Mode',
					group: 'A',
					options: [
						{value: 'a', label: 'Alpha'},
						{value: 'b', label: 'Beta'},
					],
					default: 'b',
				},
				amount: {
					kind: 'number',
					label: 'Amount',
					group: 'A',
					min: 0,
					max: 1,
					step: 0.01,
					default: 0.5,
					unit: 'percent',
					visibleWhen: {param: 'mode', equals: ['a']},
				},
				size: {
					kind: 'integer',
					label: 'Size',
					group: 'A',
					min: 1,
					max: 9,
					default: 3,
					unit: 'px',
				},
				picture: {kind: 'image', label: 'Picture', group: 'A', default: ''},
			},
			render() {},
		};

		const [entry] = buildEffectsReference(createRegistry([added]));

		expect(entry.params).toMatchObject([
			{range: 'Alpha, Beta', defaultValue: 'Beta'},
			{
				range: '0% to 100%',
				defaultValue: '50%',
				shownWhen: 'Mode is Alpha',
			},
			{range: '1 to 9 px', defaultValue: '3 px'},
			{range: 'An image', defaultValue: 'None'},
		]);
	});
});
