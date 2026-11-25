import path from 'node:path';
import process from 'node:process';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite-plus';
import {resolveBuildVersion} from './scripts/release-version.ts';

const appVersion =
	process.env.VITE_APP_VERSION?.trim() || resolveBuildVersion();
process.env.VITE_APP_VERSION = appVersion;

export default defineConfig({
	base: '/',
	define: {
		'globalThis.VITE_APP_VERSION': JSON.stringify(appVersion),
		'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
	},
	plugins: [react(), tailwindcss()],
	worker: {
		format: 'es',
	},
	build: {
		rollupOptions: {
			// The render coordinator is its own entry so its chunk (and the worker
			// chunks it references) exists before any feature imports it. The
			// end-to-end tests load it from `dist/assets/coordinator-*.js`, which
			// needs its exports kept.
			preserveEntrySignatures: 'exports-only',
			input: {
				index: path.resolve(import.meta.dirname, 'index.html'),
				coordinator: path.resolve(
					import.meta.dirname,
					'src/render/coordinator.ts',
				),
			},
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(import.meta.dirname, './src'),
		},
	},
	server: {
		host: 'localhost',
		port: 5173,
	},
	preview: {
		host: 'localhost',
		port: 4173,
	},
	run: {
		tasks: {
			dev: {
				command: 'vp dev',
				cache: false,
			},
			gui: {
				command: 'vp build && vp preview',
				cache: false,
			},
		},
	},
	test: {
		include: [
			'src/**/*.test.ts',
			'src/**/*.test.tsx',
			'tests/**/*.test.ts',
			'scripts/**/*.test.ts',
		],
		environment: 'node',
	},
	staged: {
		'*.{ts,tsx,js,mjs,cjs}': 'xo',
		'package.json': 'xo',
	},
});
