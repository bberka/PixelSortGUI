import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vite-plus/test';
import {expectedCname, findPagesOutputProblems} from './check-pages-output.ts';

let dist: string;

function writeBuild(options: {cname?: string | undefined; script: string}) {
	if (options.cname !== undefined) {
		writeFileSync(path.join(dist, 'CNAME'), options.cname);
	}

	writeFileSync(
		path.join(dist, 'index.html'),
		`<link rel="stylesheet" href="/assets/app.css"><script src="${options.script}"></script>`,
	);
}

beforeEach(() => {
	dist = mkdtempSync(path.join(tmpdir(), 'pages-output-'));
	mkdirSync(path.join(dist, 'assets'));
	writeFileSync(path.join(dist, 'assets/app.js'), '');
	writeFileSync(path.join(dist, 'assets/app.css'), '');
});

afterEach(() => {
	rmSync(dist, {recursive: true});
});

describe('findPagesOutputProblems', () => {
	it('accepts a build served from the domain root', () => {
		writeBuild({cname: expectedCname, script: '/assets/app.js?v=1'});
		expect(findPagesOutputProblems(dist)).toEqual([]);
	});

	it('rejects a missing CNAME', () => {
		writeBuild({script: '/assets/app.js'});
		expect(findPagesOutputProblems(dist)).toEqual(['CNAME is missing']);
	});

	it.each(['example.com', `${expectedCname}\n`, `${expectedCname}\nwww`])(
		'rejects CNAME content %j',
		(cname) => {
			writeBuild({cname, script: '/assets/app.js'});
			expect(findPagesOutputProblems(dist)).toEqual([
				`CNAME must contain exactly ${expectedCname}`,
			]);
		},
	);

	it.each([
		['assets/app.js', 'assets/app.js is not a path from the domain root'],
		['./assets/app.js', './assets/app.js is not a path from the domain root'],
		[
			'//cdn.example/app.js',
			'//cdn.example/app.js is not a path from the domain root',
		],
		[
			'/PixelSortGUI/assets/app.js',
			'/PixelSortGUI/assets/app.js does not exist in the build output',
		],
	])('rejects the asset reference %s', (script, problem) => {
		writeBuild({cname: expectedCname, script});
		expect(findPagesOutputProblems(dist)).toEqual([problem]);
	});
});
