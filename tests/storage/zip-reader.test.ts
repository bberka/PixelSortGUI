import {strToU8, zipSync} from 'fflate';
import {describe, expect, it} from 'vite-plus/test';
import {
	readZipDirectory,
	readZipEntry,
	ZipFormatError,
} from '../../src/storage/zip-reader.ts';

const CONTENT = strToU8('hello hello hello');

function archive(level: 0 | 6 = 0) {
	return zipSync({'a.txt': CONTENT}, {level});
}

// Rewrites a one-entry archive so its sizes, offset and directory position are
// only given by ZIP64 records.
function asZip64(zip: Uint8Array<ArrayBuffer>) {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const end = zip.length - 22;
	const size = view.getUint32(end + 12, true);
	const offset = view.getUint32(end + 16, true);
	const nameLength = view.getUint16(offset + 28, true);
	const entry = zip.slice(offset, offset + size);
	const entryView = new DataView(entry.buffer);
	const extra = new DataView(new ArrayBuffer(28));
	extra.setUint16(0, 1, true);
	extra.setUint16(2, 24, true);
	extra.setBigUint64(4, BigInt(entryView.getUint32(24, true)), true);
	extra.setBigUint64(12, BigInt(entryView.getUint32(20, true)), true);
	extra.setBigUint64(20, BigInt(entryView.getUint32(42, true)), true);
	for (const at of [20, 24, 42]) {
		entryView.setUint32(at, 0xff_ff_ff_ff, true);
	}

	entryView.setUint16(30, 28, true);
	const central = new Uint8Array([
		...entry.subarray(0, 46 + nameLength),
		...new Uint8Array(extra.buffer, extra.byteOffset, extra.byteLength),
	]);

	const end64 = new DataView(new ArrayBuffer(56));
	end64.setUint32(0, 0x06_06_4b_50, true);
	end64.setBigUint64(32, 1n, true);
	end64.setBigUint64(40, BigInt(central.length), true);
	end64.setBigUint64(48, BigInt(offset), true);
	const locator = new DataView(new ArrayBuffer(20));
	locator.setUint32(0, 0x07_06_4b_50, true);
	locator.setBigUint64(8, BigInt(offset + central.length), true);
	const last = zip.slice(end);
	const lastView = new DataView(last.buffer);
	lastView.setUint16(10, 0xff_ff, true);
	lastView.setUint32(12, 0xff_ff_ff_ff, true);
	lastView.setUint32(16, 0xff_ff_ff_ff, true);
	return new Blob([
		zip.slice(0, offset),
		central,
		end64.buffer,
		locator.buffer,
		last,
	]);
}

async function read(blob: Blob) {
	const directory = await readZipDirectory(blob);
	return readZipEntry(blob, directory, directory.entries.get('a.txt')!, {
		limit: 1000,
	});
}

// The archive with one 16-bit or 32-bit field of its directory entry changed.
function patched(field: number, value: number, bytes: 2 | 4 = 2) {
	const zip = archive();
	const view = new DataView(zip.buffer, zip.byteOffset);
	const entry = view.getUint32(zip.length - 6, true);
	if (bytes === 2) {
		view.setUint16(entry + field, value, true);
	} else {
		view.setUint32(entry + field, value, true);
	}

	return new Blob([zip]);
}

describe('zip reader', () => {
	it.each([0, 6] as const)('reads an entry at level %s', async (level) => {
		expect(await read(new Blob([archive(level)]))).toStrictEqual(
			new Uint8Array(CONTENT),
		);
	});

	it('reads ZIP64 records', async () => {
		expect(await read(asZip64(archive()))).toStrictEqual(
			new Uint8Array(CONTENT),
		);
	});

	it('finds the end record behind an archive comment', async () => {
		const zip = zipSync({'a.txt': CONTENT}, {comment: 'a note'});
		expect(await read(new Blob([zip]))).toStrictEqual(new Uint8Array(CONTENT));
	});

	it.each([
		['an encrypted entry', patched(8, 1)],
		['an unknown compression method', patched(10, 12)],
		['an offset outside the file', patched(42, 100_000, 4)],
		['an offset that is not a local header', patched(42, 3, 4)],
		['data reaching into the directory', patched(20, 10_000, 4)],
	])('refuses %s', async (_name, blob) => {
		await expect(read(blob)).rejects.toThrow(ZipFormatError);
	});
});
