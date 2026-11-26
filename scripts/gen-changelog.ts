import fs from 'node:fs';
import path from 'node:path';
import {changelogPaths, renderChangelogModule} from './changelog.ts';

const {source, output} = changelogPaths(
	path.resolve(import.meta.dirname, '..'),
);
fs.writeFileSync(
	output,
	renderChangelogModule(fs.readFileSync(source, 'utf8')),
);
console.log(`Wrote ${output}`);
