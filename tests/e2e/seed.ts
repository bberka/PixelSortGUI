import type {Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

/**
 Stores one synthetic photo through the real app store, which also opens it and
 moves the hash to `#/p/<id>`. Specs that need a project in the browser use
 this instead of a hand-written IndexedDB fixture, so the record shape stays
 the store's business.
 */
export async function importSyntheticProject(
	page: Page,
	name = 'Proof image',
): Promise<string> {
	return page.evaluate(async (projectName) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const width = 320;
		const height = 240;
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('2D context unavailable');
		}

		const gradient = context.createLinearGradient(0, 0, width, height);
		gradient.addColorStop(0, '#0b1f3a');
		gradient.addColorStop(0.45, '#d08040');
		gradient.addColorStop(1, '#f4f4f5');
		context.fillStyle = gradient;
		context.fillRect(0, 0, width, height);

		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((result) => {
				if (result) {
					resolve(result);
				} else {
					reject(new Error('Failed to encode the synthetic PNG'));
				}
			}, 'image/png');
		});

		const created = await booted.bundle.store.getState().importImage({
			name: projectName,
			blob,
			width,
			height,
		});

		return created.project.id;
	}, name);
}
