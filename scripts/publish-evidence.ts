import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {
	closeSync,
	lstatSync,
	openSync,
	readFileSync,
	readSync,
	realpathSync,
	statSync,
} from 'node:fs';
import {basename, extname, isAbsolute, relative, resolve} from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

export const EVIDENCE_BRANCH = 'evidence' as const;
export const PROOF_DIR_NAME = '.proof';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_RUN = 10;

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];

export type ValidatedEvidenceFile = {
	inputPath: string;
	realPath: string;
	name: string;
	sizeBytes: number;
};

export type ValidationOptions = {
	baseDir?: string;
	proofDir?: string;
	maxFileBytes?: number;
	maxFiles?: number;
};

function matchesBytes(
	buffer: Uint8Array,
	expected: readonly number[],
	offset = 0,
): boolean {
	return buffer.length >= offset + expected.length
		? expected.every((byte, index) => buffer[offset + index] === byte)
		: false;
}

export function matchesImageSignature(
	extension: string,
	header: Uint8Array,
): boolean {
	switch (extension.toLowerCase()) {
		case '.png': {
			return matchesBytes(header, PNG_SIGNATURE);
		}

		case '.jpg':
		case '.jpeg': {
			return matchesBytes(header, JPEG_SIGNATURE);
		}

		case '.gif': {
			return (
				matchesBytes(header, GIF87A_SIGNATURE) ||
				matchesBytes(header, GIF89A_SIGNATURE)
			);
		}

		case '.webp': {
			return (
				matchesBytes(header, RIFF_SIGNATURE, 0) &&
				matchesBytes(header, WEBP_SIGNATURE, 8)
			);
		}

		default: {
			return false;
		}
	}
}

export function validatePrNumber(pr: string | undefined): number {
	if (!pr || !/^[1-9]\d*$/.test(pr)) {
		throw new Error(
			`Invalid pull request number "${pr ?? ''}". Expected a positive integer.`,
		);
	}

	const parsed = Number(pr);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(
			`Invalid pull request number "${pr}". Expected a positive integer.`,
		);
	}

	return parsed;
}

function readHeaderBytes(filePath: string, length: number): Buffer {
	const buffer = Buffer.alloc(length);
	const fd = openSync(filePath, 'r');
	try {
		const bytesRead = readSync(fd, buffer, 0, length, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		closeSync(fd);
	}
}

function isInsideDirectory(dirPath: string, targetPath: string): boolean {
	const rel = relative(dirPath, targetPath);
	return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function validateEvidenceFiles(
	files: readonly string[],
	options: ValidationOptions = {},
): ValidatedEvidenceFile[] {
	if (files.length === 0) {
		throw new Error('Usage: vp run evidence <pr-number> <file>...');
	}

	const maxFiles = options.maxFiles ?? MAX_FILES_PER_RUN;
	if (files.length > maxFiles) {
		throw new Error(
			`Too many files (${files.length}). At most ${maxFiles} files may be uploaded per run.`,
		);
	}

	const baseDir = options.baseDir ?? process.env.INIT_CWD ?? process.cwd();
	const proofDir = resolve(baseDir, options.proofDir ?? PROOF_DIR_NAME);
	const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;

	let realProofDir: string;
	try {
		realProofDir = realpathSync(proofDir);
	} catch {
		throw new Error(
			`Proof directory does not exist: ${proofDir}. Generate proof screenshots first.`,
		);
	}

	const validated: ValidatedEvidenceFile[] = [];
	for (const inputPath of files) {
		const resolvedPath = resolve(baseDir, inputPath);
		if (!isInsideDirectory(proofDir, resolvedPath)) {
			throw new Error(
				`Refusing to upload "${inputPath}": path must be inside ${PROOF_DIR_NAME}/.`,
			);
		}

		let realPath: string;
		try {
			realPath = realpathSync(resolvedPath);
		} catch {
			throw new Error(`File does not exist or cannot be read: "${inputPath}".`);
		}

		if (!isInsideDirectory(realProofDir, realPath)) {
			throw new Error(
				`Refusing to upload "${inputPath}": resolved path escapes ${PROOF_DIR_NAME}/.`,
			);
		}

		const lstats = lstatSync(resolvedPath);
		const stats = statSync(realPath);
		if (!stats.isFile() || (!lstats.isFile() && !lstats.isSymbolicLink())) {
			throw new Error(
				`Refusing to upload "${inputPath}": only regular files are allowed.`,
			);
		}

		const extension = extname(realPath).toLowerCase();
		if (!ALLOWED_EXTENSIONS.has(extension)) {
			throw new Error(
				`Refusing to upload "${inputPath}": unsupported extension "${extension || '(none)'}". Allowed: png, jpg, jpeg, webp, gif.`,
			);
		}

		if (stats.size === 0) {
			throw new Error(`Refusing to upload "${inputPath}": file is empty.`);
		}

		if (stats.size > maxFileBytes) {
			throw new Error(
				`Refusing to upload "${inputPath}": file size (${stats.size} bytes) exceeds limit of ${maxFileBytes} bytes.`,
			);
		}

		const header = readHeaderBytes(realPath, 16);
		if (!matchesImageSignature(extension, header)) {
			throw new Error(
				`Refusing to upload "${inputPath}": file bytes do not match ${extension} image format.`,
			);
		}

		const name = basename(realPath).replaceAll(/[^\w\-.]/g, '-');
		validated.push({
			inputPath,
			realPath,
			name,
			sizeBytes: stats.size,
		});
	}

	return validated;
}

function gh(args: string[], input?: string): string {
	return execFileSync('gh', args, {encoding: 'utf8', input}).trim();
}

function assertPullRequestOpen(repo: string, pr: number): void {
	let state: string;
	try {
		state = gh(['api', `repos/${repo}/pulls/${pr}`, '-q', '.state']);
	} catch {
		throw new Error(`Pull request #${pr} was not found in ${repo}.`);
	}

	if (state.toLowerCase() !== 'open') {
		throw new Error(
			`Pull request #${pr} in ${repo} is not open (state: ${state}).`,
		);
	}
}

function main(argv: string[]): void {
	const [prArg, ...fileArgs] = argv;
	const pr = validatePrNumber(prArg);
	const files = validateEvidenceFiles(fileArgs);

	const repo = gh([
		'repo',
		'view',
		'--json',
		'nameWithOwner',
		'-q',
		'.nameWithOwner',
	]);

	assertPullRequestOpen(repo, pr);

	try {
		gh(['api', `repos/${repo}/git/ref/heads/${EVIDENCE_BRANCH}`]);
	} catch {
		const sha = gh(['api', `repos/${repo}/commits/HEAD`, '-q', '.sha']);
		gh([
			'api',
			`repos/${repo}/git/refs`,
			'-f',
			`ref=refs/heads/${EVIDENCE_BRANCH}`,
			'-f',
			`sha=${sha}`,
		]);
	}

	const lines: string[] = [];
	for (const file of files) {
		const path = `evidence/pr${pr}/${file.name}`;
		const endpoint = `repos/${repo}/contents/${path}`;
		let existing: string | undefined;
		try {
			existing = gh([
				'api',
				`${endpoint}?ref=${EVIDENCE_BRANCH}`,
				'-q',
				'.sha',
			]);
		} catch {}

		const body = {
			message: `evidence: ${file.name} for #${pr}`,
			content: readFileSync(file.realPath).toString('base64'),
			branch: EVIDENCE_BRANCH,
			...(existing && {sha: existing}),
		};
		gh(['api', '-X', 'PUT', endpoint, '--input', '-'], JSON.stringify(body));
		const url = `https://raw.githubusercontent.com/${repo}/${EVIDENCE_BRANCH}/${path}`;
		lines.push(`![${file.name}](${url})`);
	}

	console.log(lines.join('\n\n'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main(process.argv.slice(2));
}
