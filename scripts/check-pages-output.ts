import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {NOTICES_FILE_NAME} from './notices.ts';

export const expectedCname = 'glitch.bbay.dev';

export function findPagesOutputProblems(distDirectory: string): string[] {
	const problems: string[] = [];

	const cnamePath = path.join(distDirectory, 'CNAME');
	if (!existsSync(cnamePath)) {
		problems.push('CNAME is missing');
	} else if (readFileSync(cnamePath, 'utf8') !== expectedCname) {
		problems.push(`CNAME must contain exactly ${expectedCname}`);
	}

	const noticesPath = path.join(distDirectory, NOTICES_FILE_NAME);
	if (!existsSync(noticesPath)) {
		problems.push(`${NOTICES_FILE_NAME} is missing`);
	} else if (!readFileSync(noticesPath, 'utf8').includes('Copyright')) {
		problems.push(`${NOTICES_FILE_NAME} holds no copyright line`);
	}

	const indexPath = path.join(distDirectory, 'index.html');
	if (!existsSync(indexPath)) {
		problems.push('index.html is missing');
		return problems;
	}

	const html = readFileSync(indexPath, 'utf8');
	const assetReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
		.map(([, reference]) => reference)
		.filter(
			(reference): reference is string =>
				reference !== undefined && /\.(?:js|css)(?:[#?]|$)/.test(reference),
		);

	if (assetReferences.length === 0) {
		problems.push('index.html references no JS or CSS asset');
	}

	for (const reference of assetReferences) {
		if (!reference.startsWith('/') || reference.startsWith('//')) {
			problems.push(`${reference} is not a path from the domain root`);
			continue;
		}

		const filePath = reference.replace(/[#?].*$/, '').slice(1);
		if (!existsSync(path.join(distDirectory, filePath))) {
			problems.push(`${reference} does not exist in the build output`);
		}
	}

	return problems;
}

if (
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const problems = findPagesOutputProblems('dist');
	if (problems.length > 0) {
		console.error(`Pages output check failed:\n- ${problems.join('\n- ')}`);
		process.exitCode = 1;
	} else {
		console.log('Pages output check passed');
	}
}
