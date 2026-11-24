import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, test, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

async function waitForBootAndCreateSession(page: Page) {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const {store} = booted.bundle;

		const width = 160;
		const height = 120;
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('2D context unavailable');
		}

		const gradient = ctx.createLinearGradient(0, 0, width, height);
		gradient.addColorStop(0, '#102030');
		gradient.addColorStop(0.5, '#d08040');
		gradient.addColorStop(1, '#f0f0f0');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, width, height);

		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((result) => {
				if (result) {
					resolve(result);
				} else {
					reject(new Error('Failed to encode synthetic PNG'));
				}
			}, 'image/png');
		});

		const created = await store.getState().importImage({
			name: 'e2e-gradient.png',
			blob,
			width,
			height,
		});
		const instance = await store.getState().addEffect('pixelSort');
		await store.getState().commitParam(instance.id, 'angle', 90);
		store.getState().setViewState({
			fitMode: 'custom',
			zoom: 2.25,
			centerX: 70,
			centerY: 50,
			splitPosition: 0.4,
		});
		await store.getState().flushViewState();

		// Wait for settle render from real preview worker
		await new Promise<void>((resolve, reject) => {
			const timeout = globalThis.setTimeout(
				() => reject(new Error('Timed out waiting for settle render')),
				15_000,
			);
			const check = () => {
				const {frame} = store.getState().render;
				if (frame?.level !== 'settle') {
					return;
				}

				globalThis.clearTimeout(timeout);
				unsubscribe();
				resolve();
			};

			const unsubscribe = store.subscribe(check);
			check();
		});

		return {
			projectId: created.project.id,
			instanceId: instance.id,
			seed: instance.params.seed as number,
		};
	});
}

async function readRestoredSession(page: Page) {
	return page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		await booted.hydrationPromise;
		const {store} = booted.bundle;

		await new Promise<void>((resolve, reject) => {
			const timeout = globalThis.setTimeout(
				() => reject(new Error('Timed out waiting for restored settle render')),
				15_000,
			);
			const check = () => {
				const {frame} = store.getState().render;
				if (frame?.level !== 'settle') {
					return;
				}

				globalThis.clearTimeout(timeout);
				unsubscribe();
				resolve();
			};

			const unsubscribe = store.subscribe(check);
			check();
		});

		const state = store.getState();
		return {
			hash: globalThis.location.hash,
			projectCount: state.projects.length,
			activeProjectId: state.activeProjectId,
			projectName: state.activeProject?.name ?? null,
			instanceCount: state.activeProject?.stack.instances.length ?? 0,
			angle: state.activeProject?.stack.instances[0]?.params.angle ?? null,
			seed: state.activeProject?.stack.instances[0]?.params.seed ?? null,
			historyHeadSeq: state.activeProject?.historyHeadSeq ?? null,
			historyLength: state.history.length,
			viewState: state.activeProject?.viewState ?? null,
			frameLevel: state.render.frame?.level ?? null,
			frameWidth: state.render.frame?.width ?? null,
			frameHeight: state.render.frame?.height ?? null,
		};
	});
}

test('restores library, open project, stack, history, view state, and worker render across reload, and undoes after reload', async ({
	page,
}) => {
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') {
			consoleErrors.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		pageErrors.push(error.message);
	});

	await page.goto('/');
	const created = await waitForBootAndCreateSession(page);

	await page.reload();
	const restored = await readRestoredSession(page);

	expect(restored).toEqual({
		hash: `#/p/${created.projectId}`,
		projectCount: 1,
		activeProjectId: created.projectId,
		projectName: 'e2e-gradient',
		instanceCount: 1,
		angle: 90,
		seed: created.seed,
		historyHeadSeq: 2,
		historyLength: 3,
		viewState: {
			fitMode: 'custom',
			zoom: 2.25,
			centerX: 70,
			centerY: 50,
			splitPosition: 0.4,
		},
		frameLevel: 'settle',
		frameWidth: 160,
		frameHeight: 120,
	});

	const afterUndo = await page.evaluate(async () => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime!;
		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error('Not ready');
		}

		const undone = await booted.bundle.store.getState().undo();
		const active = booted.bundle.store.getState().activeProject;
		return {
			undone,
			angle: active?.stack.instances[0]?.params.angle ?? null,
			historyHeadSeq: active?.historyHeadSeq ?? null,
			zoom: active?.viewState.zoom ?? null,
		};
	});

	expect(afterUndo).toEqual({
		undone: true,
		angle: 0,
		historyHeadSeq: 1,
		zoom: 2.25,
	});
	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});

test('restores full session after closing and reopening the browser context with the same profile directory', async ({
	browserName,
	playwright,
	baseURL,
}) => {
	const profileDir = mkdtempSync(
		path.join(os.tmpdir(), `psg-e2e-${browserName}-`),
	);
	const browserType = playwright[browserName];
	const targetUrl = baseURL ?? 'http://localhost:4173';

	try {
		const context1 = await browserType.launchPersistentContext(profileDir, {
			headless: true,
		});
		let created: {projectId: string; instanceId: string; seed: number};
		try {
			const page1 = context1.pages()[0] ?? (await context1.newPage());
			await page1.goto(targetUrl);
			created = await waitForBootAndCreateSession(page1);
		} finally {
			await context1.close();
		}

		const context2 = await browserType.launchPersistentContext(profileDir, {
			headless: true,
		});
		try {
			const page2 = context2.pages()[0] ?? (await context2.newPage());
			await page2.goto(targetUrl);
			const restored = await readRestoredSession(page2);

			expect(restored).toEqual({
				hash: `#/p/${created.projectId}`,
				projectCount: 1,
				activeProjectId: created.projectId,
				projectName: 'e2e-gradient',
				instanceCount: 1,
				angle: 90,
				seed: created.seed,
				historyHeadSeq: 2,
				historyLength: 3,
				viewState: {
					fitMode: 'custom',
					zoom: 2.25,
					centerX: 70,
					centerY: 50,
					splitPosition: 0.4,
				},
				frameLevel: 'settle',
				frameWidth: 160,
				frameHeight: 120,
			});
		} finally {
			await context2.close();
		}
	} finally {
		rmSync(profileDir, {recursive: true, force: true});
	}
});
