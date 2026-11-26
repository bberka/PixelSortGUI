import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vite-plus/test';
import {
	defaultOutputPath,
	generateLanczosTableSource,
	LANCZOS_TABLE_LENGTH,
} from '../../scripts/gen-lanczos-table.ts';
import {LANCZOS_TABLE} from '../../src/engine/lanczos-table.ts';

const ONE = 2 ** 22;
const sinc = (x: number) => Math.sin(Math.PI * x) / (Math.PI * x);

describe('LANCZOS_TABLE (engine.md section 16.3)', () => {
	it('has 1,024 entries with exact values at the integer distances', () => {
		expect(LANCZOS_TABLE).toHaveLength(LANCZOS_TABLE_LENGTH);
		expect(LANCZOS_TABLE_LENGTH).toBe(1024);
		expect(LANCZOS_TABLE[0]).toBe(ONE);
		for (const i of [341, 682, 1023]) {
			expect(Object.is(LANCZOS_TABLE[i], 0)).toBe(true);
		}
	});

	it('matches sinc(t) * sinc(t / 3) within +/-1 on [0, 3]', () => {
		for (let i = 1; i < LANCZOS_TABLE_LENGTH; i++) {
			const t = (3 * i) / 1023;
			expect(Number.isSafeInteger(LANCZOS_TABLE[i])).toBe(true);
			expect(
				Math.abs(LANCZOS_TABLE[i] - ONE * sinc(t) * sinc(t / 3)),
			).toBeLessThanOrEqual(1);
		}
	});

	it('is positive, negative, then positive between the zero crossings', () => {
		expect(LANCZOS_TABLE.slice(0, 341).every((v) => v > 0)).toBe(true);
		expect(LANCZOS_TABLE.slice(342, 682).every((v) => v < 0)).toBe(true);
		expect(LANCZOS_TABLE.slice(683, 1023).every((v) => v > 0)).toBe(true);
	});

	it('checked-in src/engine/lanczos-table.ts matches generator output byte-for-byte', () => {
		const checkedIn = readFileSync(defaultOutputPath, 'utf8');
		expect(checkedIn).toBe(generateLanczosTableSource());
	});
});
