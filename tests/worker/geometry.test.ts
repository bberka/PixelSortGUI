import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {renderSizeForPixelCap} from '../../src/codec/decode.ts';
import {
	applyTransform,
	effectiveDimensions,
	orientedDimensions,
	type RotationDegrees,
	type SourceTransform,
} from '../../src/engine/transform.ts';
import {createImage} from '../../src/engine/types.ts';
import {planProxy} from '../../src/worker/geometry.ts';

const side = fc.integer({min: 1, max: 60});

const caseArbitrary = fc
	.record({
		width: side,
		height: side,
		rotation: fc.constantFrom<RotationDegrees>(0, 90, 180, 270),
		cap: fc.integer({min: 1, max: 4000}),
	})
	.chain((base) => {
		const oriented = orientedDimensions(base.width, base.height, base.rotation);
		const crop = fc.option(
			fc
				.tuple(
					fc.integer({min: 0, max: oriented.width - 1}),
					fc.integer({min: 0, max: oriented.height - 1}),
				)
				.chain(([x, y]) =>
					fc.record({
						x: fc.constant(x),
						y: fc.constant(y),
						width: fc.integer({min: 1, max: oriented.width - x}),
						height: fc.integer({min: 1, max: oriented.height - y}),
					}),
				),
		);
		const resize = fc.option(
			fc.record({
				width: side,
				height: side,
				filter: fc.constantFrom('lanczos3', 'bilinear', 'nearest' as const),
			}),
		);
		return fc.record({
			base: fc.constant(base),
			crop,
			resize,
			flipX: fc.boolean(),
			flipY: fc.boolean(),
		});
	});

describe('planProxy', () => {
	it('turns a decode of the planned size into exactly the proxy size', () => {
		fc.assert(
			fc.property(caseArbitrary, ({base, ...rest}) => {
				const {width, height, rotation, cap} = base;
				const transform = {rotation, ...rest} as SourceTransform;
				const effective = effectiveDimensions(width, height, transform);
				const target = renderSizeForPixelCap(
					effective.width,
					effective.height,
					cap,
				);
				const plan = planProxy(width, height, transform, target);

				expect(plan.decode.width).toBeGreaterThanOrEqual(1);
				expect(plan.decode.width).toBeLessThanOrEqual(width);
				expect(plan.decode.height).toBeGreaterThanOrEqual(1);
				expect(plan.decode.height).toBeLessThanOrEqual(height);
				const result = applyTransform(
					createImage(plan.decode.width, plan.decode.height),
					plan.transform,
				);
				expect([result.width, result.height]).toEqual([
					target.width,
					target.height,
				]);
			}),
			{numRuns: 500},
		);
	});

	it('decodes a large crop just big enough for the proxy', () => {
		const transform: SourceTransform = {
			rotation: 90,
			flipX: false,
			flipY: false,
			crop: {x: 1000, y: 2000, width: 4000, height: 3000},
			resize: null,
		};
		// 12 MP crop of a 48 MP source into 3 MP: half size on each side.
		expect(
			planProxy(8000, 6000, transform, {width: 2000, height: 1500}),
		).toEqual({
			decode: {width: 4000, height: 3000},
			transform: {
				...transform,
				crop: {x: 500, y: 1000, width: 2000, height: 1500},
				resize: {width: 2000, height: 1500, filter: 'lanczos3'},
			},
		});
	});
});
