/**
 A minimal TIFF writer for the format tests (engine.md section 16.4): one strip
 per page, either byte order, 8-bit or 16-bit samples.
 */

export type TiffFixture = {
	readonly width: number;
	readonly height: number;
	/**
	Sample values in storage order, `samples` per pixel.
	*/
	readonly pixels: ArrayLike<number>;
	readonly bits?: 8 | 16;
	readonly samples?: number;
	readonly photometric?: number;
	readonly littleEndian?: boolean;
	/**
	Written to tag 259; `strip` replaces the raw sample bytes when given.
	*/
	readonly compression?: number;
	readonly strip?: Uint8Array;
	readonly orientation?: number;
	readonly extraTags?: ReadonlyArray<readonly [number, readonly number[]]>;
};

const SHORT = 3;
const LONG = 4;

export function tiffSampleBytes({
	pixels,
	bits = 8,
	littleEndian = true,
}: TiffFixture): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(pixels.length * (bits / 8));
	const view = new DataView(out.buffer);
	for (const [i, value] of Array.from(pixels).entries()) {
		if (bits === 8) {
			out[i] = value;
		} else {
			view.setUint16(i * 2, value, littleEndian);
		}
	}

	return out;
}

export function tiffBytes(fixture: TiffFixture): Uint8Array<ArrayBuffer> {
	const {
		width,
		height,
		bits = 8,
		samples = 3,
		photometric = 2,
		littleEndian = true,
		compression = 1,
		orientation,
		extraTags = [],
	} = fixture;
	const strip = fixture.strip ?? tiffSampleBytes(fixture);
	const stripOffset = 8;
	const directory = stripOffset + strip.length + (strip.length % 2);

	const tags: Array<readonly [number, number, readonly number[]]> = [
		[256, LONG, [width]],
		[257, LONG, [height]],
		[258, SHORT, Array.from({length: samples}, () => bits)],
		[259, SHORT, [compression]],
		[262, SHORT, [photometric]],
		[273, LONG, [stripOffset]],
		...(orientation === undefined
			? []
			: [[274, SHORT, [orientation]] as const]),
		[277, SHORT, [samples]],
		[278, LONG, [height]],
		[279, LONG, [strip.length]],
		...extraTags.map(([tag, values]) => [tag, SHORT, values] as const),
	];
	tags.sort((a, b) => a[0] - b[0]);

	const directoryBytes = 2 + tags.length * 12 + 4;
	let overflow = directory + directoryBytes;
	let overflowBytes = 0;
	for (const [, type, values] of tags) {
		const length = values.length * (type === SHORT ? 2 : 4);
		overflowBytes += length > 4 ? length : 0;
	}

	const out = new Uint8Array(overflow + overflowBytes);
	const view = new DataView(out.buffer);
	out.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]);
	view.setUint16(2, 42, littleEndian);
	view.setUint32(4, directory, littleEndian);
	out.set(strip, stripOffset);
	view.setUint16(directory, tags.length, littleEndian);

	for (const [index, [tag, type, values]] of tags.entries()) {
		const entry = directory + 2 + index * 12;
		const size = type === SHORT ? 2 : 4;
		view.setUint16(entry, tag, littleEndian);
		view.setUint16(entry + 2, type, littleEndian);
		view.setUint32(entry + 4, values.length, littleEndian);
		let at = entry + 8;
		if (values.length * size > 4) {
			view.setUint32(at, overflow, littleEndian);
			at = overflow;
			overflow += values.length * size;
		}

		for (const [i, value] of values.entries()) {
			if (type === SHORT) {
				view.setUint16(at + i * 2, value, littleEndian);
			} else {
				view.setUint32(at + i * 4, value, littleEndian);
			}
		}
	}

	return out;
}
