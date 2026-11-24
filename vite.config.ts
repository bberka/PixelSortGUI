import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite-plus';

export default defineConfig({
	base: '/',
	plugins: [react(), tailwindcss()],
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
