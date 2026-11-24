import fc from 'fast-check';
import {describe, expect, it} from 'vite-plus/test';
import {
	createLinePartition,
	directionForAngle,
	normalizeAngleIndex,
	type LinePartition,
} from '../../src/engine/lines.ts';

type MaterializedLine = {
	k: number;
	posStart: number;
	posStep: 1 | -1;
	offsets: number[];
};

function collectLines(partition: LinePartition): MaterializedLine[] {
	const walker = partition.createWalker();
	const buffer = new Int32Array(partition.maxLineLength);
	const lines: MaterializedLine[] = [];

	while (walker.next()) {
		const len = walker.fillOffsets(buffer);
		expect(len).toBe(walker.length);
		expect(len).toBeGreaterThan(0);
		expect(len).toBeLessThanOrEqual(
			Math.max(partition.width, partition.height),
		);
		expect(buffer[0]).toBe(walker.startOffset);
		lines.push({
			k: walker.k,
			posStart: walker.posStart,
			posStep: walker.posStep,
			offsets: Array.from(buffer.subarray(0, len)),
		});
	}

	return lines;
}

function assertValidPartition(
	partition: LinePartition,
	lines: readonly MaterializedLine[],
): void {
	const {width, height} = partition;
	const totalPixels = width * height;
	const visited = new Uint8Array(totalPixels);
	let visitedCount = 0;

	expect(lines).toHaveLength(partition.lineCount);

	for (const [lineIdx, line] of lines.entries()) {
		expect(line.k).toBe(partition.kStart + lineIdx);
		expect(line.offsets.length).toBeGreaterThan(0);
		expect(line.offsets.length).toBeLessThanOrEqual(Math.max(width, height));

		let prevX = -1;
		let prevY = -1;
		for (const [i, offset] of line.offsets.entries()) {
			expect(offset).toBeGreaterThanOrEqual(0);
			expect(offset).toBeLessThan(totalPixels);
			expect(visited[offset]).toBe(0);
			visited[offset] = 1;
			visitedCount++;

			const x = offset % width;
			const y = Math.floor(offset / width);
			const expectedPos = line.posStart + i * line.posStep;
			expect(partition.major === 'horizontal' ? x : y).toBe(expectedPos);

			if (i > 0) {
				const stepX = Math.abs(x - prevX);
				const stepY = Math.abs(y - prevY);
				expect(Math.max(stepX, stepY)).toBe(1);
			}

			prevX = x;
			prevY = y;
		}
	}

	expect(visitedCount).toBe(totalPixels);
}

function assertGatherScatterRoundTrip(partition: LinePartition): void {
	const total = partition.width * partition.height;
	const in32 = new Uint32Array(total);
	for (let i = 0; i < total; i++) {
		in32[i] = (i * 2_654_435_761) % 4_294_967_296;
	}

	const out32 = new Uint32Array(total);
	const lineBuf = new Uint32Array(partition.maxLineLength);
	const offsetBuf = new Int32Array(partition.maxLineLength);
	const walker = partition.createWalker();

	while (walker.next()) {
		const len = walker.gather32(in32, lineBuf);
		expect(len).toBe(walker.length);
		walker.fillOffsets(offsetBuf);
		for (let i = 0; i < len; i++) {
			expect(lineBuf[i]).toBe(in32[offsetBuf[i]]);
		}

		walker.scatter32(lineBuf, out32);
	}

	expect(out32).toEqual(in32);
}

describe('line partition (engine.md section 5.2, 14.1, 14.3)', () => {
	const SPEC_ANGLES = [
		0, 0.1, 30, 44.9, 45, 45.1, 90, 135, 180, 225, 270, 315, 359.9,
	];

	it('normalizes angles to tenths of a degree in [0, 3600)', () => {
		expect(normalizeAngleIndex(0)).toBe(0);
		expect(normalizeAngleIndex(360)).toBe(0);
		expect(normalizeAngleIndex(-90)).toBe(2700);
		expect(normalizeAngleIndex(359.96)).toBe(0);
		expect(normalizeAngleIndex(-0.04)).toBe(0);
		expect(directionForAngle(45)).toEqual([2896, -2896]);
		expect(directionForAngle(30)).toEqual([3547, -2048]);
	});

	it('rejects non-positive or non-integer dimensions', () => {
		expect(() => createLinePartition(0, 10, 0)).toThrow(RangeError);
		expect(() => createLinePartition(10, 0, 0)).toThrow(RangeError);
		expect(() => createLinePartition(-5, 10, 30)).toThrow(RangeError);
		expect(() => createLinePartition(10.5, 10, 30)).toThrow(RangeError);
	});

	it('satisfies spec examples for 0, 45, 90, 180, and 270 degrees', () => {
		// Angle 0: rows left-to-right on 3x2
		const p0 = createLinePartition(3, 2, 0);
		expect(p0.fastPath).toBe('0');
		expect(collectLines(p0).map((l) => l.offsets)).toEqual([
			[0, 1, 2],
			[3, 4, 5],
		]);

		// Angle 180: rows right-to-left on 3x2
		const p180 = createLinePartition(3, 2, 180);
		expect(p180.fastPath).toBe('180');
		expect(collectLines(p180).map((l) => l.offsets)).toEqual([
			[2, 1, 0],
			[5, 4, 3],
		]);

		// Angle 90: columns bottom-to-top on 3x2
		const p90 = createLinePartition(3, 2, 90);
		expect(p90.fastPath).toBe('90');
		expect(collectLines(p90).map((l) => l.offsets)).toEqual([
			[3, 0],
			[4, 1],
			[5, 2],
		]);

		// Angle 270: columns top-to-bottom on 3x2
		const p270 = createLinePartition(3, 2, 270);
		expect(p270.fastPath).toBe('270');
		expect(collectLines(p270).map((l) => l.offsets)).toEqual([
			[0, 3],
			[1, 4],
			[2, 5],
		]);

		// Angle 45: (DX, DY) = (2896, -2896), o(x) = -x, lines (x, k - x) up and right on 3x2
		const p45 = createLinePartition(3, 2, 45);
		expect(p45.fastPath).toBe('none');
		expect(p45.major).toBe('horizontal');
		expect(collectLines(p45).map((l) => l.offsets)).toEqual([
			[0],
			[3, 1],
			[4, 2],
			[5],
		]);
	});

	it('satisfies partition invariants for all 13 spec angles across non-square and 1px shapes', () => {
		const shapes: Array<readonly [number, number]> = [
			[37, 23],
			[23, 37],
			[1, 17],
			[19, 1],
			[1, 1],
		];

		for (const [w, h] of shapes) {
			for (const angle of SPEC_ANGLES) {
				const partition = createLinePartition(w, h, angle);
				const lines = collectLines(partition);
				assertValidPartition(partition, lines);
				assertGatherScatterRoundTrip(partition);
			}
		}
	});

	it('fast paths at 0, 90, 180, and 270 match the general method identically', () => {
		const shapes: Array<readonly [number, number]> = [
			[1, 1],
			[1, 13],
			[11, 1],
			[17, 29],
			[32, 15],
		];
		const cardinalAngles = [0, 90, 180, 270, 360, -90, -180, 450];

		for (const [w, h] of shapes) {
			for (const angle of cardinalAngles) {
				const fast = createLinePartition(w, h, angle);
				const general = createLinePartition(w, h, angle, {
					disableFastPath: true,
				});

				expect(fast.fastPath).not.toBe('none');
				expect(general.fastPath).toBe('none');
				expect(fast.lineCount).toBe(general.lineCount);
				expect(fast.kStart).toBe(general.kStart);
				expect(fast.kEnd).toBe(general.kEnd);
				expect(fast.major).toBe(general.major);
				expect(fast.posStep).toBe(general.posStep);
				expect(collectLines(fast)).toEqual(collectLines(general));
				assertGatherScatterRoundTrip(fast);
				assertGatherScatterRoundTrip(general);
			}
		}
	});

	it('property: covers every pixel once, 8-connected, length <= max(W,H), and θ+180 reverses lines (200 runs)', () => {
		const dimArb = fc.oneof(fc.constant(1), fc.integer({min: 2, max: 64}));
		const angleArb = fc.integer({min: -3600, max: 7200}).map((t) => t / 10);

		fc.assert(
			fc.property(dimArb, dimArb, angleArb, (width, height, angle) => {
				const forward = createLinePartition(width, height, angle);
				const forwardLines = collectLines(forward);
				assertValidPartition(forward, forwardLines);
				assertGatherScatterRoundTrip(forward);

				const reversed = createLinePartition(width, height, angle + 180);
				const reversedLines = collectLines(reversed);
				assertValidPartition(reversed, reversedLines);

				expect(reversedLines).toHaveLength(forwardLines.length);
				for (const [i, fLine] of forwardLines.entries()) {
					const rLine = reversedLines[i];
					expect(rLine.k).toBe(fLine.k);
					expect(rLine.offsets).toEqual(fLine.offsets.toReversed());
				}
			}),
			{numRuns: 200},
		);
	});
});
