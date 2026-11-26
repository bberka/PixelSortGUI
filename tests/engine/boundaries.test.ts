import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vite-plus/test';

const engineDir = path.resolve(import.meta.dirname, '../../src/engine');
const files = readdirSync(engineDir, {recursive: true, encoding: 'utf8'})
	.filter((name) => name.endsWith('.ts'))
	.map((name) => ({
		name,
		text: readFileSync(path.join(engineDir, name), 'utf8'),
	}));

describe('src/engine stays self-contained (engine.md section 1)', () => {
	it('imports only from inside src/engine', () => {
		expect(files.length).toBeGreaterThan(0);
		for (const {name, text} of files) {
			const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map(
				(match) => match[1],
			);
			for (const specifier of specifiers) {
				const resolved = path.resolve(engineDir, path.dirname(name), specifier);
				expect(
					specifier.startsWith('.') &&
						resolved.startsWith(engineDir + path.sep),
					`${name} imports ${specifier}`,
				).toBe(true);
			}
		}
	});

	it('uses no unseeded randomness, wall clock or DOM globals', () => {
		const banned =
			/Math\.random|Date\.now|new Date|\bdocument\.|\bwindow\.|\bcrypto\.|localStorage|indexedDB/;
		for (const {name, text} of files) {
			expect(banned.test(text), `${name} uses a banned global`).toBe(false);
		}
	});

	it('keeps render implementations out of the main-thread effect registry', () => {
		const mainRegistry = readFileSync(
			path.join(engineDir, 'effects/index.ts'),
			'utf8',
		);
		const staticImports = [
			...mainRegistry.matchAll(/import\s+[\s\S]*?from\s+'([^']+)'/g),
		].map((match) => match[1]);
		expect(staticImports).not.toContain('./pixel-sort/index.ts');
		expect(staticImports).not.toContain('./channel-shift.ts');
		expect(staticImports).not.toContain('./channel-swap.ts');
		expect(staticImports).not.toContain('./slice-shift.ts');
		expect(staticImports).not.toContain('./block-shuffle.ts');
		expect(staticImports).not.toContain('./posterize.ts');
		expect(staticImports).not.toContain('./scanline-wave.ts');
		expect(staticImports).not.toContain('./rgb-noise.ts');
	});
});
