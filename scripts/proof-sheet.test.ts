import {describe, expect, it} from 'vite-plus/test';
import {layoutSheet, MAX_EDGE} from './proof-sheet.ts';

describe('layoutSheet', () => {
	it('packs the three proof viewports within MAX_EDGE without overlap', () => {
		const sheet = layoutSheet([
			{width: 390, height: 844},
			{width: 820, height: 1180},
			{width: 1440, height: 900},
		]);

		expect(sheet.width).toBeLessThanOrEqual(MAX_EDGE);
		expect(sheet.height).toBeLessThanOrEqual(MAX_EDGE);
		expect(sheet.tiles).toHaveLength(3);
		for (const tile of sheet.tiles) {
			expect(tile.width).toBeGreaterThan(0);
			expect(tile.height).toBeGreaterThan(0);
		}
	});

	it('throws when given no images', () => {
		expect(() => layoutSheet([])).toThrow(
			'A contact sheet needs at least one image.',
		);
	});
});
