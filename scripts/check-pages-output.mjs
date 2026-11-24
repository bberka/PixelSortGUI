import {readFileSync} from 'node:fs';

const expectedCname = 'glitch.bbay.dev';
const cname = readFileSync('dist/CNAME', 'utf8');
if (cname !== expectedCname) {
	throw new Error(`dist/CNAME must contain exactly ${expectedCname}`);
}

const html = readFileSync('dist/index.html', 'utf8');
const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
	.map(([, path]) => path)
	.filter((path) => /\.(?:js|css)(?:\?|$)/.test(path));
if (
	assetPaths.length === 0 ||
	assetPaths.some((path) => !path.startsWith('/'))
) {
	throw new Error(
		'dist/index.html must reference JS and CSS assets from the domain root',
	);
}

console.log('Pages output check passed');
