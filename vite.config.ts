import path from 'node:path';
import process from 'node:process';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {VitePWA as vitePwa} from 'vite-plugin-pwa';
import {defineConfig} from 'vite-plus';
import {thirdPartyNotices} from './scripts/notices-plugin.ts';
import {resolveBuildVersion} from './scripts/release-version.ts';

const appVersion =
	process.env.VITE_APP_VERSION?.trim() || resolveBuildVersion();
process.env.VITE_APP_VERSION = appVersion;

const notices = thirdPartyNotices(import.meta.dirname);

export default defineConfig({
	base: '/',
	define: {
		'globalThis.VITE_APP_VERSION': JSON.stringify(appVersion),
		'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
	},
	plugins: [
		react(),
		tailwindcss(),
		notices.plugin,
		vitePwa({
			registerType: 'prompt',
			injectRegister: false,
			includeAssets: [
				'favicon.ico',
				'icons/apple-touch-icon.png',
				'icons/icon.svg',
			],
			/* eslint-disable @typescript-eslint/naming-convention -- Web App Manifest specification requires snake_case keys */
			manifest: {
				name: 'Drift',
				short_name: 'Drift',
				description:
					'Offline web editor for glitch art and pixel sorting of still photos.',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				background_color: '#000000',
				theme_color: '#000000',
				icons: [
					{
						src: '/icons/icon-192.png',
						sizes: '192x192',
						type: 'image/png',
						purpose: 'any',
					},
					{
						src: '/icons/icon-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any',
					},
					{
						src: '/icons/icon-maskable-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable',
					},
					{
						src: '/icons/icon.svg',
						sizes: 'any',
						type: 'image/svg+xml',
						purpose: 'any',
					},
				],
			},
			/* eslint-enable @typescript-eslint/naming-convention */
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,txt}'],
				navigateFallback: '/index.html',
				cleanupOutdatedCaches: true,
				clientsClaim: false,
				skipWaiting: false,
			},
		}),
	],
	worker: {
		format: 'es',
		plugins: () => [notices.workerPlugin],
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
