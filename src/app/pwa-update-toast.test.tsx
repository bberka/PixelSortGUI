// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {toast} from 'sonner';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {PWA_UPDATE_TOAST_ID, PwaUpdateToast} from './pwa-update-toast.tsx';
import {Toaster} from '@/components/ui/sonner';
import {usePwaStore} from '@/state/pwa.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function mountUpdateToast() {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			<>
				<PwaUpdateToast />
				<Toaster />
			</>,
		);
	});
}

async function flush(turns = 4): Promise<void> {
	for (let index = 0; index < turns; index++) {
		await act(async () => {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 0);
			});
		});
	}
}

afterEach(() => {
	toast.dismiss(PWA_UPDATE_TOAST_ID);
	usePwaStore.getState().reset();
	if (root) {
		act(() => {
			root!.unmount();
		});
		root = undefined;
	}

	container?.remove();
	container = undefined;
	vi.restoreAllMocks();
});

describe('PwaUpdateToast', () => {
	it('shows a persistent update toast with Reload to update and Later actions without auto-reloading', async () => {
		mountUpdateToast();
		await flush();
		const applySpy = vi.fn(async () => {});

		act(() => {
			usePwaStore.getState().setUpdateReady(true, applySpy);
		});
		await flush();

		expect(document.body.textContent).toContain('A new version is ready.');
		expect(document.body.textContent).toContain('Reload to update');
		expect(document.body.textContent).toContain('Later');
		expect(applySpy).not.toHaveBeenCalled();

		const laterButton = [...document.querySelectorAll('button')].find(
			(button) => button.textContent?.trim() === 'Later',
		);
		expect(laterButton).toBeDefined();

		act(() => {
			laterButton!.click();
		});
		await flush();

		expect(usePwaStore.getState().updateReady).toBe(false);
		expect(applySpy).not.toHaveBeenCalled();
	});

	it('invokes the update handler when Reload to update is clicked', async () => {
		mountUpdateToast();
		await flush();
		const applySpy = vi.fn(async () => {});

		act(() => {
			usePwaStore.getState().setUpdateReady(true, applySpy);
		});
		await flush();

		const reloadButton = [...document.querySelectorAll('button')].find(
			(button) => button.textContent?.trim() === 'Reload to update',
		);
		expect(reloadButton).toBeDefined();

		act(() => {
			reloadButton!.click();
		});
		await flush();

		expect(applySpy).toHaveBeenCalledTimes(1);
		expect(usePwaStore.getState().updateReady).toBe(false);
	});
});
