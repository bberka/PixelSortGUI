// A ZIP reader that takes entry offsets and sizes from the central directory
// (persistence.md section 8.3.1 says why `fflate.Unzip` is not used).
import {Inflate} from 'fflate';

export const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024;

// The end record is 22 bytes and its comment at most 65535.
const MAX_END_BYTES = 22 + 65_535;
const END_SIGNATURE = 0x06_05_4b_50;
const END64_SIGNATURE = 0x06_06_4b_50;
const LOCATOR64_SIGNATURE = 0x07_06_4b_50;
const ENTRY_SIGNATURE = 0x02_01_4b_50;
const LOCAL_SIGNATURE = 0x04_03_4b_50;
const UINT16_MAX = 0xff_ff;
const UINT32_MAX = 0xff_ff_ff_ff;
const STORED = 0;
const DEFLATED = 8;
// Deflate expands at most about 1032 times, so one step of input yields at most
// about 17 MB before the size limit is checked again.
const INFLATE_STEP_BYTES = 16 * 1024;
// Stored data is handled in steps of at most this size, so progress and cancel
// do not depend on how large the stream's chunks are.
export const STEP_BYTES = 1024 * 1024;

export type ZipEntry = {
	readonly name: string;
	readonly method: 0 | 8;
	readonly compressedSize: number;
	// Declared uncompressed size.
	readonly size: number;
	// Offset of the local file header.
	readonly offset: number;
};

export type ZipDirectory = {
	readonly entries: ReadonlyMap<string, ZipEntry>;
	// Where the central directory starts: no entry data may reach past it.
	readonly dataEnd: number;
};

// The archive is malformed, truncated, or uses something the app does not read.
export class ZipFormatError extends Error {
	override name = 'ZipFormatError';
}

// Entry data is longer than the limit the caller set.
export class ZipLimitError extends Error {
	override name = 'ZipLimitError';
}

async function view(blob: Blob, start: number, end: number): Promise<DataView> {
	if (start < 0 || end > blob.size || start > end) {
		throw new ZipFormatError('A record points outside the file');
	}

	return new DataView(await blob.slice(start, end).arrayBuffer());
}

function uint64(data: DataView, offset: number): number {
	const value = Number(data.getBigUint64(offset, true));
	if (!Number.isSafeInteger(value)) {
		throw new ZipFormatError('A 64-bit value is out of range');
	}

	return value;
}

function findEnd(tail: DataView): number {
	for (let at = tail.byteLength - 22; at >= 0; at--) {
		if (
			tail.getUint32(at, true) === END_SIGNATURE &&
			at + 22 + tail.getUint16(at + 20, true) === tail.byteLength
		) {
			return at;
		}
	}

	throw new ZipFormatError('No end of central directory record');
}

type DirectoryLocation = {count: number; size: number; offset: number};

async function locateDirectory(
	blob: Blob,
): Promise<DirectoryLocation & {limit: number}> {
	const tailStart = Math.max(0, blob.size - MAX_END_BYTES);
	const tail = await view(blob, tailStart, blob.size);
	const at = findEnd(tail);
	if (
		tail.getUint16(at + 4, true) !== 0 ||
		tail.getUint16(at + 6, true) !== 0
	) {
		throw new ZipFormatError('Multi-part archives are not supported');
	}

	const found = {
		count: tail.getUint16(at + 10, true),
		size: tail.getUint32(at + 12, true),
		offset: tail.getUint32(at + 16, true),
	};
	const endOffset = tailStart + at;
	if (
		found.count !== UINT16_MAX &&
		found.size !== UINT32_MAX &&
		found.offset !== UINT32_MAX
	) {
		return {...found, limit: endOffset};
	}

	const locator = await view(blob, endOffset - 20, endOffset);
	if (locator.getUint32(0, true) !== LOCATOR64_SIGNATURE) {
		throw new ZipFormatError('The ZIP64 locator is missing');
	}

	const end64Offset = uint64(locator, 8);
	const end64 = await view(blob, end64Offset, end64Offset + 56);
	if (end64.getUint32(0, true) !== END64_SIGNATURE) {
		throw new ZipFormatError('The ZIP64 end record is missing');
	}

	return {
		count: uint64(end64, 32),
		size: uint64(end64, 40),
		offset: uint64(end64, 48),
		limit: end64Offset,
	};
}

// Fills the values the 32-bit fields leave to the ZIP64 extra field, which
// holds them in this order: size, compressed size, offset.
function readZip64Extra(
	extra: DataView,
	values: {size: number; compressedSize: number; offset: number},
) {
	const pending = (['size', 'compressedSize', 'offset'] as const).filter(
		(key) => values[key] === UINT32_MAX,
	);
	if (pending.length === 0) {
		return values;
	}

	for (let at = 0; at + 4 <= extra.byteLength;) {
		const length = extra.getUint16(at + 2, true);
		if (extra.getUint16(at, true) === 1) {
			if (length < pending.length * 8 || at + 4 + length > extra.byteLength) {
				break;
			}

			const filled = {...values};
			for (const [index, key] of pending.entries()) {
				filled[key] = uint64(extra, at + 4 + index * 8);
			}

			return filled;
		}

		at += 4 + length;
	}

	throw new ZipFormatError('A ZIP64 size is missing');
}

// A path that could leave the archive root (persistence.md section 8.3.2).
export function isUnsafePath(name: string): boolean {
	return (
		name.startsWith('/') ||
		name.includes('\\') ||
		name.split('/').includes('..')
	);
}

export function* inSteps(
	chunk: Uint8Array,
	size: number = STEP_BYTES,
): Generator<Uint8Array> {
	for (let at = 0; at < chunk.length; at += size) {
		yield chunk.subarray(at, at + size);
	}
}

export async function readZipDirectory(blob: Blob): Promise<ZipDirectory> {
	const {count, size, offset, limit} = await locateDirectory(blob);
	if (size > MAX_DIRECTORY_BYTES) {
		throw new ZipLimitError('The central directory is too large');
	}

	if (offset + size > limit) {
		throw new ZipFormatError('The central directory is out of place');
	}

	const directory = await view(blob, offset, offset + size);
	const entries = new Map<string, ZipEntry>();
	const decoder = new TextDecoder();
	let at = 0;
	for (let index = 0; index < count; index++) {
		if (at + 46 > size || directory.getUint32(at, true) !== ENTRY_SIGNATURE) {
			throw new ZipFormatError('A central directory entry is broken');
		}

		const flags = directory.getUint16(at + 8, true);
		const method = directory.getUint16(at + 10, true);
		const nameLength = directory.getUint16(at + 28, true);
		const extraLength = directory.getUint16(at + 30, true);
		const next =
			at + 46 + nameLength + extraLength + directory.getUint16(at + 32, true);
		if (next > size) {
			throw new ZipFormatError('A central directory entry is truncated');
		}

		if (flags % 2 === 1) {
			throw new ZipFormatError('Encrypted entries are not supported');
		}

		if (method !== STORED && method !== DEFLATED) {
			throw new ZipFormatError('Unsupported compression method');
		}

		const name = decoder.decode(
			new Uint8Array(directory.buffer, at + 46, nameLength),
		);
		const values = readZip64Extra(
			new DataView(directory.buffer, at + 46 + nameLength, extraLength),
			{
				compressedSize: directory.getUint32(at + 20, true),
				size: directory.getUint32(at + 24, true),
				offset: directory.getUint32(at + 42, true),
			},
		);
		if (method === STORED && values.size !== values.compressedSize) {
			throw new ZipFormatError('A stored entry has two sizes');
		}

		if (isUnsafePath(name) || entries.has(name)) {
			throw new ZipFormatError('Unsafe or repeated entry path');
		}

		entries.set(name, {name, method, ...values});
		at = next;
	}

	return {entries, dataEnd: offset};
}

async function compressedData(
	blob: Blob,
	entry: ZipEntry,
	dataEnd: number,
): Promise<Blob> {
	const header = await view(blob, entry.offset, entry.offset + 30);
	if (header.getUint32(0, true) !== LOCAL_SIGNATURE) {
		throw new ZipFormatError('A local file header is missing');
	}

	const start =
		entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
	if (start + entry.compressedSize > dataEnd) {
		throw new ZipFormatError('Entry data is out of place');
	}

	return blob.slice(start, start + entry.compressedSize);
}

export type ReadEntryOptions = {
	// Largest number of uncompressed bytes the entry may hold.
	limit: number;
	signal?: AbortSignal;
	// Called with the number of bytes each step added.
	onBytes?: (count: number) => void;
};

/**
 The uncompressed bytes of an entry. Throws `ZipLimitError` as soon as the data
 passes `limit`, whatever size the headers declare.
 */
export async function readZipEntry(
	blob: Blob,
	directory: ZipDirectory,
	entry: ZipEntry,
	{limit, signal, onBytes}: ReadEntryOptions,
): Promise<Uint8Array<ArrayBuffer>> {
	if (entry.size > limit) {
		throw new ZipLimitError(`${entry.name} is larger than ${limit} bytes`);
	}

	const data = await compressedData(blob, entry, directory.dataEnd);
	const output = new Uint8Array(entry.size);
	let length = 0;
	const append = (chunk: Uint8Array) => {
		if (length + chunk.length > limit) {
			throw new ZipLimitError(`${entry.name} is larger than ${limit} bytes`);
		}

		if (length + chunk.length > entry.size) {
			throw new ZipFormatError(`${entry.name} is longer than declared`);
		}

		output.set(chunk, length);
		length += chunk.length;
		onBytes?.(chunk.length);
	};

	const inflate = entry.method === DEFLATED ? new Inflate(append) : undefined;
	const push = (chunk: Uint8Array, final: boolean) => {
		try {
			inflate!.push(chunk, final);
		} catch (error) {
			if (error instanceof ZipLimitError || error instanceof ZipFormatError) {
				throw error;
			}

			throw new ZipFormatError(`${entry.name} cannot be inflated`, {
				cause: error,
			});
		}
	};

	const reader = data.stream().getReader();
	try {
		for (;;) {
			signal?.throwIfAborted();
			const {done, value} = await reader.read();
			if (done) {
				break;
			}

			for (const step of inSteps(
				value,
				inflate ? INFLATE_STEP_BYTES : STEP_BYTES,
			)) {
				signal?.throwIfAborted();
				if (inflate) {
					push(step, false);
				} else {
					append(step);
				}
			}
		}
	} finally {
		void reader.cancel().catch(() => undefined);
	}

	if (inflate) {
		push(new Uint8Array(), true);
	}

	if (length !== entry.size) {
		throw new ZipFormatError(`${entry.name} is shorter than declared`);
	}

	signal?.throwIfAborted();
	return output;
}
