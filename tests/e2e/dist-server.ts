import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import {expect, type Page} from '@playwright/test';

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.txt': 'text/plain; charset=utf-8',
};

/**
Serves `dist/` and can publish a newer service worker on demand.
*/
export async function startDistServer(): Promise<{
	url: string;
	setSwVersion: (version: number) => void;
	close: () => Promise<void>;
}> {
	const distDir = path.resolve(import.meta.dirname, '../../dist');
	let swVersion = 1;

	const server = http.createServer((request, response) => {
		const requestPath = (request.url ?? '/').split('?', 1)[0] ?? '/';
		const relativePath =
			requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
		const filePath = path.resolve(distDir, relativePath);
		if (!filePath.startsWith(distDir)) {
			response.writeHead(403).end();
			return;
		}

		void readFile(filePath)
			.then((data) => {
				const extension = path.extname(filePath);
				const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
				if (relativePath === 'sw.js') {
					const body =
						swVersion === 1
							? data
							: Buffer.concat([
									data,
									Buffer.from(`\n// simulated-update-v${swVersion}\n`),
								]);
					response
						.writeHead(200, {
							'Content-Type': contentType,
							'Cache-Control': 'no-cache',
						})
						.end(body);
					return;
				}

				response.writeHead(200, {'Content-Type': contentType}).end(data);
			})
			.catch(() => {
				response.writeHead(404).end();
			});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	const {port} = server.address() as AddressInfo;

	return {
		url: `http://localhost:${port}`,
		setSwVersion(version) {
			swVersion = version;
		},
		async close() {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			});
		},
	};
}

export async function waitForServiceWorkerControl(page: Page): Promise<void> {
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});

	const hasController = await page.evaluate(
		() => navigator.serviceWorker.controller !== null,
	);
	if (!hasController) {
		await page.reload({waitUntil: 'load'});
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
		});
	}

	await expect
		.poll(async () =>
			page.evaluate(() => navigator.serviceWorker.controller !== null),
		)
		.toBe(true);
}
