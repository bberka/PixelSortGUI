import {expect, type Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

/**
 Waits until the newest settle frame is delivered. `page.waitForFunction` does
 not wait for an async predicate (the returned Promise is truthy), so this polls.
 */
export async function waitForSettleRender(page: Page): Promise<void> {
	await expect
		.poll(async () =>
			page.evaluate(async () => {
				const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
				const booted = await runtime?.ready;
				if (!booted || booted.status !== 'ready') {
					return false;
				}

				const {render} = booted.bundle.store.getState();
				return (
					render.source !== undefined &&
					render.frame?.level === 'settle' &&
					!render.busy.settle &&
					!render.busy.drag
				);
			}),
		)
		.toBe(true);
}
