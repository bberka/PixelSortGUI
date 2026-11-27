// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {toast} from 'sonner';
import {
	canReadClipboard,
	namePastedFile,
	pastedImages,
	readClipboardImages,
} from './clipboard-images.ts';
import {PasteImageButton} from './paste-image-button.tsx';
import {useWindowImagePaste} from './use-window-image-paste.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const flow = vi.hoisted(() => ({start: vi.fn()}));
vi.mock('./import-flow.tsx', () => ({
	useImportFlow: () => ({flow, feedback: null}),
}));

function file(name: string, type = 'image/png'): File {
	return new File([new Uint8Array([1, 2, 3])], name, {type});
}

function transfer(files: File[], items: Array<File | null> = []): DataTransfer {
	return {
		files,
		items: items.map((entry) => ({
			kind: entry ? 'file' : 'string',
			getAsFile: () => entry,
		})),
	} as unknown as DataTransfer;
}

function stubClipboard(read?: () => Promise<unknown>): void {
	vi.stubGlobal('navigator', {
		platform: 'Linux',
		userAgent: 'test',
		clipboard: read ? {read} : {},
	});
}

function clipboardItem(types: string[]) {
	return {
		types,
		getType: async (type: string) => new Blob([type], {type}),
	};
}

function stubTouch(matches: boolean): void {
	vi.stubGlobal('matchMedia', () => ({
		matches,
		addEventListener() {},
		removeEventListener() {},
	}));
}

let root: Root | undefined;
let container: HTMLElement | undefined;

function render(node: React.ReactElement): HTMLElement {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(node);
	});
	return container;
}

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = undefined;
	document.body.replaceChildren();
	flow.start.mockClear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

describe('namePastedFile', () => {
	it.each([
		['', 'image/png', 'Pasted image.png'],
		['image.png', 'image/png', 'Pasted image.png'],
		['Image.JPEG', 'image/jpeg', 'Pasted image.jpg'],
		['blob', 'image/svg+xml', 'Pasted image.svg'],
		['unknown.tiff', 'image/tiff', 'Pasted image.tif'],
		['image.heic', '', 'Pasted image.heic'],
	])('replaces the stand-in name %j', (name, type, expected) => {
		const renamed = namePastedFile(file(name, type));
		expect(renamed.name).toBe(expected);
		expect(renamed.type).toBe(type);
	});

	it.each(['sunset.png', 'image 2.png', 'my-image.png'])(
		'keeps the name %j',
		(name) => {
			expect(namePastedFile(file(name)).name).toBe(name);
		},
	);
});

describe('pastedImages', () => {
	it('takes image files, including refused formats without a type', () => {
		const files = pastedImages(
			transfer([
				file('image.png'),
				file('photo.heic', ''),
				file('notes.txt', 'text/plain'),
				file('work.glproj', ''),
				file('all.zip', 'application/zip'),
			]),
		);
		expect(files.map((entry) => entry.name)).toEqual([
			'Pasted image.png',
			'photo.heic',
		]);
	});

	it('falls back to the items when the file list is empty', () => {
		const files = pastedImages(transfer([], [null, file('shot.png')]));
		expect(files.map((entry) => entry.name)).toEqual(['shot.png']);
	});

	it('finds nothing in a text paste or without data', () => {
		expect(pastedImages(transfer([], [null]))).toEqual([]);
		expect(pastedImages(null)).toEqual([]);
	});
});

describe('readClipboardImages', () => {
	it('is unavailable without navigator.clipboard.read', () => {
		stubClipboard();
		expect(canReadClipboard()).toBe(false);
	});

	it('takes one picture per item, preferring PNG', async () => {
		stubClipboard(async () => [
			clipboardItem(['text/html', 'image/jpeg', 'image/png']),
			clipboardItem(['text/plain']),
			clipboardItem(['image/webp']),
		]);
		const result = await readClipboardImages();
		expect(result.status).toBe('images');
		const files = result.status === 'images' ? result.files : [];
		expect(files.map((entry) => [entry.name, entry.type])).toEqual([
			['Pasted image.png', 'image/png'],
			['Pasted image.webp', 'image/webp'],
		]);
	});

	it('reports a clipboard without a picture as empty', async () => {
		stubClipboard(async () => [clipboardItem(['text/plain'])]);
		expect(await readClipboardImages()).toEqual({status: 'empty'});
	});

	it.each([
		['NotAllowedError', 'denied'],
		['SecurityError', 'denied'],
		['DataError', 'empty'],
		['NotFoundError', 'empty'],
		['UnknownError', 'failed'],
	])('maps %s to %s', async (name, status) => {
		stubClipboard(async () => {
			throw new DOMException('no', name);
		});
		expect(await readClipboardImages()).toEqual({status});
	});
});

describe('useWindowImagePaste', () => {
	const onFiles = vi.fn();

	function Listener() {
		useWindowImagePaste(onFiles);
		return null;
	}

	function paste(
		target: EventTarget = document.body,
		files: File[] = [file('image.png')],
	): Event {
		const event = Object.assign(
			new Event('paste', {bubbles: true, cancelable: true}),
			{clipboardData: transfer(files)},
		);
		act(() => {
			target.dispatchEvent(event);
		});
		return event;
	}

	afterEach(() => {
		onFiles.mockClear();
	});

	it('hands on the pictures and claims the event', () => {
		render(<Listener />);
		const event = paste();
		expect(onFiles).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it('leaves a paste without a picture alone', () => {
		render(<Listener />);
		const event = paste(document.body, []);
		expect(onFiles).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it.each([
		'<input type="text">',
		'<textarea></textarea>',
		'<div contenteditable="true"><span tabindex="0">a</span></div>',
	])('stays out of %s, as target or focus', (html) => {
		render(<Listener />);
		const host = document.createElement('div');
		host.innerHTML = html;
		document.body.append(host);
		const field = host.querySelector<HTMLElement>(
			'input, textarea, span, div',
		)!;
		const event = paste(field);
		field.focus();
		paste(document.body);
		expect(onFiles).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it('stays out while a dialog is open', () => {
		render(<Listener />);
		const dialog = document.createElement('div');
		dialog.setAttribute('aria-modal', 'true');
		document.body.append(dialog);
		paste();
		expect(onFiles).not.toHaveBeenCalled();
	});

	it('stops listening when unmounted', () => {
		render(<Listener />);
		act(() => {
			root?.unmount();
		});
		paste();
		expect(onFiles).not.toHaveBeenCalled();
	});
});

describe('PasteImageButton', () => {
	async function press(view: HTMLElement): Promise<void> {
		await act(async () => {
			view.querySelector('button')!.click();
		});
	}

	it('is left out where the clipboard cannot be read', () => {
		stubClipboard();
		expect(render(<PasteImageButton />).querySelector('button')).toBeNull();
	});

	it('starts the import with the clipboard picture', async () => {
		stubClipboard(async () => [clipboardItem(['image/png'])]);
		await press(render(<PasteImageButton />));
		expect(flow.start).toHaveBeenCalledTimes(1);
		const [files] = flow.start.mock.calls[0] as [File[]];
		expect(files.map((entry) => entry.name)).toEqual(['Pasted image.png']);
	});

	it.each([
		[false, 'Press Ctrl+V to paste instead.'],
		[true, undefined],
	])(
		'says that access was denied (touch only: %s)',
		async (touch, description) => {
			stubTouch(touch);
			stubClipboard(async () => {
				throw new DOMException('no', 'NotAllowedError');
			});
			const error = vi.spyOn(toast, 'error');
			await press(render(<PasteImageButton />));
			expect(error).toHaveBeenCalledWith(
				"Drift isn't allowed to read the clipboard.",
				{description},
			);
			expect(flow.start).not.toHaveBeenCalled();
		},
	);

	it('says that the clipboard has no picture', async () => {
		stubClipboard(async () => []);
		const error = vi.spyOn(toast, 'error');
		await press(render(<PasteImageButton />));
		expect(error).toHaveBeenCalledWith('No image on the clipboard.', {
			description: 'Copy an image, then try again.',
		});
		expect(flow.start).not.toHaveBeenCalled();
	});
});
