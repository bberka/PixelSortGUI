import {describe, expect, it} from 'vite-plus/test';
import {
	convertSize,
	editSize,
	LIMIT_MESSAGE,
	PERCENT_MESSAGE,
	PIXELS_MESSAGE,
	resizeTarget,
	sizeFields,
} from './resize-fields.ts';

const cropped = {width: 2000, height: 1000};
const locked = {unit: 'px', locked: true, cropped} as const;

describe('resize fields', () => {
	it('pairs the other side with the cropped proportions while locked', () => {
		const start = sizeFields(cropped, null, 'px');
		expect(editSize(start, 'width', '999', locked)).toEqual({
			width: '999',
			height: '500',
		});
		expect(editSize(start, 'height', '10', locked).width).toBe('20');
		expect(editSize(start, 'width', '', locked).height).toBe('1000');
		expect(
			editSize(start, 'width', '999', {...locked, locked: false}).height,
		).toBe('1000');
		expect(
			editSize(start, 'height', '50', {...locked, unit: 'percent'}),
		).toEqual({width: '50', height: '50'});
	});

	it('resolves percentages against the cropped size', () => {
		expect(
			resizeTarget({width: '50', height: '50%'}, 'percent', cropped).output,
		).toEqual({width: 1000, height: 500});
		expect(
			resizeTarget({width: '12.5', height: '200'}, 'percent', cropped).output,
		).toEqual({width: 250, height: 2000});
	});

	it.each([
		['px', '20,000', '10000', LIMIT_MESSAGE],
		['px', '8000', '7000', LIMIT_MESSAGE],
		['px', '0', '10', PIXELS_MESSAGE],
		['px', '10.5', '10', PIXELS_MESSAGE],
		['px', '-4', '10', PIXELS_MESSAGE],
		['percent', '0.5', '50', PERCENT_MESSAGE],
		['percent', '1001', '50', PERCENT_MESSAGE],
		['percent', 'abc', '50', PERCENT_MESSAGE],
		['percent', '1000', '1000', LIMIT_MESSAGE],
	] as const)('refuses %s %s x %s', (unit, width, height, message) => {
		expect(resizeTarget({width, height}, unit, cropped)).toMatchObject({
			error: message,
		});
	});

	it('lets an image above 50 MP shrink but not grow', () => {
		const large = {width: 10_000, height: 8000};
		expect(
			resizeTarget({width: '10000', height: '7999'}, 'px', large).output,
		).toBeDefined();
		expect(
			resizeTarget({width: '10000', height: '8001'}, 'px', large).output,
		).toBeUndefined();
	});

	it('converts between units and falls back to the saved size', () => {
		const resize = {width: 500, height: 250, filter: 'nearest'} as const;
		expect(
			convertSize(
				{width: '500', height: '250'},
				'px',
				'percent',
				cropped,
				null,
			),
		).toEqual({width: '25', height: '25'});
		expect(
			convertSize({width: '', height: ''}, 'px', 'percent', cropped, resize),
		).toEqual({width: '25', height: '25'});
	});
});
