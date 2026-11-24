import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vite-plus/test';
import {
	DIRECTION_TABLE_LENGTH,
	defaultOutputPath,
	generateDirectionTableSource,
} from '../../scripts/gen-direction-table.ts';
import {DIRECTION_TABLE} from '../../src/engine/direction-table.ts';

describe('DIRECTION_TABLE (engine.md section 5.2)', () => {
	it('has 3,600 entries with exact cardinal vectors', () => {
		expect(DIRECTION_TABLE).toHaveLength(DIRECTION_TABLE_LENGTH);
		expect(DIRECTION_TABLE[0]).toEqual([4096, 0]);
		expect(DIRECTION_TABLE[900]).toEqual([0, -4096]);
		expect(DIRECTION_TABLE[1800]).toEqual([-4096, 0]);
		expect(DIRECTION_TABLE[2700]).toEqual([0, 4096]);
	});

	it('matches 4096 * (cos, -sin) within +/-1 for every tenth of a degree', () => {
		for (let a = 0; a < DIRECTION_TABLE_LENGTH; a++) {
			const [dx, dy] = DIRECTION_TABLE[a];
			expect(Number.isSafeInteger(dx)).toBe(true);
			expect(Number.isSafeInteger(dy)).toBe(true);
			expect(Object.is(dx, -0)).toBe(false);
			expect(Object.is(dy, -0)).toBe(false);
			expect(dx !== 0 || dy !== 0).toBe(true);

			const theta = ((a / 10) * Math.PI) / 180;
			const exactDx = 4096 * Math.cos(theta);
			const exactDy = -4096 * Math.sin(theta);
			expect(Math.abs(dx - exactDx)).toBeLessThanOrEqual(1);
			expect(Math.abs(dy - exactDy)).toBeLessThanOrEqual(1);
		}
	});

	it('negates (dx, dy) exactly for opposite angles a and a + 1800', () => {
		for (let a = 0; a < 1800; a++) {
			const [dx1, dy1] = DIRECTION_TABLE[a];
			const [dx2, dy2] = DIRECTION_TABLE[a + 1800];
			expect(dx2).toBe(dx1 === 0 ? 0 : -dx1);
			expect(dy2).toBe(dy1 === 0 ? 0 : -dy1);
		}
	});

	it('checked-in src/engine/direction-table.ts matches generator output byte-for-byte', () => {
		const checkedIn = readFileSync(defaultOutputPath, 'utf8');
		const generated = generateDirectionTableSource();
		expect(checkedIn).toBe(generated);
	});
});
