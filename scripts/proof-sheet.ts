import type {Buffer} from 'node:buffer';
import {execFileSync, spawn, type ChildProcess} from 'node:child_process';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, extname, join, resolve} from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {chromium, type Browser} from '@playwright/test';
import {PROOF_VIEWPORTS} from '../tests/e2e/viewports.ts';

export const MAX_EDGE = 1568;
const GAP = 8;
const LABEL_HEIGHT = 28;
const DEFAULT_PORT = 4173;
const THEMES = ['light', 'dark'] as const;

export type Size = {width: number; height: number};
export type Tile = Size & {x: number; y: number};
export type Sheet = Size & {tiles: Tile[]};
type Shot = {path: string; label: string};
type ThemeName = (typeof THEMES)[number];

const usage =
	'Usage: vp run proof:sheet [--route /] [--url http://localhost:4173] [--out .proof/contact-sheet.png] [screenshot.png | folder...]';

function splitIntoRows(aspects: number[], rowCount: number): number[][] {
	const total = aspects.reduce((sum, aspect) => sum + aspect, 0);
	const rows: number[][] = Array.from({length: rowCount}, () => []);
	let before = 0;
	for (const [index, aspect] of aspects.entries()) {
		const row = Math.min(
			rowCount - 1,
			Math.floor(((before + aspect / 2) / total) * rowCount),
		);
		rows[row].push(index);
		before += aspect;
	}

	return rows.filter((row) => row.length > 0);
}

function placeRows(sizes: Size[], rows: number[][]): Sheet | undefined {
	const aspects = sizes.map(({width, height}) => width / height);
	const heights = rows.map((row) => {
		const aspectSum = row.reduce((sum, index) => sum + aspects[index], 0);
		const fullWidth = (MAX_EDGE - (row.length + 1) * GAP) / aspectSum;
		return Math.min(fullWidth, ...row.map((index) => sizes[index].height));
	});
	const fixed = rows.length * LABEL_HEIGHT + (rows.length + 1) * GAP;
	const imageHeight = heights.reduce((sum, height) => sum + height, 0);
	const scale = Math.min(1, (MAX_EDGE - fixed) / imageHeight);
	if (scale <= 0) {
		return undefined;
	}

	const tiles: Tile[] = [];
	let y = GAP;
	let width = 0;
	for (const [rowIndex, row] of rows.entries()) {
		const height = Math.floor(heights[rowIndex] * scale);
		let x = GAP;
		for (const index of row) {
			const tileWidth = Math.max(1, Math.floor(height * aspects[index]));
			tiles[index] = {x, y, width: tileWidth, height};
			x += tileWidth + GAP;
		}

		width = Math.max(width, x);
		y += height + LABEL_HEIGHT + GAP;
	}

	return {width, height: y, tiles};
}

export function layoutSheet(sizes: Size[]): Sheet {
	if (sizes.length === 0) {
		throw new Error('A contact sheet needs at least one image.');
	}

	const aspects = sizes.map(({width, height}) => width / height);
	let best: Sheet | undefined;
	let bestArea = 0;
	for (let rowCount = 1; rowCount <= sizes.length; rowCount++) {
		const sheet = placeRows(sizes, splitIntoRows(aspects, rowCount));
		const area =
			sheet?.tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0) ??
			0;
		if (area <= bestArea) {
			continue;
		}

		best = sheet;
		bestArea = area;
	}

	if (!best) {
		throw new Error(
			`${sizes.length} images do not fit in ${MAX_EDGE} px; pass fewer.`,
		);
	}

	return best;
}

async function pngSize(filePath: string): Promise<Size> {
	const bytes = await readFile(filePath);
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) {
		throw new Error(`${filePath} is not a PNG file.`);
	}

	return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('"', '&quot;');
}

function sheetHtml(shots: Shot[], sheet: Sheet): string {
	const figures = shots.map((shot, index) => {
		const {x, y, width, height} = sheet.tiles[index];
		const source = escapeHtml(pathToFileURL(shot.path).href);
		return `<img src="${source}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px"><p style="left:${x}px;top:${y + height}px;width:${width}px">${escapeHtml(shot.label)}</p>`;
	});
	return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#262626;width:${sheet.width}px;height:${sheet.height}px;overflow:hidden}
img{position:absolute;outline:1px solid #52525b}
p{position:absolute;margin:0;height:${LABEL_HEIGHT}px;overflow:hidden;font:12px/20px system-ui,sans-serif;color:#fafafa;overflow-wrap:anywhere}
</style>${figures.join('')}`;
}

async function collectShots(
	inputs: string[],
	base: string,
	out: string,
): Promise<Shot[]> {
	const shots: Shot[] = [];
	for (const input of inputs) {
		const target = resolve(base, input);
		if ((await stat(target)).isDirectory()) {
			const names = await readdir(target, {recursive: true});
			for (const name of names.toSorted()) {
				const file = join(target, name);
				if (
					extname(name).toLowerCase() === '.png' &&
					!basename(name).startsWith('contact-sheet') &&
					file !== out
				) {
					shots.push({path: file, label: name.replace(/\.png$/i, '')});
				}
			}
		} else {
			shots.push({
				path: target,
				label: basename(target).replace(/\.png$/i, ''),
			});
		}
	}

	return shots;
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				return;
			}
		} catch {}

		await new Promise((resolveTimer) => {
			setTimeout(resolveTimer, 200);
		});
	}

	throw new Error(`Timed out waiting for ${url}`);
}

async function startPreviewServer(
	port: number,
): Promise<{url: string; stop: () => Promise<void>}> {
	execFileSync('pnpm', ['exec', 'vp', 'build'], {stdio: 'inherit'});
	const url = `http://localhost:${port}`;
	const child: ChildProcess = spawn(
		'pnpm',
		['exec', 'vp', 'preview', '--port', String(port), '--strictPort'],
		{stdio: 'ignore'},
	);

	const stop = async () => {
		if (child.exitCode !== null || child.killed) {
			return;
		}

		child.kill('SIGTERM');
		await new Promise<void>((resolveExit) => {
			child.once('exit', () => resolveExit());
			setTimeout(() => {
				if (child.exitCode === null) {
					child.kill('SIGKILL');
				}

				resolveExit();
			}, 3000);
		});
	};

	try {
		await waitForUrl(url, 30_000);
		return {url, stop};
	} catch (error) {
		await stop();
		throw error;
	}
}

type ThemeSignature = {
	background: string;
	foreground: string;
	colorScheme: string;
};

type CapturedViewport = {
	png: Buffer;
	themeSignature: ThemeSignature;
};

function sameThemeSignature(a: ThemeSignature, b: ThemeSignature): boolean {
	return (
		a.background === b.background &&
		a.foreground === b.foreground &&
		a.colorScheme === b.colorScheme
	);
}

async function captureViewport(
	browser: Browser,
	targetUrl: string,
	viewport: (typeof PROOF_VIEWPORTS)[number],
	theme: ThemeName,
): Promise<CapturedViewport> {
	const context = await browser.newContext({
		viewport: {width: viewport.width, height: viewport.height},
		colorScheme: theme,
		deviceScaleFactor: 1,
	});
	try {
		const themeJson = JSON.stringify(theme);
		await context.addInitScript(
			`localStorage.setItem('drift:theme', ${themeJson}); document.documentElement.dataset.theme = ${themeJson};`,
		);
		const page = await context.newPage();
		await page.goto(targetUrl, {waitUntil: 'networkidle'});
		const themeSignature = await page.evaluate<ThemeSignature>(`(() => {
			const style = getComputedStyle(document.documentElement);
			return {
				background: style.getPropertyValue('--background').trim(),
				foreground: style.getPropertyValue('--foreground').trim(),
				colorScheme: style.colorScheme,
			};
		})()`);
		const png = await page.screenshot();
		return {png, themeSignature};
	} finally {
		await context.close();
	}
}

async function captureRouteShots(
	browser: Browser,
	baseUrl: string,
	route: string,
	proofDir: string,
): Promise<{shots: Shot[]; singleTheme: boolean}> {
	await mkdir(proofDir, {recursive: true});
	const targetUrl = new URL(route, baseUrl).href;
	const firstViewport = PROOF_VIEWPORTS[0];

	const firstLight = await captureViewport(
		browser,
		targetUrl,
		firstViewport,
		'light',
	);
	const firstDark = await captureViewport(
		browser,
		targetUrl,
		firstViewport,
		'dark',
	);
	const singleTheme = sameThemeSignature(
		firstLight.themeSignature,
		firstDark.themeSignature,
	);
	const activeThemes: readonly ThemeName[] = singleTheme ? ['light'] : THEMES;

	const shots: Shot[] = [];
	for (const theme of activeThemes) {
		for (const viewport of PROOF_VIEWPORTS) {
			let png: Buffer;
			if (viewport === firstViewport && theme === 'light') {
				png = firstLight.png;
			} else if (viewport === firstViewport && theme === 'dark') {
				png = firstDark.png;
			} else {
				const captured = await captureViewport(
					browser,
					targetUrl,
					viewport,
					theme,
				);
				png = captured.png;
			}

			const suffix = singleTheme ? '' : `-${theme}`;
			const fileName = `${viewport.name}-${viewport.width}x${viewport.height}${suffix}.png`;
			const filePath = join(proofDir, fileName);
			await writeFile(filePath, png);
			const label = singleTheme
				? `${viewport.name} ${viewport.width}x${viewport.height}`
				: `${viewport.name} ${viewport.width}x${viewport.height} (${theme})`;
			shots.push({path: filePath, label});
		}
	}

	return {shots, singleTheme};
}

async function renderContactSheet(
	browser: Browser,
	shots: Shot[],
	out: string,
): Promise<Size> {
	const sizes = await Promise.all(shots.map(({path}) => pngSize(path)));
	const sheet = layoutSheet(sizes);
	await mkdir(dirname(out), {recursive: true});
	const folder = await mkdtemp(join(tmpdir(), 'drift-proof-sheet-'));
	try {
		const page = await browser.newPage({
			viewport: {width: sheet.width, height: sheet.height},
			deviceScaleFactor: 1,
		});
		try {
			const html = join(folder, 'sheet.html');
			await writeFile(html, sheetHtml(shots, sheet));
			await page.goto(pathToFileURL(html).href, {waitUntil: 'load'});
			await page.screenshot({path: out});
		} finally {
			await page.close();
		}
	} finally {
		await rm(folder, {recursive: true, force: true});
	}

	return pngSize(out);
}

function parseArgs(argv: string[]) {
	let route = '/';
	let url: string | undefined;
	let out: string | undefined;
	const inputs: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = argv[i + 1];
		if (arg === '--route' && next) {
			route = next;
			i++;
		} else if (arg === '--url' && next) {
			url = next;
			i++;
		} else if (arg === '--out' && next) {
			out = next;
			i++;
		} else if (arg.startsWith('--')) {
			throw new Error(`Unknown option: ${arg}\n${usage}`);
		} else {
			inputs.push(arg);
		}
	}

	return {route, url, out, inputs};
}

async function main(argv: string[]): Promise<void> {
	const base = process.env.INIT_CWD ?? process.cwd();
	const {route, url, out: outArg, inputs} = parseArgs(argv);
	const out = resolve(base, outArg ?? '.proof/contact-sheet.png');
	const proofDir = dirname(out);

	let server: {url: string; stop: () => Promise<void>} | undefined;
	const browser = await chromium.launch({headless: true});
	try {
		let shots: Shot[];
		if (inputs.length > 0) {
			shots = await collectShots(inputs, base, out);
			if (shots.length === 0) {
				throw new Error(`No PNG files found.\n${usage}`);
			}
		} else {
			let baseUrl = url;
			if (!baseUrl) {
				server = await startPreviewServer(DEFAULT_PORT);
				baseUrl = server.url;
			}

			const captured = await captureRouteShots(
				browser,
				baseUrl,
				route,
				proofDir,
			);
			shots = captured.shots;
			if (captured.singleTheme) {
				console.log(
					`Themes are indistinguishable on ${route} (captured one theme; dark theme awaits T4.1).`,
				);
			}
		}

		const written = await renderContactSheet(browser, shots, out);
		console.log(
			`${out} (${written.width}x${written.height}, ${shots.length} screenshots)`,
		);
	} finally {
		await browser.close();
		await server?.stop();
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	await main(process.argv.slice(2));
}
