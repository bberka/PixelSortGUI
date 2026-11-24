// @vitest-environment happy-dom
import {act, type ComponentProps, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {
	createFakeCoordinator,
	createFakeRouterEnv,
	createFakeTimerEnv,
	makeTestBlob,
	type FakeCoordinator,
	type FakeTimerEnv,
} from '../../../tests/state/fixtures.ts';
import {ParameterPanel} from './params-panel.tsx';
import type {Slider as SliderComponent} from '@/components/ui/slider';
import {AppRuntimeProvider} from '@/app/runtime-context.tsx';
import {effects} from '@/engine/effects/index.ts';
import {createRegistry} from '@/engine/registry.ts';
import type {
	EffectDefinition,
	EffectRegistry,
	ParamSpecs,
	ParamValue,
} from '@/engine/types.ts';
import {createAppStore, type AppStore} from '@/state/app-store.ts';
import type {AppRuntime} from '@/state/index.ts';
import {MemoryStorageAdapter} from '@/storage/memory-adapter.ts';
import type {TransientStore} from '@/state/transient.ts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type SliderProps = ComponentProps<typeof SliderComponent>;

const sliderRenders = vi.hoisted(() => new Map<string, number>());

vi.mock('@/components/ui/slider', async (importOriginal) => {
	const actual = await importOriginal<{Slider: typeof SliderComponent}>();
	const CountingSlider = (props: SliderProps): ReactNode => {
		const key = props.thumbLabels?.[0] ?? 'unlabelled';
		sliderRenders.set(key, (sliderRenders.get(key) ?? 0) + 1);
		return <actual.Slider {...props} />;
	};

	return {...actual, Slider: CountingSlider};
});

type TestEffectParams = {
	ratio: number;
	pixels: number;
	switchOn: boolean;
	mode: string;
	key: string;
	window: readonly [number, number];
	heading: number;
	grain: number;
	extra: number;
};

const testEffectParams: ParamSpecs<TestEffectParams> = {
	ratio: {
		kind: 'number',
		label: 'Ratio',
		group: 'First group',
		help: 'A ratio between nothing and everything.',
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.5,
		unit: 'ratio',
	},
	pixels: {
		kind: 'integer',
		label: 'Pixels',
		group: 'First group',
		min: 0,
		max: 100,
		default: 12,
		unit: 'px',
	},
	switchOn: {
		kind: 'boolean',
		label: 'Switch on',
		group: 'Second group',
		default: true,
	},
	mode: {
		kind: 'enum',
		label: 'Mode',
		group: 'Second group',
		options: [
			{value: 'basic', label: 'Basic'},
			{value: 'advanced', label: 'Advanced'},
		],
		default: 'basic',
	},
	key: {
		kind: 'enum',
		label: 'Key',
		group: 'Second group',
		options: [
			{value: 'one', label: 'One'},
			{value: 'two', label: 'Two'},
			{value: 'three', label: 'Three'},
			{value: 'four', label: 'Four'},
			{value: 'five', label: 'Five'},
		],
		default: 'three',
	},
	window: {
		kind: 'range',
		label: 'Window',
		group: 'Third group',
		min: 0,
		max: 10,
		step: 0.5,
		default: [2, 8],
	},
	heading: {
		kind: 'angle',
		label: 'Heading',
		group: 'Third group',
		default: 45,
		snaps: [0, 45, 90, 135, 180, 225, 270, 315],
	},
	grain: {
		kind: 'seed',
		label: 'Grain',
		group: 'Third group',
	},
	extra: {
		kind: 'number',
		label: 'Extra',
		group: 'First group',
		min: 0,
		max: 10,
		step: 0.1,
		default: 1,
		visibleWhen: {param: 'mode', equals: ['advanced']},
	},
};

function copyThrough(
	input: {
		readonly width: number;
		readonly height: number;
		readonly data: Uint8ClampedArray;
	},
	output: {readonly data: Uint8ClampedArray},
): void {
	output.data.set(input.data);
}

const testEffect: EffectDefinition<TestEffectParams> = {
	type: 'testEffect',
	version: 1,
	label: 'Test effect',
	description: 'Registered only by the parameter panel tests.',
	category: 'sort',
	params: testEffectParams,
	debugViews: ['selection'],
	render(input, output) {
		copyThrough(input, output);
	},
};

type Harness = {
	readonly store: AppStore;
	readonly transientStore: TransientStore;
	readonly repository: MemoryStorageAdapter;
	readonly coordinator: FakeCoordinator;
	readonly timerEnv: FakeTimerEnv;
	readonly registry: EffectRegistry;
	readonly instanceId: string;
	readonly projectId: string;
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

function mountPanel(
	store: AppStore,
	transientStore: TransientStore,
	repository: MemoryStorageAdapter,
	coordinator: FakeCoordinator,
	registry?: EffectRegistry,
): HTMLDivElement {
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			<AppRuntimeProvider
				value={{
					runtime: stubRuntime(),
					bundle: {
						store,
						transientStore,
						repository,
						coordinator,
						dispose() {},
					},
				}}
			>
				<ParameterPanel registry={registry} />
			</AppRuntimeProvider>,
		);
	});
	return container;
}

async function flush(turns = 8): Promise<void> {
	for (let index = 0; index < turns; index++) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

function createStore(
	registry?: EffectRegistry,
): Omit<Harness, 'instanceId' | 'projectId'> {
	const timerEnv = createFakeTimerEnv();
	const repository = new MemoryStorageAdapter({now: () => timerEnv.now()});
	const coordinator = createFakeCoordinator();
	const bundle = createAppStore({
		repository,
		coordinator,
		registry,
		routerEnv: createFakeRouterEnv(),
		timerEnv,
		syncTheme() {},
		thumbnailGenerator: async () => ({
			blob: makeTestBlob('thumb'),
			width: 8,
			height: 8,
		}),
	});
	bundle.store.getState().attachListeners();
	return {
		store: bundle.store,
		transientStore: bundle.transientStore,
		repository,
		coordinator,
		timerEnv,
		registry: registry ?? createRegistry(effects),
	};
}

async function setup(options: {
	type: string;
	registry?: EffectRegistry;
}): Promise<Harness> {
	const base = createStore(options.registry);
	const {project} = await base.store.getState().importImage({
		name: 'params.png',
		blob: makeTestBlob('params'),
		width: 8,
		height: 8,
	});
	const instance = await base.store.getState().addEffect(options.type);
	return {...base, instanceId: instance.id, projectId: project.id};
}

async function setupTestEffect(): Promise<Harness> {
	const registry = createRegistry([...effects, testEffect]);
	return setup({type: testEffect.type, registry});
}

function paramInput(id: string, key: string): HTMLInputElement {
	const input = container?.querySelector<HTMLInputElement>(
		`#param-${id}-${key}`,
	);
	if (!input) {
		throw new Error(`No input for ${key}`);
	}

	return input;
}

function sliderFor(name: string): HTMLElement {
	const element = container?.querySelector<HTMLElement>(
		`[role="slider"][aria-label="${CSS.escape(name)}"]`,
	);
	if (!element) {
		throw new Error(`No slider named ${name}`);
	}

	return element;
}

function setInputValue(input: HTMLInputElement, text: string): void {
	act(() => {
		typeInto(input, text);
	});
}

function typeInto(input: HTMLInputElement, text: string): void {
	const setter = Object.getOwnPropertyDescriptor(
		globalThis.HTMLInputElement.prototype,
		'value',
	)?.set;
	if (!setter) {
		throw new Error('HTMLInputElement value setter is missing');
	}

	setter.call(input, text);
	input.dispatchEvent(new Event('input', {bubbles: true}));
}

function press(element: Element, key: string, shiftKey = false): void {
	act(() => {
		element.dispatchEvent(
			new KeyboardEvent('keydown', {key, shiftKey, bubbles: true}),
		);
	});
}

async function storedParams(
	harness: Harness,
): Promise<Record<string, ParamValue> | undefined> {
	const persisted = await harness.repository.getProject(harness.projectId);
	return persisted?.stack.instances[0]?.params;
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
});

function mount(harness: Harness): HTMLDivElement {
	return mountPanel(
		harness.store,
		harness.transientStore,
		harness.repository,
		harness.coordinator,
		harness.registry,
	);
}

function rowFor(id: string, key: string): HTMLElement {
	const row = paramInput(id, key).closest<HTMLElement>('[data-param-row]');
	if (!row) {
		throw new Error(`No row for ${key}`);
	}

	return row;
}

async function commit(
	harness: Harness,
	key: string,
	value: ParamValue,
): Promise<void> {
	await act(async () => {
		await harness.store.getState().commitParam(harness.instanceId, key, value);
	});
	await flush();
}

function historyHead(harness: Harness): number {
	return harness.store.getState().activeProject?.historyHeadSeq ?? -1;
}

function lastHistoryLabel(harness: Harness): string | undefined {
	return harness.store.getState().history.at(-1)?.label;
}

describe('parameter panel states', () => {
	it('shows a note when no instance is selected and nothing without a project', async () => {
		const harness = await setup({type: 'pixelSort'});
		harness.store.getState().selectEffect(null);
		mount(harness);
		await flush();
		expect(container?.textContent).toContain('No effect selected');

		act(() => {
			root!.unmount();
		});
		root = undefined;
		container?.remove();
		container = undefined;
		await harness.store.getState().closeProject({updateHash: false});
		const remounted = mount(harness);
		await flush();
		expect(remounted.textContent).toBe('');
	});

	it('keeps the controls of a disabled instance and marks it Off', async () => {
		const harness = await setup({type: 'pixelSort'});
		await act(async () => {
			await harness.store
				.getState()
				.setEffectEnabled(harness.instanceId, false);
		});
		mount(harness);
		await flush();

		expect(container?.textContent).toContain('Off');
		expect(paramInput(harness.instanceId, 'angle')).toBeDefined();
		expect(sliderFor('Skip chance')).toBeDefined();
	});

	it('shows unsupported instances as a note with no controls', async () => {
		const harness = await setup({type: 'pixelSort'});
		const futureInstance = {
			id: 'future01',
			type: 'futureEffect',
			version: 7,
			enabled: true,
			params: {},
			mix: 1,
			blend: 'normal',
		} as const;
		const stack = harness.store.getState().activeProject?.stack;
		await harness.repository.saveProjectStack(harness.projectId, {
			schemaVersion: 1,
			instances: [...(stack?.instances ?? []), futureInstance],
		});
		await act(async () => {
			await harness.store.getState().openProject(harness.projectId);
		});
		harness.store.getState().selectEffect(futureInstance.id);
		mount(harness);
		await flush();

		expect(container?.textContent).toContain(
			'Unsupported effect (futureEffect v7)',
		);
		expect(container?.querySelector('[role="slider"]')).toBeNull();
		expect(container?.querySelector('input')).toBeNull();
	});
});

describe('schema-driven controls', () => {
	it('renders a control for every parameter kind with the schema label, range, unit and default', async () => {
		const harness = await setupTestEffect();
		mount(harness);
		await flush();
		const {instanceId} = harness;

		expect(
			[...container!.querySelectorAll('h3')].map(
				(heading) => heading.textContent,
			),
		).toEqual(['First group', 'Second group', 'Third group', 'Blend & Mix']);

		const ratioInput = paramInput(instanceId, 'ratio');
		expect(ratioInput.value).toBe('0.5');
		expect(ratioInput.inputMode).toBe('decimal');
		const ratioSlider = sliderFor('Ratio');
		expect(ratioSlider.getAttribute('aria-valuemin')).toBe('0');
		expect(ratioSlider.getAttribute('aria-valuemax')).toBe('1');
		expect(ratioSlider.getAttribute('aria-valuenow')).toBe('0.5');
		const ratioRow = rowFor(instanceId, 'ratio');
		expect(ratioRow.textContent).toContain('Ratio');
		expect(ratioRow.textContent).toContain('0.5');
		expect(ratioRow.textContent).toContain(
			'A ratio between nothing and everything.',
		);

		const pixelsInput = paramInput(instanceId, 'pixels');
		expect(pixelsInput.value).toBe('12');
		expect(pixelsInput.inputMode).toBe('numeric');
		expect(rowFor(instanceId, 'pixels').textContent).toContain('12 px');
		expect(sliderFor('Pixels').getAttribute('aria-valuemax')).toBe('100');

		const booleanSwitch = container!.querySelector(
			`#param-${instanceId}-switchOn`,
		);
		expect(booleanSwitch?.getAttribute('role')).toBe('switch');
		expect(booleanSwitch?.getAttribute('aria-checked')).toBe('true');
		expect(
			container!.querySelector(
				`label[for="param-${CSS.escape(instanceId)}-switchOn"]`,
			)?.textContent,
		).toBe('Switch on');

		const modeGroup = container!.querySelector<HTMLElement>(
			`[role="radiogroup"][aria-labelledby="param-${CSS.escape(instanceId)}-mode-label"]`,
		);
		const modeOptions = [
			...modeGroup!.querySelectorAll<HTMLElement>('[role="radio"]'),
		];
		expect(modeOptions.map((radio) => radio.textContent)).toEqual([
			'Basic',
			'Advanced',
		]);
		expect(modeOptions[0].getAttribute('aria-checked')).toBe('true');

		const combobox = container!.querySelector('[role="combobox"]');
		expect(combobox?.textContent).toContain('Three');
		expect(combobox?.getAttribute('aria-expanded')).toBe('false');

		expect(sliderFor('Window low').getAttribute('aria-valuenow')).toBe('2');
		expect(sliderFor('Window high').getAttribute('aria-valuenow')).toBe('8');
		expect(sliderFor('Window low').getAttribute('aria-valuemax')).toBe('10');
		expect(paramInput(instanceId, 'window-low').value).toBe('2');
		expect(paramInput(instanceId, 'window-high').value).toBe('8');
		expect(
			container!.querySelector(
				`label[for="param-${CSS.escape(instanceId)}-window-low"]`,
			)?.textContent,
		).toBe('Low');
		expect(
			container!.querySelector(
				`label[for="param-${CSS.escape(instanceId)}-window-high"]`,
			)?.textContent,
		).toBe('High');

		const dial = sliderFor('Heading');
		expect(dial.getAttribute('aria-valuemin')).toBe('0');
		expect(dial.getAttribute('aria-valuemax')).toBe('360');
		expect(dial.getAttribute('aria-valuenow')).toBe('45');
		expect(dial.getAttribute('aria-valuetext')).toBe('45.0°');
		expect(paramInput(instanceId, 'heading').value).toBe('45.0');

		const grain = paramInput(instanceId, 'grain');
		expect(grain.value).toMatch(/^\d+$/);
		expect(grain.inputMode).toBe('numeric');
		expect(rowFor(instanceId, 'grain').textContent).toContain(grain.value);
		expect(
			[...container!.querySelectorAll('button')].map(
				(button) => button.textContent,
			),
		).toContain('New seed');
		expect(
			container!.querySelector('button[aria-label="Reset Grain to default"]')
				?.className,
		).toContain('opacity-100');

		expect(container!.querySelector(`#param-${instanceId}-extra`)).toBeNull();
	});

	it('follows visibleWhen as other parameters change', async () => {
		const harness = await setupTestEffect();
		mount(harness);
		await flush();
		expect(
			container!.querySelector(`#param-${harness.instanceId}-extra`),
		).toBeNull();

		await commit(harness, 'mode', 'advanced');
		expect(paramInput(harness.instanceId, 'extra').value).toBe('1');

		await commit(harness, 'mode', 'basic');
		expect(
			container!.querySelector(`#param-${harness.instanceId}-extra`),
		).toBeNull();
	});

	it('hides the threshold range and shows the edge controls for the edges interval mode', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const {instanceId} = harness;

		expect(paramInput(instanceId, 'threshold-low')).toBeDefined();
		expect(
			container!.querySelector(`#param-${instanceId}-edgeThreshold`),
		).toBeNull();
		expect(
			container!.querySelector(`#param-${instanceId}-edgeBlur`),
		).toBeNull();
		expect(
			container!.querySelector(`#param-${instanceId}-lengthJitter`),
		).toBeNull();

		await commit(harness, 'intervalMode', 'edges');
		expect(
			container!.querySelector(`#param-${instanceId}-threshold-low`),
		).toBeNull();
		expect(paramInput(instanceId, 'edgeThreshold').value).toBe('0.2');
		expect(paramInput(instanceId, 'edgeBlur').value).toBe('1');
		expect(
			container!.querySelector(`#param-${instanceId}-invert`),
		).toBeDefined();

		await commit(harness, 'maxLength', 64);
		expect(paramInput(instanceId, 'lengthJitter').value).toBe('0');

		await commit(harness, 'intervalMode', 'whole');
		expect(container!.querySelector(`#param-${instanceId}-invert`)).toBeNull();
	});
});

describe('exact entry', () => {
	it('commits a typed angle on Enter as one history entry', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const before = historyHead(harness);
		const input = paramInput(harness.instanceId, 'angle');

		setInputValue(input, '37.5');
		press(input, 'Enter');
		await flush();

		expect((await storedParams(harness))?.angle).toBe(37.5);
		expect(historyHead(harness)).toBe(before + 1);
		expect(input.value).toBe('37.5');
		expect(rowFor(harness.instanceId, 'angle').textContent).toContain('37.5°');
	});

	it('clamps an out-of-range typed value and shows the clamped value', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const input = paramInput(harness.instanceId, 'skipChance');

		setInputValue(input, '400');
		press(input, 'Enter');
		await flush();

		expect((await storedParams(harness))?.skipChance).toBe(1);
		expect(input.value).toBe('1');
	});

	it('rounds a typed value to the step', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const input = paramInput(harness.instanceId, 'skipChance');

		setInputValue(input, '0.234');
		press(input, 'Enter');
		await flush();

		expect((await storedParams(harness))?.skipChance).toBe(0.23);
		expect(input.value).toBe('0.23');
	});

	it('restores the previous value on Escape and on input it cannot parse', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const before = historyHead(harness);
		const input = paramInput(harness.instanceId, 'skipChance');

		setInputValue(input, '0.5');
		press(input, 'Escape');
		await flush();
		expect(input.value).toBe('0');
		expect(historyHead(harness)).toBe(before);

		setInputValue(input, 'not a number');
		press(input, 'Enter');
		await flush();
		expect(input.value).toBe('0');
		expect((await storedParams(harness))?.skipChance).toBe(0);
		expect(historyHead(harness)).toBe(before);
	});

	it('commits on blur and swaps a range typed with low above high', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const before = historyHead(harness);
		const low = paramInput(harness.instanceId, 'threshold-low');

		setInputValue(low, '0.9');
		act(() => {
			low.focus();
			low.blur();
		});
		await flush();

		expect((await storedParams(harness))?.threshold).toEqual([0.8, 0.9]);
		expect(paramInput(harness.instanceId, 'threshold-low').value).toBe('0.8');
		expect(paramInput(harness.instanceId, 'threshold-high').value).toBe('0.9');
		expect(historyHead(harness)).toBe(before + 1);
	});

	it('writes a new seed as one commit', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const before = historyHead(harness);
		const seedBefore = (await storedParams(harness))?.seed;

		act(() => {
			container!
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Reset Seed to default"]',
				)
				?.click();
		});
		await flush();

		expect(historyHead(harness)).toBe(before + 1);
		expect((await storedParams(harness))?.seed).not.toBe(seedBefore);
	});
});

describe('keyboard and drag commits', () => {
	it('moves a slider by one step per Arrow and ten per Shift+Arrow as one commit per burst', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const before = historyHead(harness);
		const thumb = sliderFor('Skip chance');

		press(thumb, 'ArrowRight');
		press(thumb, 'ArrowRight');
		press(thumb, 'Shift+ArrowRight'.replace('Shift+', ''), true);
		expect(rowFor(harness.instanceId, 'skipChance').textContent).toContain(
			'0.12',
		);
		expect(historyHead(harness)).toBe(before);

		await act(async () => {
			harness.timerEnv.advance(500);
		});
		await flush();

		expect((await storedParams(harness))?.skipChance).toBe(0.12);
		expect(historyHead(harness)).toBe(before + 1);
	});

	it('sends Home and End to the ends of a slider', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const thumb = sliderFor('Skip chance');

		press(thumb, 'End');
		await act(async () => {
			harness.timerEnv.advance(500);
		});
		await flush();
		expect((await storedParams(harness))?.skipChance).toBe(1);

		press(thumb, 'Home');
		await act(async () => {
			harness.timerEnv.advance(500);
		});
		await flush();
		expect((await storedParams(harness))?.skipChance).toBe(0);
	});

	it('moves the dial by 1 degree per Arrow and 15 per Shift+Arrow', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const dial = sliderFor('Angle');

		press(dial, 'ArrowUp');
		expect(dial.getAttribute('aria-valuenow')).toBe('1');
		press(dial, 'ArrowUp', true);
		expect(dial.getAttribute('aria-valuenow')).toBe('16');

		await act(async () => {
			harness.timerEnv.advance(500);
		});
		await flush();
		expect((await storedParams(harness))?.angle).toBe(16);

		press(dial, 'Home');
		await act(async () => {
			harness.timerEnv.advance(500);
		});
		await flush();
		expect((await storedParams(harness))?.angle).toBe(0);
	});

	it('shows the dragged value and commits the whole drag once', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const before = historyHead(harness);
		const {instanceId} = harness;

		act(() => {
			harness.store.getState().dragParam(instanceId, 'threshold', [0.3, 0.8]);
		});
		act(() => {
			harness.store.getState().dragParam(instanceId, 'threshold', [0.31, 0.8]);
		});
		act(() => {
			harness.store.getState().dragParam(instanceId, 'threshold', [0.32, 0.8]);
		});
		expect(paramInput(instanceId, 'threshold-low').value).toBe('0.32');
		expect(historyHead(harness)).toBe(before);

		await act(async () => {
			await harness.store
				.getState()
				.commitParam(instanceId, 'threshold', [0.32, 0.8]);
		});
		await flush();

		expect((await storedParams(harness))?.threshold).toEqual([0.32, 0.8]);
		expect(historyHead(harness)).toBe(before + 1);
		expect(paramInput(instanceId, 'threshold-low').value).toBe('0.32');
	});
});

describe('reset', () => {
	it('resets one parameter to its default as one commit', async () => {
		const harness = await setup({type: 'pixelSort'});
		await commit(harness, 'angle', 90);
		mount(harness);
		await flush();
		const before = historyHead(harness);

		act(() => {
			container!
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Reset Angle to default"]',
				)
				?.click();
		});
		await flush();

		expect((await storedParams(harness))?.angle).toBe(0);
		expect(historyHead(harness)).toBe(before + 1);
		expect(lastHistoryLabel(harness)).toBe('Reset Angle');
	});

	it('resets every parameter, the mix and the blend as one commit', async () => {
		const harness = await setup({type: 'pixelSort'});
		await commit(harness, 'angle', 90);
		await commit(harness, 'fill', 'average');
		await act(async () => {
			await harness.store.getState().commitMix(harness.instanceId, 0.4);
		});
		await act(async () => {
			await harness.store.getState().setBlend(harness.instanceId, 'difference');
		});
		mount(harness);
		await flush();
		const before = historyHead(harness);

		act(() => {
			[...container!.querySelectorAll<HTMLButtonElement>('button')]
				.find((button) => button.textContent === 'Reset all')
				?.click();
		});
		await flush();

		const instance = harness.store
			.getState()
			.activeProject?.stack.instances.find(
				(item) => item.id === harness.instanceId,
			);
		expect(instance?.params.angle).toBe(0);
		expect(instance?.params.fill).toBe('sort');
		expect(instance?.mix).toBe(1);
		expect(instance?.blend).toBe('normal');
		expect(historyHead(harness)).toBe(before + 1);
	});
});

describe('mix, blend and the selection view', () => {
	it('drags the mix as one commit and stores it as 0..1', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const before = historyHead(harness);

		act(() => {
			harness.store.getState().dragMix(harness.instanceId, 0.4);
		});
		expect(sliderFor('Mix').getAttribute('aria-valuenow')).toBe('40');
		expect(container?.textContent).toContain('40%');
		expect(historyHead(harness)).toBe(before);

		await act(async () => {
			await harness.store.getState().commitMix(harness.instanceId, 0.4);
		});
		await flush();

		expect(
			harness.store.getState().activeProject?.stack.instances[0]?.mix,
		).toBe(0.4);
		expect(historyHead(harness)).toBe(before + 1);
	});

	it('commits a typed mix percentage', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const input = paramInput(harness.instanceId, 'mix');

		setInputValue(input, '25');
		press(input, 'Enter');
		await flush();

		expect(
			harness.store.getState().activeProject?.stack.instances[0]?.mix,
		).toBe(0.25);
		expect(input.value).toBe('25%');
	});

	it('commits a blend mode change', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const before = historyHead(harness);

		const difference = [
			...container!.querySelectorAll<HTMLElement>('[role="radio"]'),
		].find((radio) => radio.textContent === 'Difference');
		act(() => {
			difference?.click();
		});
		await flush();

		expect(
			harness.store.getState().activeProject?.stack.instances[0]?.blend,
		).toBe('difference');
		expect(historyHead(harness)).toBe(before + 1);
	});

	it('turns the selection view on and off without a history entry', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();
		const before = historyHead(harness);
		const toggle = container!.querySelector<HTMLElement>(
			`#param-${harness.instanceId}-showSelection`,
		);
		expect(toggle).not.toBeNull();

		act(() => {
			toggle!.click();
		});
		await flush();
		expect(harness.store.getState().debugView).toEqual({
			instanceId: harness.instanceId,
			view: 'selection',
		});
		expect(historyHead(harness)).toBe(before);

		act(() => {
			toggle!.click();
		});
		await flush();
		expect(harness.store.getState().debugView).toBeNull();
		expect(historyHead(harness)).toBe(before);
	});

	it('shows the selection switch only for an effect that declares the selection view', async () => {
		const harness = await setup({type: 'channelShift'});
		mount(harness);
		await flush();

		expect(
			container!.querySelector(`#param-${harness.instanceId}-showSelection`),
		).toBeNull();
		expect(container?.textContent).not.toContain('Show selection');
		expect(paramInput(harness.instanceId, 'redX')).toBeDefined();
	});
});

describe('render isolation during a drag', () => {
	it('re-renders only the dragged control while the drag is in progress', async () => {
		const harness = await setup({type: 'pixelSort'});
		mount(harness);
		await flush();

		const threshold = 'Threshold range low';
		const others = ['Maximum interval length', 'Skip chance', 'Mix'];
		sliderRenders.clear();

		for (const [low, high] of [
			[0.3, 0.8],
			[0.31, 0.8],
			[0.32, 0.8],
		]) {
			act(() => {
				harness.store
					.getState()
					.dragParam(harness.instanceId, 'threshold', [low, high]);
			});
		}

		expect(sliderRenders.get(threshold)).toBe(3);
		for (const label of others) {
			expect(sliderRenders.get(label) ?? 0).toBe(0);
		}

		expect(paramInput(harness.instanceId, 'threshold-low').value).toBe('0.32');

		await act(async () => {
			await harness.store
				.getState()
				.commitParam(harness.instanceId, 'threshold', [0.32, 0.8]);
		});
		await flush();

		expect(sliderRenders.get(threshold) ?? 0).toBeGreaterThanOrEqual(4);
		for (const label of others) {
			expect(sliderRenders.get(label)).toBe(1);
		}
	});
});

describe('enum controls', () => {
	it('opens the dropdown for more than four options and commits the choice', async () => {
		const harness = await setupTestEffect();
		mount(harness);
		await flush();
		const before = historyHead(harness);
		const trigger = container!.querySelector<HTMLElement>('[role="combobox"]');
		if (!trigger) {
			throw new Error('No select trigger');
		}

		act(() => {
			trigger.dispatchEvent(
				new PointerEvent('pointerdown', {
					bubbles: true,
					button: 0,
					pointerType: 'mouse',
				}),
			);
		});
		await flush();
		const options = [
			...document.querySelectorAll<HTMLElement>('[role="option"]'),
		];
		expect(options.map((option) => option.textContent)).toEqual([
			'One',
			'Two',
			'Three',
			'Four',
			'Five',
		]);

		act(() => {
			options[4].click();
		});
		await flush();

		expect((await storedParams(harness))?.key).toBe('five');
		expect(historyHead(harness)).toBe(before + 1);
	});
});
