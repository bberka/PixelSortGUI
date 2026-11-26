import {describe, expect, it} from 'vite-plus/test';
import {isSvgFile, svgRasterSize} from './rasterize-svg.ts';

function size(
	width: string | null,
	height: string | null,
	viewBox: string | null = null,
) {
	const result = svgRasterSize({width, height, viewBox});
	return [result.width, result.height, result.viewBox];
}

describe('svgRasterSize', () => {
	it('scales a viewBox-only SVG to 2,048 px on its longest side', () => {
		expect(size(null, null, '0 0 100 50')).toEqual([2048, 1024, '0 0 100 50']);
		expect(size(null, null, '-5,-5,50,100')).toEqual([
			1024,
			2048,
			'-5,-5,50,100',
		]);
		expect(size(null, null, '0 0 8192 4096')).toEqual([
			2048,
			1024,
			'0 0 8192 4096',
		]);
	});

	it('treats relative and invalid lengths as no pixel size', () => {
		for (const value of ['100%', '10em', 'auto', '0', '-4', '3constructor']) {
			expect(size(value, value, '0 0 100 50')).toEqual([
				2048,
				1024,
				'0 0 100 50',
			]);
		}
	});

	it('uses a stated pixel size and adds the viewBox that scales it', () => {
		expect(size('640', '480px')).toEqual([640, 480, '0 0 640 480']);
		expect(size('1in', '72pt')).toEqual([96, 96, '0 0 96 96']);
		expect(size('300', '300', '0 0 10 20')).toEqual([300, 300, '0 0 10 20']);
	});

	it('derives one missing side from the viewBox ratio', () => {
		expect(size('500', null, '0 0 100 50')).toEqual([500, 250, '0 0 100 50']);
		expect(size(null, '500', '0 0 100 50')).toEqual([1000, 500, '0 0 100 50']);
	});

	it('falls back to the default viewport without a viewBox', () => {
		expect(size(null, null)).toEqual([2048, 1024, '0 0 300 150']);
		expect(size('600', null)).toEqual([600, 150, '0 0 600 150']);
		expect(size(null, null, '0 0 0 50')).toEqual([2048, 1024, '0 0 300 150']);
	});

	it('caps the longest side at 16,384 px', () => {
		expect(size('40000', '100')).toEqual([16_384, 40, '0 0 40000 100']);
		expect(size('1e9', '1')).toEqual([16_384, 1, '0 0 1000000000 1']);
	});

	it('caps the area at 50 MP', () => {
		const [width, height] = size('10000', '10000') as [number, number];
		expect([width, height]).toEqual([7071, 7071]);
		expect(width * height).toBeLessThanOrEqual(50_000_000);
	});
});

describe('isSvgFile', () => {
	it('matches the MIME type or the extension', () => {
		expect(isSvgFile(new File([], 'a', {type: 'image/svg+xml'}))).toBe(true);
		expect(isSvgFile(new File([], 'LOGO.SVG'))).toBe(true);
		expect(isSvgFile(new File([], 'a.svg.png', {type: 'image/png'}))).toBe(
			false,
		);
	});
});
