import {strToU8, zipSync, type Zippable} from 'fflate';
import {describe, expect, it} from 'vite-plus/test';
import {readArchiveKind} from '../../src/storage/archive-kind.ts';

const zip = (files: Zippable) => new Blob([zipSync(files)]);
const manifest = (text: string) => zip({'manifest.json': strToU8(text)});

describe('readArchiveKind', () => {
	it.each(['project', 'backup'] as const)(
		'reads the %s kind from the manifest, whatever else the file holds',
		async (kind) => {
			await expect(
				readArchiveKind(manifest(JSON.stringify({kind}))),
			).resolves.toBe(kind);
		},
	);

	it.each([
		['no manifest', zip({'notes.txt': strToU8('hello')})],
		['another kind', manifest('{"kind":"preset"}')],
		['no kind', manifest('{}')],
		['a manifest that is not an object', manifest('null')],
		['a manifest that is not JSON', manifest('{kind')],
	])('calls a ZIP with %s unknown', async (_name, file) => {
		await expect(readArchiveKind(file)).resolves.toBe('unknown');
	});

	it.each([
		['text', new Blob(['not a zip'])],
		['an empty file', new Blob([])],
		['a cut ZIP', manifest('{"kind":"backup"}').slice(0, 40)],
	])('calls %s damaged', async (_name, file) => {
		await expect(readArchiveKind(file)).resolves.toBe('damaged');
	});

	it('stops when the signal has aborted', async () => {
		await expect(
			readArchiveKind(manifest('{"kind":"backup"}'), {
				signal: AbortSignal.abort(),
			}),
		).rejects.toThrow(/abort/i);
	});
});
