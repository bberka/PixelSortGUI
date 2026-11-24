import type {Page} from '@playwright/test';
import type {AppRuntime} from '../../src/state/index.ts';

type RuntimeGlobal = {
	__psgRuntime?: AppRuntime;
};

export const SEED_SOURCE_WIDTH = 64;
export const SEED_SOURCE_HEIGHT = 48;
export const SEED_THUMBNAIL_WIDTH = 160;
export const SEED_THUMBNAIL_HEIGHT = 120;

/**
 Stores one project per name through the real app store and gives each a result
 thumbnail, without leaving the library. Photos are drawn in the page so no
 image file is committed.
 */
export async function seedLibraryProjects(
	page: Page,
	names: readonly string[],
): Promise<string[]> {
	return page.evaluate(
		async ({projectNames, size, thumbnailSize}) => {
			const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
			if (!runtime) {
				throw new Error('App runtime not attached');
			}

			const booted = await runtime.ready;
			if (booted.status !== 'ready') {
				throw new Error(`Expected ready boot, got ${booted.status}`);
			}

			const {store, repository} = booted.bundle;

			const draw = async (
				width: number,
				height: number,
				hue: number,
			): Promise<Blob> => {
				const canvas = globalThis.document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const context = canvas.getContext('2d');
				if (!context) {
					throw new Error('2D context unavailable');
				}

				const gradient = context.createLinearGradient(0, 0, width, height);
				gradient.addColorStop(0, `hsl(${hue} 60% 20%)`);
				gradient.addColorStop(1, `hsl(${(hue + 120) % 360} 70% 70%)`);
				context.fillStyle = gradient;
				context.fillRect(0, 0, width, height);

				return new Promise<Blob>((resolve, reject) => {
					canvas.toBlob((result) => {
						if (result) {
							resolve(result);
						} else {
							reject(new Error('Failed to encode a synthetic PNG'));
						}
					}, 'image/png');
				});
			};

			const thumbnail = await draw(
				thumbnailSize.width,
				thumbnailSize.height,
				210,
			);
			const ids: string[] = [];
			for (const [index, name] of projectNames.entries()) {
				const blob = await draw(size.width, size.height, (index * 7) % 360);
				const created = await store.getState().importImage({
					name,
					blob,
					width: size.width,
					height: size.height,
					setActive: false,
				});
				await repository.putThumbnail({
					projectId: created.project.id,
					blob: thumbnail,
					width: thumbnailSize.width,
					height: thumbnailSize.height,
					stackSignature: `seed-${index}`,
					updatedAt: Date.now(),
				});
				ids.push(created.project.id);
				// Distinct openedAt values keep the default order deterministic.
				await new Promise((resolve) => {
					globalThis.setTimeout(resolve, 2);
				});
			}

			return ids;
		},
		{
			projectNames: names,
			size: {width: SEED_SOURCE_WIDTH, height: SEED_SOURCE_HEIGHT},
			thumbnailSize: {
				width: SEED_THUMBNAIL_WIDTH,
				height: SEED_THUMBNAIL_HEIGHT,
			},
		},
	);
}

/**
 Creates one project, adds a pixel sort instance, commits an angle and returns
 to the library, so the card's menu has a stack and a history to copy.
 */
export async function seedProjectWithHistory(
	page: Page,
	name: string,
): Promise<{id: string; historyCount: number}> {
	return page.evaluate(async (projectName) => {
		const runtime = (globalThis as unknown as RuntimeGlobal).__psgRuntime;
		if (!runtime) {
			throw new Error('App runtime not attached');
		}

		const booted = await runtime.ready;
		if (booted.status !== 'ready') {
			throw new Error(`Expected ready boot, got ${booted.status}`);
		}

		const {store, repository} = booted.bundle;
		const width = 64;
		const height = 48;
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('2D context unavailable');
		}

		context.fillStyle = '#335577';
		context.fillRect(0, 0, width, height);
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((result) => {
				if (result) {
					resolve(result);
				} else {
					reject(new Error('Failed to encode a synthetic PNG'));
				}
			}, 'image/png');
		});

		const created = await store.getState().importImage({
			name: projectName,
			blob,
			width,
			height,
		});
		const instance = await store.getState().addEffect('pixelSort');
		await store.getState().commitParam(instance.id, 'angle', 90);
		const historyCount = (await repository.getHistory(created.project.id))
			.length;
		await store.getState().closeProject();

		return {id: created.project.id, historyCount};
	}, name);
}
