import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vite-plus/test';
import {
	ALLOWED_LICENSES,
	classifyFile,
	collectNotices,
	collectPackageNotice,
	extractCopyrightLines,
	findBundledPackageDirs,
	packageDirOfModule,
	renderMarkdown,
	renderText,
	renderTypeScript,
} from './notices.ts';

const MIT_TEXT = `MIT License

Copyright (c) 2020 Example Author

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software.`;

let root: string;

type FakePackage = {
	name: string;
	version?: string;
	license?: string | {type: string};
	author?: string | {name: string};
	files?: Record<string, string>;
};

function addPackage(options: FakePackage): string {
	const dir = path.join(root, 'node_modules', options.name);
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		path.join(dir, 'package.json'),
		JSON.stringify({
			name: options.name,
			version: options.version ?? '1.0.0',
			license: options.license ?? 'MIT',
			author: options.author,
			homepage: 'https://example.test/pkg',
		}),
	);
	for (const [file, text] of Object.entries(options.files ?? {})) {
		writeFileSync(path.join(dir, file), text);
	}

	return dir;
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'notices-'));
});

afterEach(() => {
	rmSync(root, {recursive: true});
});

describe('classifyFile', () => {
	it.each([
		'LICENSE',
		'LICENCE',
		'license',
		'License.md',
		'LICENSE.txt',
		'LICENSE-MIT',
		'LICENSE-MIT.txt',
		'LICENSE_APACHE',
		'COPYING',
		'COPYING.txt',
		'UNLICENSE',
		'CopyrightNotice.txt',
	])('treats %s as a licence file', (name) => {
		expect(classifyFile(name)).toBe('license');
	});

	it.each(['NOTICE', 'NOTICE.txt', 'notice.md'])(
		'treats %s as a NOTICE file',
		(name) => {
			expect(classifyFile(name)).toBe('notice');
		},
	);

	it.each([
		'license-checker.json',
		'license.config.js',
		'README.md',
		'index.js',
	])('ignores %s', (name) => {
		expect(classifyFile(name)).toBeUndefined();
	});
});

describe('extractCopyrightLines', () => {
	it('keeps copyright lines and drops the licence prose', () => {
		expect(
			extractCopyrightLines(
				`${MIT_TEXT}\n\nThe above copyright notice and this permission notice shall be included.`,
			),
		).toEqual(['Copyright (c) 2020 Example Author']);
	});

	it('reads (c), the copyright sign and comment prefixes, and removes duplicates', () => {
		const lines = extractCopyrightLines(
			[
				' * Copyright 2019 First',
				'(c) 2018 Second',
				'© 2017 Third',
				'Copyright 2019 First',
				'Copyright notice, this list of conditions',
				'   Copyright [yyyy] [name of copyright owner]',
			].join('\n'),
		);
		expect(lines).toEqual([
			'Copyright 2019 First',
			'(c) 2018 Second',
			'© 2017 Third',
		]);
	});
});

describe('collectPackageNotice', () => {
	it('reads the licence file in a lower-case variant and its copyright line', () => {
		const dir = addPackage({name: 'lower', files: {license: MIT_TEXT}});
		const notice = collectPackageNotice(dir);
		expect(notice.licenseFiles).toEqual([{file: 'license', text: MIT_TEXT}]);
		expect(notice.copyrightLines).toEqual([
			'Copyright (c) 2020 Example Author',
		]);
		expect(notice.standardTextFallback).toBe(false);
	});

	it('reads LICENCE.md and several licence files of a dual-licensed package', () => {
		const dir = addPackage({
			name: 'dual',
			license: 'MIT OR Apache-2.0',
			files: {
				'LICENCE.md': MIT_TEXT,
				'LICENSE-APACHE': 'Apache License\nCopyright 2021 Other Holder',
			},
		});
		const notice = collectPackageNotice(dir);
		expect(notice.licenseFiles.map((file) => file.file)).toEqual([
			'LICENCE.md',
			'LICENSE-APACHE',
		]);
		expect(notice.copyrightLines).toEqual([
			'Copyright (c) 2020 Example Author',
			'Copyright 2021 Other Holder',
		]);
	});

	it('includes the NOTICE file of an Apache-2.0 package', () => {
		const dir = addPackage({
			name: 'apache',
			license: 'Apache-2.0',
			files: {
				LICENSE: 'Apache License\nCopyright 2022 Joe',
				NOTICE: 'Apache Thing\nCopyright 2022 The Thing Authors\r\n',
			},
		});
		const notice = collectPackageNotice(dir);
		expect(notice.noticeFiles).toEqual([
			{file: 'NOTICE', text: 'Apache Thing\nCopyright 2022 The Thing Authors'},
		]);
		expect(notice.copyrightLines).toContain('Copyright 2022 The Thing Authors');
		expect(renderText([notice])).toContain('--- NOTICE ---');
	});

	it('reports no copyright line when the licence file has none', () => {
		const dir = addPackage({
			name: 'bare',
			author: 'Someone <someone@example.test>',
			files: {LICENSE: 'Permission is hereby granted'},
		});
		const notice = collectPackageNotice(dir);
		expect(notice.copyrightLines).toEqual([]);
		expect(notice.author).toBe('Someone');
		expect(renderText([notice])).toContain(
			'none in the licence file (package.json author: Someone)',
		);
	});

	it('falls back to the standard text and flags a package without a licence file', () => {
		const dir = addPackage({
			name: 'nofile',
			author: {name: 'Anton Example'},
			files: {'README.md': 'hello'},
		});
		const notice = collectPackageNotice(dir);
		expect(notice.standardTextFallback).toBe(true);
		expect(notice.copyrightLines).toEqual(['Copyright (c) Anton Example']);
		expect(notice.licenseFiles).toHaveLength(1);
		expect(notice.licenseFiles[0]?.text).toContain(
			'Permission is hereby granted',
		);
		expect(notice.licenseFiles[0]?.text).toContain(
			'Copyright (c) Anton Example',
		);
		expect(notice.licenseFiles[0]?.text).not.toContain('{{copyright}}');
	});

	it.each(ALLOWED_LICENSES)(
		'has a standard text for the allowed licence %s',
		(license) => {
			const dir = addPackage({
				name: `std-${license}`,
				license,
				author: 'Holder',
			});
			const notice = collectPackageNotice(dir);
			expect(notice.standardTextFallback).toBe(true);
			expect(notice.licenseFiles[0]?.text.length).toBeGreaterThan(500);
			expect(notice.licenseFiles[0]?.text).not.toContain('{{copyright}}');
		},
	);

	it.each([
		['GPL-3.0', 'GPL-3.0'],
		['UNLICENSED', 'UNLICENSED'],
		['(MIT OR GPL-3.0)', '(MIT OR GPL-3.0)'],
		['MIT AND GPL-3.0', 'MIT AND GPL-3.0'],
	])('fails for the licence %s', (license, shown) => {
		const dir = addPackage({
			name: 'bad',
			version: '2.3.4',
			license,
			files: {LICENSE: MIT_TEXT},
		});
		expect(() => collectPackageNotice(dir)).toThrow(
			`bad@2.3.4 is distributed in dist/ but its licence "${shown}" is not allowed`,
		);
	});

	it('fails for a package that declares no licence', () => {
		const dir = path.join(root, 'node_modules', 'none');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			path.join(dir, 'package.json'),
			JSON.stringify({name: 'none', version: '1.0.0'}),
		);
		expect(() => collectPackageNotice(dir)).toThrow(
			'licence "Unknown" is not allowed',
		);
	});

	it('accepts an OR expression with one allowed alternative', () => {
		const dir = addPackage({
			name: 'either',
			license: 'GPL-3.0 OR MIT',
			files: {LICENSE: MIT_TEXT},
		});
		expect(collectPackageNotice(dir).license).toBe('GPL-3.0 OR MIT');
	});
});

describe('packageDirOfModule and findBundledPackageDirs', () => {
	it('finds the package behind pnpm and scoped module paths', () => {
		expect(
			packageDirOfModule(
				'/r/node_modules/.pnpm/a@1/node_modules/@s/pkg/dist/x.js?v=1',
			),
		).toBe('/r/node_modules/.pnpm/a@1/node_modules/@s/pkg');
		expect(packageDirOfModule('/r/node_modules/plain/lib/y.js')).toBe(
			'/r/node_modules/plain',
		);
		expect(packageDirOfModule('/r/src/app.ts')).toBeUndefined();
	});

	it('adds a package that a project stylesheet imports by bare name', () => {
		addPackage({name: 'cssdep', files: {LICENSE: MIT_TEXT}});
		const stylesheet = path.join(root, 'app.css');
		writeFileSync(
			stylesheet,
			"@import 'cssdep';\n@import './local.css';\n@import url('https://x.test/a.css');",
		);
		const dirs = findBundledPackageDirs([stylesheet], root);
		expect(dirs.map((dir) => path.basename(dir))).toEqual(['cssdep']);
	});

	it('fails when a stylesheet imports a package that is not installed', () => {
		const stylesheet = path.join(root, 'app.css');
		writeFileSync(stylesheet, "@import 'ghost';");
		expect(() => findBundledPackageDirs([stylesheet], root)).toThrow(
			'imports "ghost", which is not installed',
		);
	});
});

describe('output', () => {
	function sample() {
		return collectNotices([
			addPackage({name: 'zeta', version: '1.0.0', files: {LICENSE: MIT_TEXT}}),
			addPackage({
				name: '@scope/alpha',
				version: '2.0.0',
				files: {LICENSE: MIT_TEXT},
			}),
			addPackage({name: 'beta', version: '1.0.0', files: {LICENSE: MIT_TEXT}}),
		]);
	}

	it('sorts packages by name and removes duplicates', () => {
		const dir = addPackage({
			name: 'beta',
			version: '1.0.0',
			files: {LICENSE: MIT_TEXT},
		});
		expect(collectNotices([dir, dir]).map((notice) => notice.name)).toEqual([
			'beta',
		]);
		expect(sample().map((notice) => notice.name)).toEqual([
			'@scope/alpha',
			'beta',
			'zeta',
		]);
	});

	it('writes the same bytes for the same input, whatever the order', () => {
		const dirs = [
			addPackage({name: 'one', files: {LICENSE: MIT_TEXT}}),
			addPackage({name: 'two', files: {LICENSE: MIT_TEXT}}),
		];
		const forward = collectNotices(dirs);
		const backward = collectNotices(dirs.toReversed());
		for (const render of [renderText, renderMarkdown, renderTypeScript]) {
			expect(render(forward)).toBe(render(backward));
		}
	});

	it('puts every licence text, copyright line and package name in the text file', () => {
		const text = renderText(sample());
		expect(text).toContain('Permission is hereby granted');
		expect(text).toContain('Copyright (c) 2020 Example Author');
		for (const name of ['@scope/alpha', 'beta', 'zeta']) {
			expect(text).toContain(name);
		}
	});

	it('lists name, version and licence compactly in the TypeScript module', () => {
		const module = renderTypeScript(sample());
		expect(module).toContain("name: '@scope/alpha',");
		expect(module).toContain("version: '2.0.0',");
		expect(module).toContain("license: 'MIT',");
		expect(module).toContain(
			"THIRD_PARTY_NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt'",
		);
		expect(module).not.toContain('Permission is hereby granted');
		expect(module).not.toContain('APP_LICENSE_TEXT');
	});

	it('fences a licence text that contains backticks with a longer fence', () => {
		const dir = addPackage({
			name: 'ticks',
			files: {LICENSE: 'Copyright (c) 1\n```\ncode\n```'},
		});
		expect(renderMarkdown(collectNotices([dir]))).toContain(
			'````\nCopyright (c) 1',
		);
	});
});
