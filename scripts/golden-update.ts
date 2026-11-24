import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
	encodeRgbaPng,
	listGoldenCases,
	renderGoldenCase,
} from '../tests/golden/helpers.ts';

async function main(): Promise<void> {
	const cases = listGoldenCases();
	let changed = 0;

	for (const entry of cases) {
		const image = await renderGoldenCase(entry.spec);
		const encoded = encodeRgbaPng(image);
		const existing = fs.existsSync(entry.pngPath)
			? fs.readFileSync(entry.pngPath)
			: undefined;

		if (
			existing &&
			existing.byteLength === encoded.byteLength &&
			Buffer.compare(existing, encoded) === 0
		) {
			continue;
		}

		fs.writeFileSync(entry.pngPath, encoded);
		changed++;
		const rel = path.relative(process.cwd(), entry.pngPath);
		console.log(`${existing ? 'updated' : 'created'} ${rel}`);
	}

	if (changed === 0) {
		console.log(`All ${cases.length} golden PNGs are up to date.`);
	} else {
		console.log(`Updated ${changed} of ${cases.length} golden PNGs.`);
	}
}

await main();
