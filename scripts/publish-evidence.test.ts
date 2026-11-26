import {Buffer} from 'node:buffer';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vite-plus/test';
import {
	MAX_FILE_BYTES,
	MAX_FILES_PER_RUN,
	validateEvidenceFiles,
	validatePrNumber,
} from './publish-evidence.ts';

const VALID_PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe('validatePrNumber', () => {
	it('accepts positive integers', () => {
		expect(validatePrNumber('1')).toBe(1);
		expect(validatePrNumber('42')).toBe(42);
	});

	it('rejects zero, negative, non-numeric, and empty values', () => {
		for (const bad of [undefined, '', '0', '-1', '1.5', 'abc', '06', '6a']) {
			expect(() => validatePrNumber(bad)).toThrow(
				/Invalid pull request number/,
			);
		}
	});
});

describe('validateEvidenceFiles', () => {
	let workspaceDir: string;
	let proofDir: string;

	beforeEach(() => {
		workspaceDir = mkdtempSync(join(tmpdir(), 'drift-evidence-test-'));
		proofDir = join(workspaceDir, '.proof');
		mkdirSync(proofDir, {recursive: true});
	});

	afterEach(() => {
		rmSync(workspaceDir, {recursive: true, force: true});
	});

	it('accepts a valid PNG inside .proof', () => {
		const shotPath = join(proofDir, 'contact-sheet.png');
		writeFileSync(shotPath, VALID_PNG);

		const result = validateEvidenceFiles(['.proof/contact-sheet.png'], {
			baseDir: workspaceDir,
		});

		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe('contact-sheet.png');
		expect(result[0]?.sizeBytes).toBe(VALID_PNG.length);
	});

	it('rejects a text file renamed to .png', () => {
		const fakePng = join(proofDir, 'fake.png');
		writeFileSync(fakePng, 'SECRET_TOKEN=12345\n');

		expect(() =>
			validateEvidenceFiles(['.proof/fake.png'], {baseDir: workspaceDir}),
		).toThrow(/do not match \.png image format/);
	});

	it('rejects a non-image extension', () => {
		const envFile = join(proofDir, 'notes.txt');
		writeFileSync(envFile, 'hello');

		expect(() =>
			validateEvidenceFiles(['.proof/notes.txt'], {baseDir: workspaceDir}),
		).toThrow(/unsupported extension/);
	});

	it('rejects a path outside the proof directory including via ..', () => {
		const outsidePng = join(workspaceDir, 'outside.png');
		writeFileSync(outsidePng, VALID_PNG);

		expect(() =>
			validateEvidenceFiles(['outside.png'], {baseDir: workspaceDir}),
		).toThrow(/must be inside \.proof\//);

		expect(() =>
			validateEvidenceFiles(['.proof/../outside.png'], {
				baseDir: workspaceDir,
			}),
		).toThrow(/must be inside \.proof\//);
	});

	it('rejects a symlink inside .proof pointing outside .proof', () => {
		const outsidePng = join(workspaceDir, 'secret.png');
		writeFileSync(outsidePng, VALID_PNG);
		const linkPath = join(proofDir, 'linked.png');
		symlinkSync(outsidePng, linkPath);

		expect(() =>
			validateEvidenceFiles(['.proof/linked.png'], {baseDir: workspaceDir}),
		).toThrow(/escapes \.proof\//);
	});

	it('rejects an oversized file', () => {
		const bigPng = join(proofDir, 'oversized.png');
		const oversized = Buffer.alloc(MAX_FILE_BYTES + 1);
		VALID_PNG.copy(oversized, 0);
		writeFileSync(bigPng, oversized);

		expect(() =>
			validateEvidenceFiles(['.proof/oversized.png'], {
				baseDir: workspaceDir,
			}),
		).toThrow(/exceeds limit/);
	});

	it('rejects more than MAX_FILES_PER_RUN files', () => {
		const files: string[] = [];
		for (let i = 0; i <= MAX_FILES_PER_RUN; i++) {
			const filePath = join(proofDir, `shot-${i}.png`);
			writeFileSync(filePath, VALID_PNG);
			files.push(`.proof/shot-${i}.png`);
		}

		expect(() => validateEvidenceFiles(files, {baseDir: workspaceDir})).toThrow(
			/Too many files/,
		);
	});
});
