// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from '../../../tests/state/fixtures.ts';
import {ExportDialog, type ExportDialogProps} from './export-dialog.tsx';
import {
	buildDefaultFilename,
	clampMaxFileSizeKb,
	computeOutputDimensions,
	downloadBlob,
	fileSizeLimitModeFor,
	formatByteSize,
	OOM_EXPORT_MESSAGE,
	parseCustomFileSizeToKb,
	replaceFilenameExtension,
	resolveDownloadFilename,
	toExportScale,
} from './export-helpers.ts';
import {LiveRegion} from '@/app/live-region.tsx';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import type {SupportedEncodeFormats} from '@/codec/encode.ts';
import type {
	ExportOptions,
	ExportOutcome,
	ExportTask,
} from '@/render/coordinator.ts';
import type {AppRuntime} from '@/state/index.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type TestContext = ReturnType<typeof createTestStore>;

type ControlledExport = {
	options: ExportOptions;
	cancelled: boolean;
	resolve(outcome: ExportOutcome): void;
};

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function stubRuntime(): AppRuntime {
	return {
		ready: Promise.resolve({status: 'insecure-context'}),
		result: null,
		dispose() {},
	};
}

function attachExportController(context: TestContext): ControlledExport[] {
	const jobs: ControlledExport[] = [];
	context.coordinator.exportImage = (options: ExportOptions): ExportTask => {
		const {promise: result, resolve} = Promise.withResolvers<ExportOutcome>();
		const job: ControlledExport = {
			options,
			cancelled: false,
			resolve,
		};
		jobs.push(job);
		return {
			result,
			cancel() {
				job.cancelled = true;
				resolve({status: 'cancelled'});
			},
		};
	};

	return jobs;
}

async function flush(turns = 8): Promise<void> {
	for (let index = 0; index < turns; index++) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

async function setup(
	options: {
		name?: string;
		width?: number;
		height?: number;
		effects?: readonly string[];
	} = {},
) {
	const context = createTestStore();
	await context.store.getState().importImage({
		name: options.name ?? 'Sunset.png',
		blob: makeTestBlob('sunset'),
		width: options.width ?? 4001,
		height: options.height ?? 3001,
	});
	for (const type of options.effects ?? []) {
		await context.store.getState().addEffect(type);
	}

	return context;
}

const FIXED_DATE = new Date(2026, 10, 24, 9, 5, 7);
const ALL_FORMATS: SupportedEncodeFormats = {
	png: true,
	jpeg: true,
	webp: true,
};
const NO_WEBP_FORMATS: SupportedEncodeFormats = {
	png: true,
	jpeg: true,
	webp: false,
};

function mountDialog(
	context: TestContext,
	props: Partial<ExportDialogProps> = {},
) {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);

	const renderWith = (override: Partial<ExportDialogProps> = {}) => {
		const merged: ExportDialogProps = {
			open: true,
			onOpenChange() {},
			supportedFormats: ALL_FORMATS,
			canShare: () => false,
			now: () => FIXED_DATE,
			...props,
			...override,
		};
		act(() => {
			root!.render(
				<AppRuntimeProvider
					value={{runtime: stubRuntime(), bundle: context.bundle}}
				>
					<ExportDialog {...merged} />
					<LiveRegion />
				</AppRuntimeProvider>,
			);
		});
	};

	renderWith();
	return {rerender: renderWith};
}

function findButton(label: string): HTMLButtonElement {
	const button = [...document.querySelectorAll('button')].find(
		(element) => element.textContent?.trim() === label,
	);
	if (!button) {
		throw new Error(`Button "${label}" not found`);
	}

	return button;
}

function setInputValue(input: HTMLInputElement, value: string): void {
	const descriptor = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		'value',
	);
	act(() => {
		descriptor?.set?.call(input, value);
		input.dispatchEvent(new Event('input', {bubbles: true}));
		input.dispatchEvent(new Event('change', {bubbles: true}));
	});
}

afterEach(() => {
	if (root) {
		act(() => {
			root!.unmount();
		});
		root = undefined;
	}

	container?.remove();
	container = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('export helpers', () => {
	it('formats default filenames with project name, local timestamp, and extension', () => {
		expect(buildDefaultFilename('Sunset / 01', 'png', FIXED_DATE)).toBe(
			'Sunset - 01-20261124-090507.png',
		);
		expect(buildDefaultFilename('Portrait', 'jpeg', FIXED_DATE)).toBe(
			'Portrait-20261124-090507.jpg',
		);
		expect(buildDefaultFilename('Glitch', 'webp', FIXED_DATE)).toBe(
			'Glitch-20261124-090507.webp',
		);
	});

	it('updates and resolves extensions cleanly across format switches', () => {
		expect(replaceFilenameExtension('photo-20261124-090507.png', 'jpeg')).toBe(
			'photo-20261124-090507.jpg',
		);
		expect(replaceFilenameExtension('photo-20261124-090507.jpg', 'webp')).toBe(
			'photo-20261124-090507.webp',
		);
		expect(resolveDownloadFilename('custom', 'Proj', 'png', FIXED_DATE)).toBe(
			'custom.png',
		);
		expect(
			resolveDownloadFilename(' '.repeat(3), 'Proj', 'jpeg', FIXED_DATE),
		).toBe('Proj-20261124-090507.jpg');
	});

	it('computes floored output dimensions and scales per engine.md section 8.1', () => {
		const half = computeOutputDimensions(
			{format: 'png', quality: 92, sizeMode: 'half', customLongestSide: null},
			4001,
			3001,
		);
		expect(half.width).toBe(2000);
		expect(half.height).toBe(1500);

		const custom = computeOutputDimensions(
			{
				format: 'png',
				quality: 92,
				sizeMode: 'custom',
				customLongestSide: 10_000,
			},
			4001,
			3001,
		);
		expect(custom.width).toBe(4001);
		expect(custom.height).toBe(3001);
		expect(
			toExportScale(
				{
					format: 'png',
					quality: 92,
					sizeMode: 'custom',
					customLongestSide: 2000,
				},
				4000,
				3000,
			),
		).toBe(0.5);
	});

	it('revokes object URLs after download and on cleanup', () => {
		vi.useFakeTimers();
		const createSpy = vi
			.spyOn(URL, 'createObjectURL')
			.mockReturnValue('blob:test-download');
		const revokeSpy = vi
			.spyOn(URL, 'revokeObjectURL')
			.mockImplementation(() => {});
		const clickSpy = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => {});

		const revoke = downloadBlob(makeTestBlob('out'), 'out.png', 500);
		expect(createSpy).toHaveBeenCalledTimes(1);
		expect(clickSpy).toHaveBeenCalledTimes(1);
		expect(revokeSpy).not.toHaveBeenCalled();

		vi.advanceTimersByTime(500);
		expect(revokeSpy).toHaveBeenCalledTimes(1);
		expect(revokeSpy).toHaveBeenCalledWith('blob:test-download');

		revoke();
		expect(revokeSpy).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});
});

describe('ExportDialog', () => {
	it('omits WebP when unsupported and falls back from saved webp to png', async () => {
		const context = await setup();
		await context.store.getState().updateExportSettings({
			format: 'webp',
			quality: 88,
			sizeMode: 'full',
			customLongestSide: null,
		});

		mountDialog(context, {supportedFormats: NO_WEBP_FORMATS});

		const buttons = [...document.querySelectorAll('button')].map((button) =>
			button.textContent?.trim(),
		);
		expect(buttons).toContain('PNG');
		expect(buttons).toContain('JPEG');
		expect(buttons).not.toContain('WebP');
		expect(findButton('PNG').dataset.state).toBe('on');
		expect(document.querySelector('input[type="number"]')).toBeNull();
	});

	it('shows Quality (50..100, default 92) only for lossy formats and clamps input', async () => {
		const context = await setup();
		mountDialog(context);

		expect(document.body.textContent).not.toContain('Quality');
		expect(document.body.textContent).toContain(
			'Exported files are sRGB and carry no EXIF or GPS metadata.',
		);

		act(() => {
			findButton('JPEG').click();
		});
		await flush();

		const qualityInput = document.querySelector<HTMLInputElement>(
			'input[type="number"]',
		);
		expect(qualityInput).not.toBeNull();
		expect(qualityInput?.value).toBe('92');
		expect(document.body.textContent).toContain(
			'Transparent pixels are flattened onto white.',
		);

		setInputValue(qualityInput!, '12');
		act(() => {
			qualityInput!.dispatchEvent(
				new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
			);
		});
		await flush();

		expect(qualityInput!.value).toBe('50');
		expect(context.store.getState().activeProject?.exportSettings.quality).toBe(
			50,
		);

		const filenameInput =
			document.querySelector<HTMLInputElement>('input[type="text"]');
		expect(filenameInput?.value).toBe('Sunset-20261124-090507.jpg');
	});

	it('keeps a separate AVIF quality, default 80, and exports with it', async () => {
		const context = await setup();
		const jobs = attachExportController(context);
		mountDialog(context);
		await flush();

		const quality = () =>
			document.querySelector<HTMLInputElement>('input[type="number"]')!;
		const choose = async (label: string) => {
			act(() => {
				[...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
					.find((radio) => radio.textContent === label)!
					.click();
			});
			await flush();
		};

		await choose('AVIF');
		expect(quality().value).toBe('80');
		setInputValue(quality(), '60');
		act(() => {
			quality().dispatchEvent(new FocusEvent('focusout', {bubbles: true}));
		});
		await flush();
		await choose('JPEG');
		expect(quality().value).toBe('92');
		await choose('AVIF');
		expect(quality().value).toBe('60');
		expect(
			context.store.getState().activeProject?.exportSettings,
		).toMatchObject({format: 'avif', quality: 92, avifQuality: 60});

		act(() => {
			[...document.querySelectorAll('button')]
				.find((button) => button.textContent === 'Download')!
				.click();
		});
		await flush();
		expect(jobs[0]?.options).toMatchObject({format: 'avif', quality: 60});
		expect(
			document.querySelector<HTMLInputElement>('input[type="text"]')?.value,
		).toMatch(/\.avif$/);
	});

	it('updates live dimensions for Full, 1/2, 1/4, and Custom longest side', async () => {
		const context = await setup({width: 4001, height: 3001});
		mountDialog(context);

		const readout = () =>
			document.querySelector('[data-slot="export-dimensions"]')?.textContent;

		expect(readout()).toBe('4001 × 3001 px');

		act(() => {
			findButton('1/2').click();
		});
		await flush();
		expect(readout()).toBe('2000 × 1500 px');

		act(() => {
			findButton('1/4').click();
		});
		await flush();
		expect(readout()).toBe('1000 × 750 px');

		act(() => {
			findButton('Custom').click();
		});
		await flush();

		const longestInput = document.querySelector<HTMLInputElement>(
			'input[type="number"]',
		);
		expect(longestInput?.value).toBe('4001');

		setInputValue(longestInput!, '2000');
		await flush();
		expect(readout()).toBe('2000 × 1500 px');

		setInputValue(longestInput!, '9999');
		act(() => {
			longestInput!.focus();
			longestInput!.blur();
		});
		await flush();
		expect(longestInput!.value).toBe('4001');
		expect(readout()).toBe('4001 × 3001 px');
	});

	it('runs export with progress, delivers download, and announces completion', async () => {
		const context = await setup({width: 4001, height: 3001});
		const jobs = attachExportController(context);
		const downloads: Array<{blob: Blob; filename: string}> = [];
		const revokeSpy = vi.fn();

		mountDialog(context, {
			downloadFile(blob, filename) {
				downloads.push({blob, filename});
				return revokeSpy;
			},
		});

		act(() => {
			findButton('1/2').click();
		});
		await flush();

		act(() => {
			findButton('Download').click();
		});
		await flush();

		expect(jobs).toHaveLength(1);
		expect(jobs[0].options.scale).toBe(0.5);
		expect(jobs[0].options.format).toBe('png');
		expect(document.body.textContent).toContain('Decoding');

		act(() => {
			jobs[0].options.onProgress?.('render', 0.5);
		});
		expect(document.body.textContent).toContain('Rendering');

		act(() => {
			jobs[0].options.onProgress?.('encode', 0.5);
		});
		expect(document.body.textContent).toContain('Encoding');

		const outBlob = makeTestBlob('rendered');
		act(() => {
			jobs[0].resolve({
				status: 'done',
				file: outBlob,
				width: 2000,
				height: 1500,
				mime: 'image/png',
				totalMs: 42,
			});
		});
		await flush();

		expect(downloads).toHaveLength(1);
		expect(downloads[0].blob).toBe(outBlob);
		expect(downloads[0].filename).toBe('Sunset-20261124-090507.png');
		expect(document.querySelector('[role="status"]')?.textContent).toBe(
			'Export finished: Sunset-20261124-090507.png',
		);
	});

	it('cancels an in-flight export without downloading', async () => {
		const context = await setup();
		const jobs = attachExportController(context);
		const downloadSpy = vi.fn(() => () => {});

		mountDialog(context, {downloadFile: downloadSpy});

		act(() => {
			findButton('Download').click();
		});
		await flush();

		act(() => {
			findButton('Cancel').click();
		});
		await flush();

		expect(jobs[0].cancelled).toBe(true);
		expect(downloadSpy).not.toHaveBeenCalled();
		expect(document.querySelector('[data-slot="export-progress"]')).toBeNull();
	});

	it('shows Share only when supported and shares the exported File', async () => {
		const context = await setup();
		const jobs = attachExportController(context);
		const shared: Array<{file: File; title: string}> = [];

		mountDialog(context, {
			canShare: () => true,
			async shareFile(file, title) {
				shared.push({file, title});
			},
		});

		act(() => {
			findButton('Share').click();
		});
		await flush();

		act(() => {
			jobs[0].resolve({
				status: 'done',
				file: makeTestBlob('shared'),
				width: 4001,
				height: 3001,
				mime: 'image/png',
				totalMs: 25,
			});
		});
		await flush();

		expect(shared).toHaveLength(1);
		expect(shared[0].file.name).toBe('Sunset-20261124-090507.png');
		expect(shared[0].file.type).toBe('image/png');
		expect(shared[0].title).toBe('Sunset');
	});

	it('shows out-of-memory guidance and lets the user switch to 1/2 or 1/4 size', async () => {
		const context = await setup({width: 4001, height: 3001});
		const jobs = attachExportController(context);
		mountDialog(context);

		act(() => {
			findButton('Download').click();
		});
		await flush();

		act(() => {
			jobs[0].resolve({
				status: 'error',
				error: {
					code: 'out-of-memory',
					message: 'RangeError: allocation failed',
				},
			});
		});
		await flush();

		const alert = document.querySelector('[role="alert"]');
		expect(alert?.textContent).toContain(OOM_EXPORT_MESSAGE);

		act(() => {
			findButton('Use 1/2 size').click();
		});
		await flush();

		expect(document.querySelector('[role="alert"]')).toBeNull();
		expect(
			context.store.getState().activeProject?.exportSettings.sizeMode,
		).toBe('half');
	});

	it('keeps an in-flight export running if the dialog is closed so the editor is not blocked', async () => {
		const context = await setup();
		const jobs = attachExportController(context);
		const downloads: string[] = [];
		const busyStates: boolean[] = [];

		const {rerender} = mountDialog(context, {
			onBusyChange(busy) {
				busyStates.push(busy);
			},
			downloadFile(_blob, filename) {
				downloads.push(filename);
				return () => {};
			},
		});

		act(() => {
			findButton('Download').click();
		});
		await flush();

		rerender({open: false});
		await flush();
		expect(jobs[0].cancelled).toBe(false);

		act(() => {
			jobs[0].resolve({
				status: 'done',
				file: makeTestBlob('bg'),
				width: 4001,
				height: 3001,
				mime: 'image/png',
				totalMs: 10,
			});
		});
		await flush();

		expect(downloads).toEqual(['Sunset-20261124-090507.png']);
		expect(busyStates.at(-1)).toBe(false);
	});

	it('persists file-size limit presets, shows PNG note, and displays export summary', async () => {
		const context = await setup();
		const jobs = attachExportController(context);

		const {rerender} = mountDialog(context, {
			downloadFile: () => () => {},
		});

		act(() => {
			findButton('1 MB').click();
		});
		await flush();

		expect(
			context.store.getState().activeProject?.exportSettings.maxFileSizeKb,
		).toBe(1024);
		expect(
			document.querySelector('[data-slot="export-png-limit-note"]')
				?.textContent,
		).toContain('PNG is lossless');

		act(() => {
			findButton('Download').click();
		});
		await flush();

		expect(jobs[0].options.maxFileSizeKb).toBe(1024);

		act(() => {
			jobs[0].resolve({
				status: 'done',
				file: new Blob([new Uint8Array(512 * 1024)], {type: 'image/png'}),
				width: 2000,
				height: 1500,
				mime: 'image/png',
				totalMs: 40,
				targetMet: true,
			});
		});
		await flush();

		const summary = document.querySelector('[data-slot="export-summary"]');
		expect(summary?.textContent).toContain('512 KB');
		expect(summary?.textContent).toContain('2000 × 1500 px');

		// Reopening restores the persisted limit.
		rerender({open: false});
		await flush();
		rerender({open: true});
		await flush();

		expect(findButton('1 MB').getAttribute('aria-checked')).toBe('true');
	});

	it('clamps and formats file-size limit helpers', () => {
		expect(clampMaxFileSizeKb(5)).toBe(10);
		expect(clampMaxFileSizeKb(200_000)).toBe(102_400);
		expect(fileSizeLimitModeFor(null)).toBe('off');
		expect(fileSizeLimitModeFor(2048)).toBe('2048');
		expect(fileSizeLimitModeFor(750)).toBe('custom');
		expect(parseCustomFileSizeToKb(2, 'MB')).toBe(2048);
		expect(formatByteSize(512)).toBe('512 B');
		expect(formatByteSize(500 * 1024)).toBe('500 KB');
		expect(formatByteSize(2.5 * 1024 * 1024)).toBe('2.50 MB');
	});
});
