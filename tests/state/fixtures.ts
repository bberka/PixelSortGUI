import type {
	ExportOptions,
	ExportTask,
	Frame,
	RenderCoordinator,
	RenderEvent,
	RenderSource,
} from '../../src/render/coordinator.ts';
import type {AppStoreTimerEnv} from '../../src/state/app-store.ts';
import type {HashRouterEnv} from '../../src/state/router.ts';
import type {StackRequest} from '../../src/worker/protocol.ts';

export type FakeCoordinatorCall =
	| {type: 'setSource'; source: RenderSource | undefined}
	| {
			type: 'setStack';
			request: StackRequest;
			options?: {dragging?: boolean};
	  }
	| {type: 'endDrag'}
	| {type: 'setViewScale'; scale: number}
	| {type: 'cancel'}
	| {type: 'retry'}
	| {type: 'dispose'};

export type FakeCoordinator = RenderCoordinator & {
	calls: FakeCoordinatorCall[];
	emit(event: RenderEvent): void;
};

export function createFakeCoordinator(): FakeCoordinator {
	const listeners = new Set<(event: RenderEvent) => void>();
	const calls: FakeCoordinatorCall[] = [];
	let generation = 0;
	let frame: Frame | undefined;

	return {
		calls,
		emit(event) {
			if (event.type === 'frame') {
				frame = event.frame;
			}

			for (const listener of listeners) {
				listener(event);
			}
		},
		setSource(source) {
			calls.push({type: 'setSource', source});
		},
		setStack(request, options) {
			generation++;
			calls.push({
				type: 'setStack',
				request: structuredClone(request),
				options: options ? {...options} : undefined,
			});
		},
		endDrag() {
			calls.push({type: 'endDrag'});
		},
		setViewScale(scale) {
			calls.push({type: 'setViewScale', scale});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		exportImage(_options: ExportOptions): ExportTask {
			return {
				result: Promise.resolve({status: 'cancelled'}),
				cancel() {},
			};
		},
		cancel() {
			calls.push({type: 'cancel'});
		},
		retry() {
			calls.push({type: 'retry'});
		},
		getState() {
			return {
				generation,
				source: undefined,
				frame,
				full: undefined,
				dragCap: 1_048_576,
				failed: false,
			};
		},
		dispose() {
			calls.push({type: 'dispose'});
			listeners.clear();
		},
	};
}

export type FakeRouterEnv = HashRouterEnv & {
	history: string[];
	navigate(hash: string): void;
};

export function createFakeRouterEnv(initialHash = ''): FakeRouterEnv {
	let currentHash = initialHash;
	const history = [initialHash];
	const listeners = new Set<() => void>();

	return {
		history,
		getHash() {
			return currentHash;
		},
		setHash(hash) {
			if (currentHash === hash) {
				return;
			}

			currentHash = hash;
			history.push(hash);
		},
		replaceHash(hash) {
			currentHash = hash;
			history[history.length - 1] = hash;
		},
		addHashChangeListener(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		navigate(hash) {
			currentHash = hash;
			history.push(hash);
			for (const listener of listeners) {
				listener();
			}
		},
	};
}

export type FakeTimerEnv = AppStoreTimerEnv & {
	advance(ms: number): void;
	triggerFlush(): void;
	setDevicePixelRatio(dpr: number): void;
};

export function createFakeTimerEnv(
	startTime = 1_700_000_000_000,
): FakeTimerEnv {
	let now = startTime;
	let dpr = 1;
	let nextHandle = 1;
	const timers = new Map<number, {due: number; callback: () => void}>();
	const flushListeners = new Set<() => void>();

	return {
		setTimeout(callback, ms) {
			const handle = nextHandle++;
			timers.set(handle, {due: now + ms, callback});
			return handle;
		},
		clearTimeout(handle) {
			timers.delete(handle as number);
		},
		now: () => now,
		getDevicePixelRatio: () => dpr,
		addLifecycleListeners(onFlush) {
			flushListeners.add(onFlush);
			return () => {
				flushListeners.delete(onFlush);
			};
		},
		advance(ms) {
			const target = now + ms;
			while (true) {
				let earliestHandle: number | undefined;
				let earliestDue = Infinity;
				for (const [handle, entry] of timers) {
					if (entry.due > target || entry.due >= earliestDue) {
						continue;
					}

					earliestDue = entry.due;
					earliestHandle = handle;
				}

				if (earliestHandle === undefined) {
					break;
				}

				const entry = timers.get(earliestHandle)!;
				timers.delete(earliestHandle);
				now = entry.due;
				entry.callback();
			}

			now = target;
		},
		triggerFlush() {
			for (const listener of flushListeners) {
				listener();
			}
		},
		setDevicePixelRatio(nextDpr) {
			dpr = nextDpr;
		},
	};
}

export function makeTestBlob(label = 'image', byteLength = 64): Blob {
	const bytes = new Uint8Array(byteLength);
	for (let index = 0; index < byteLength; index++) {
		bytes[index] =
			((label.codePointAt(index % label.length) ?? 0) + index * 17) % 256;
	}

	return new Blob([bytes], {type: 'image/png'});
}
