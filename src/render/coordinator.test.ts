import {afterEach, beforeEach, describe, expect, it, vi} from 'vite-plus/test';
import {IDENTITY_TRANSFORM, type SourceTransform} from '../engine/transform.ts';
import type {EffectStack} from '../engine/types.ts';
import type {
	ExportRequest,
	ExportResponse,
	PreviewLevel,
	PreviewRequest,
	PreviewResponse,
} from '../worker/protocol.ts';
import {
	createRenderCoordinator,
	nextDragCap,
	type CoordinatorEnv,
	type RenderEvent,
	type WorkerHandlers,
} from './coordinator.ts';

type FakeWorker<Request, Response> = {
	posted: Request[];
	terminated: boolean;
	reply(response: Response): void;
	fail(message: string): void;
};

type FakeBitmap = ImageBitmap & {closed: boolean};

function bitmap(): FakeBitmap {
	const fake = {
		closed: false,
		close() {
			fake.closed = true;
		},
	};
	return fake as FakeBitmap;
}

function fakeWorker<Request, Response>(
	handlers: WorkerHandlers<Response>,
	list: Array<FakeWorker<Request, Response>>,
) {
	const worker: FakeWorker<Request, Response> = {
		posted: [],
		terminated: false,
		reply: (response) => handlers.message(response),
		fail: (message) => handlers.error(message),
	};
	list.push(worker);
	return {
		post(message: Request) {
			worker.posted.push(message);
		},
		terminate() {
			worker.terminated = true;
		},
	};
}

function stackOf(angle: number): EffectStack {
	return {
		schemaVersion: 1,
		instances: [
			{
				id: 'aaaaaaaa',
				type: 'pixelSort',
				version: 1,
				enabled: true,
				params: {angle},
				mix: 1,
				blend: 'normal',
			},
		],
	};
}

const SOURCE = {key: 'photo', blob: new Blob(['x']), width: 4000, height: 3000};

function setup() {
	const previews: Array<FakeWorker<PreviewRequest, PreviewResponse>> = [];
	const exports: Array<FakeWorker<ExportRequest, ExportResponse>> = [];
	const env: CoordinatorEnv = {
		createPreviewWorker: (handlers) => fakeWorker(handlers, previews),
		createExportWorker: (handlers) => fakeWorker(handlers, exports),
		now: () => Date.now(),
		setTimeout: (callback, ms) => setTimeout(callback, ms),
		clearTimeout(handle) {
			clearTimeout(handle as ReturnType<typeof setTimeout>);
		},
	};
	const coordinator = createRenderCoordinator(env);
	const events: RenderEvent[] = [];
	coordinator.subscribe((event) => {
		events.push(event);
	});

	const preview = () => previews.at(-1)!;
	const posted = <T extends PreviewRequest['type']>(type: T) =>
		preview().posted.filter(
			(message): message is Extract<PreviewRequest, {type: T}> =>
				message.type === type,
		);
	const renders = (level?: PreviewLevel) =>
		posted('render').filter((message) => !level || message.level === level);

	const original = bitmap();
	const finishLoad = () => {
		const load = posted('loadSource').at(-1)!;
		preview().reply({
			type: 'sourceLoaded',
			requestId: load.requestId,
			sourceKey: load.sourceKey,
			settle: {width: 2364, height: 1773},
			drag: {width: 1182, height: 886},
			original,
		});
	};

	const answer = (
		request: Extract<PreviewRequest, {type: 'render'}>,
		totalMs = 30,
	) => {
		const result = bitmap();
		preview().reply({
			type: 'rendered',
			jobId: request.jobId,
			generation: request.generation,
			level: request.level,
			width: 10,
			height: 10,
			bitmap: result,
			totalMs,
			perInstanceMs: [totalMs],
			warnings: [],
		});
		return result;
	};

	const frames = () =>
		events.flatMap((event) => (event.type === 'frame' ? [event.frame] : []));
	const errors = () =>
		events.flatMap((event) => (event.type === 'error' ? [event] : []));

	return {
		coordinator,
		events,
		previews,
		exports,
		preview,
		posted,
		renders,
		finishLoad,
		answer,
		frames,
		errors,
		original,
	};
}

function opened() {
	const context = setup();
	context.coordinator.setSource(SOURCE);
	context.finishLoad();
	return context;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('nextDragCap', () => {
	it('halves over the 50 ms budget, down to 0.125 MP', () => {
		expect(nextDragCap(1_048_576, 50.1)).toBe(524_288);
		expect(nextDragCap(262_144, 500)).toBe(131_072);
		expect(nextDragCap(131_072, 500)).toBe(131_072);
	});

	it('doubles under 40% of the budget, up to 1 MP', () => {
		expect(nextDragCap(131_072, 19.9)).toBe(262_144);
		expect(nextDragCap(524_288, 1)).toBe(1_048_576);
		expect(nextDragCap(1_048_576, 1)).toBe(1_048_576);
	});

	it('keeps the cap between 40% and 100% of the budget', () => {
		expect(nextDragCap(524_288, 20)).toBe(524_288);
		expect(nextDragCap(524_288, 50)).toBe(524_288);
	});
});

describe('source loading', () => {
	it('loads the source with the starting caps and renders settle once it is loaded', () => {
		const {coordinator, posted, renders, finishLoad, events, original} =
			setup();
		coordinator.setStack({stack: stackOf(0)});
		coordinator.setSource(SOURCE);
		expect(posted('loadSource')).toMatchObject([
			{
				sourceKey: 'photo',
				sourceWidth: 4000,
				sourceHeight: 3000,
				caps: {drag: 1_048_576, settle: 4_194_304},
			},
		]);
		expect(renders()).toHaveLength(0);

		finishLoad();
		expect(renders()).toMatchObject([
			{level: 'settle', sourceKey: 'photo', stack: stackOf(0)},
		]);
		expect(events).toContainEqual({
			type: 'source',
			source: {
				key: 'photo',
				width: 4000,
				height: 3000,
				settle: {width: 2364, height: 1773},
				drag: {width: 1182, height: 886},
				original,
			},
		});
	});

	it('ignores a second call with the same key', () => {
		const {coordinator, posted} = opened();
		coordinator.setSource({...SOURCE});
		expect(posted('loadSource')).toHaveLength(1);
	});

	it('drops the frame and late results of the previous source', () => {
		const {coordinator, renders, answer, frames, events, posted, original} =
			opened();
		coordinator.setStack({stack: stackOf(0)});
		const first = answer(renders()[0]);
		coordinator.setStack({stack: stackOf(1)});
		const late = renders()[1];

		coordinator.setSource({...SOURCE, key: 'other'});
		expect(events.at(-1)).toEqual({type: 'source', source: undefined});
		expect(first.closed).toBe(true);
		expect(original.closed).toBe(true);
		expect(coordinator.getState().frame).toBeUndefined();
		expect(posted('loadSource').at(-1)).toMatchObject({sourceKey: 'other'});

		const lateBitmap = answer(late);
		expect(lateBitmap.closed).toBe(true);
		expect(frames()).toHaveLength(1);
	});

	it('unloads the source in the worker', () => {
		const {coordinator, posted} = opened();
		coordinator.setSource(undefined);
		expect(posted('unloadSource')).toEqual([
			{type: 'unloadSource', sourceKey: 'photo'},
		]);
	});

	it('reports a failed load without counting it as a crash', () => {
		const {coordinator, posted, preview, errors, previews} = setup();
		coordinator.setSource(SOURCE);
		preview().reply({
			type: 'error',
			requestId: posted('loadSource')[0].requestId,
			code: 'decode-failed',
			message: 'bad file',
		});
		expect(errors()).toEqual([
			{
				type: 'error',
				error: {code: 'decode-failed', message: 'bad file'},
				failed: false,
			},
		]);
		expect(previews).toHaveLength(1);
	});
});

describe('generations', () => {
	it('gives every stack change a higher generation', () => {
		const {coordinator, renders, answer} = opened();
		coordinator.setStack({stack: stackOf(0)});
		answer(renders()[0]);
		coordinator.setStack({stack: stackOf(1)});
		const [first, second] = renders();
		expect(second.generation).toBeGreaterThan(first.generation);
		expect(coordinator.getState().generation).toBe(second.generation);
	});

	it('drops a drag result that arrives after the settle result of the same generation', () => {
		const {coordinator, renders, answer, frames} = opened();
		coordinator.setStack({stack: stackOf(0)}, {dragging: true});
		coordinator.endDrag();
		const [drag] = renders('drag');
		const [settle] = renders('settle');
		expect(settle.generation).toBe(drag.generation);

		const settleBitmap = answer(settle);
		const dragBitmap = answer(drag);
		expect(frames().map((frame) => frame.level)).toEqual(['settle']);
		expect(dragBitmap.closed).toBe(true);
		expect(settleBitmap.closed).toBe(false);
	});

	it('drops a result older than the one displayed, and closes its bitmap', () => {
		const {coordinator, renders, answer, frames} = opened();
		coordinator.setStack({stack: stackOf(0)}, {dragging: true});
		const [staleDrag] = renders('drag');
		coordinator.setStack({stack: stackOf(1)});
		const [settle] = renders('settle');

		answer(settle);
		const stale = answer(staleDrag);
		expect(frames()).toHaveLength(1);
		expect(frames()[0].generation).toBe(settle.generation);
		expect(stale.closed).toBe(true);
	});

	it('replaces a drag frame with a settle frame and closes the replaced bitmap', () => {
		const {coordinator, renders, answer, frames} = opened();
		coordinator.setStack({stack: stackOf(0)}, {dragging: true});
		const dragBitmap = answer(renders('drag')[0]);
		expect(dragBitmap.closed).toBe(false);
		coordinator.endDrag();
		answer(renders('settle')[0]);
		expect(frames().map((frame) => frame.level)).toEqual(['drag', 'settle']);
		expect(dragBitmap.closed).toBe(true);
	});

	it('ignores an answer for a job it did not send', () => {
		const {coordinator, renders, preview, frames} = opened();
		coordinator.setStack({stack: stackOf(0)});
		const unknown = bitmap();
		preview().reply({
			type: 'rendered',
			jobId: renders()[0].jobId + 100,
			generation: 99,
			level: 'settle',
			width: 1,
			height: 1,
			bitmap: unknown,
			totalMs: 1,
			perInstanceMs: [],
			warnings: [],
		});
		expect(frames()).toHaveLength(0);
		expect(unknown.closed).toBe(true);
	});
});

describe('dragging', () => {
	it('coalesces a burst to the newest stack, one drag render in flight at a time', () => {
		const {coordinator, renders, answer, frames} = opened();
		coordinator.setStack({stack: stackOf(1)}, {dragging: true});
		coordinator.setStack({stack: stackOf(2)}, {dragging: true});
		coordinator.setStack({stack: stackOf(3)}, {dragging: true});
		coordinator.setStack({stack: stackOf(4)}, {dragging: true});
		expect(renders()).toHaveLength(1);
		expect(renders()[0]).toMatchObject({level: 'drag', stack: stackOf(1)});

		answer(renders()[0]);
		expect(renders()).toHaveLength(2);
		expect(renders()[1]).toMatchObject({level: 'drag', stack: stackOf(4)});
		expect(renders()[1].generation).toBe(coordinator.getState().generation);

		answer(renders()[1]);
		expect(renders()).toHaveLength(2);
		expect(frames().map((frame) => frame.generation)).toEqual([
			renders()[0].generation,
			renders()[1].generation,
		]);
	});

	it('renders settle 150 ms after the last change', () => {
		const {coordinator, renders, answer} = opened();
		coordinator.setStack({stack: stackOf(1)}, {dragging: true});
		answer(renders()[0]);
		vi.advanceTimersByTime(100);
		coordinator.setStack({stack: stackOf(2)}, {dragging: true});
		answer(renders()[1]);
		vi.advanceTimersByTime(149);
		expect(renders('settle')).toHaveLength(0);
		vi.advanceTimersByTime(1);
		expect(renders('settle')).toMatchObject([{stack: stackOf(2)}]);
		expect(renders('settle')[0].generation).toBe(renders()[1].generation);
	});

	it('renders settle at once when the control is released, and only once', () => {
		const {coordinator, renders} = opened();
		coordinator.setStack({stack: stackOf(1)}, {dragging: true});
		coordinator.endDrag();
		expect(renders('settle')).toHaveLength(1);
		coordinator.endDrag();
		vi.advanceTimersByTime(1000);
		expect(renders('settle')).toHaveLength(1);
	});

	it('drops the coalesced drag value when settle is requested, and cancels the stale drag', () => {
		const {coordinator, renders, posted, preview, answer} = opened();
		coordinator.setStack({stack: stackOf(1)}, {dragging: true});
		coordinator.setStack({stack: stackOf(2)}, {dragging: true});
		coordinator.endDrag();
		const newest = coordinator.getState().generation;
		expect(posted('cancel')).toEqual([
			{type: 'cancel', belowGeneration: newest},
		]);
		expect(renders('settle')).toMatchObject([
			{generation: newest, stack: stackOf(2)},
		]);

		preview().reply({type: 'cancelled', jobId: renders('drag')[0].jobId});
		answer(renders('settle')[0]);
		expect(renders('drag')).toHaveLength(1);
	});

	it('sends a committed stack as settle without a drag render', () => {
		const {coordinator, renders} = opened();
		coordinator.setStack({stack: stackOf(1)});
		expect(renders().map((message) => message.level)).toEqual(['settle']);
	});
});

describe('adaptive drag cap', () => {
	it('steps down while drag renders are slow and back up while they are fast', () => {
		const {coordinator, renders, answer, posted} = opened();
		let angle = 0;
		const drag = (totalMs: number) => {
			angle++;
			coordinator.setStack({stack: stackOf(angle)}, {dragging: true});
			answer(renders('drag').at(-1)!, totalMs);
			return coordinator.getState().dragCap;
		};

		expect(drag(60)).toBe(524_288);
		expect(drag(51)).toBe(262_144);
		expect(drag(80)).toBe(131_072);
		expect(drag(80)).toBe(131_072);
		expect(drag(30)).toBe(131_072);
		expect(drag(19)).toBe(262_144);
		expect(drag(5)).toBe(524_288);
		expect(drag(5)).toBe(1_048_576);
		expect(drag(5)).toBe(1_048_576);
		expect(posted('setDragCap').map((message) => message.pixels)).toEqual([
			524_288, 262_144, 131_072, 262_144, 524_288, 1_048_576,
		]);
	});

	it('does not adapt on a drag render that was discarded', () => {
		const {coordinator, renders, answer} = opened();
		coordinator.setStack({stack: stackOf(1)}, {dragging: true});
		const stale = renders('drag')[0];
		coordinator.cancel();
		answer(stale, 500);
		expect(coordinator.getState().dragCap).toBe(1_048_576);
	});

	it('does not adapt on settle renders', () => {
		const {coordinator, renders, answer, posted} = opened();
		coordinator.setStack({stack: stackOf(1)});
		answer(renders()[0], 400);
		expect(posted('setDragCap')).toHaveLength(0);
	});
});

describe('cancellation', () => {
	it('keeps one settle render in flight: the next is sent after the stale one is cancelled', () => {
		const {coordinator, renders, posted, preview, answer, frames} = opened();
		coordinator.setStack({stack: stackOf(1)});
		coordinator.setStack({stack: stackOf(2)});
		coordinator.setStack({stack: stackOf(3)});
		const newest = coordinator.getState().generation;
		expect(renders()).toHaveLength(1);
		expect(posted('cancel').at(-1)).toEqual({
			type: 'cancel',
			belowGeneration: newest,
		});

		preview().reply({type: 'cancelled', jobId: renders()[0].jobId});
		expect(renders()).toHaveLength(2);
		expect(renders()[1]).toMatchObject({
			generation: newest,
			stack: stackOf(3),
		});
		answer(renders()[1]);
		expect(frames().map((frame) => frame.generation)).toEqual([newest]);
	});

	it('cancel() stops work in flight, drops a late result and keeps the displayed frame', () => {
		const {coordinator, renders, posted, answer, frames, events} = opened();
		coordinator.setStack({stack: stackOf(1)});
		const shown = answer(renders()[0]);
		coordinator.setStack({stack: stackOf(2)});
		coordinator.cancel();
		expect(posted('cancel').at(-1)).toEqual({
			type: 'cancel',
			belowGeneration: coordinator.getState().generation,
		});

		const late = answer(renders()[1]);
		expect(late.closed).toBe(true);
		expect(shown.closed).toBe(false);
		expect(frames()).toHaveLength(1);
		expect(events.at(-1)).toEqual({
			type: 'busy',
			level: 'settle',
			busy: false,
		});

		coordinator.endDrag();
		vi.advanceTimersByTime(1000);
		expect(renders()).toHaveLength(2);

		coordinator.setStack({stack: stackOf(3)});
		expect(renders()).toHaveLength(3);
	});

	it('reports busy and progress per level', () => {
		const {coordinator, renders, preview, answer, events} = opened();
		events.length = 0;
		coordinator.setStack({stack: stackOf(1)});
		preview().reply({
			type: 'progress',
			jobId: renders()[0].jobId,
			fraction: 0.5,
		});
		answer(renders()[0]);
		expect(events.map((event) => event.type)).toEqual([
			'busy',
			'progress',
			'busy',
			'frame',
		]);
		expect(events[0]).toEqual({type: 'busy', level: 'settle', busy: true});
		expect(events[1]).toEqual({
			type: 'progress',
			level: 'settle',
			fraction: 0.5,
		});
	});

	it('reports a render error and stays usable', () => {
		const {coordinator, renders, preview, errors, previews} = opened();
		coordinator.setStack({stack: stackOf(1)});
		preview().reply({
			type: 'error',
			jobId: renders()[0].jobId,
			code: 'out-of-memory',
			message: 'no memory',
		});
		expect(errors()).toEqual([
			{
				type: 'error',
				error: {code: 'out-of-memory', message: 'no memory'},
				failed: false,
			},
		]);
		coordinator.setStack({stack: stackOf(2)});
		expect(renders()).toHaveLength(2);
		expect(previews).toHaveLength(1);
	});
});

describe('timeout and crashes', () => {
	it('restarts the worker when a render is not answered within 30 s', () => {
		const {coordinator, renders, previews, posted, finishLoad, errors} =
			opened();
		coordinator.setStack({stack: stackOf(1)});
		vi.advanceTimersByTime(29_999);
		expect(previews).toHaveLength(1);
		vi.advanceTimersByTime(1);

		expect(previews).toHaveLength(2);
		expect(previews[0].terminated).toBe(true);
		expect(posted('loadSource')).toMatchObject([{sourceKey: 'photo'}]);
		expect(errors()).toMatchObject([
			{error: {code: 'worker-crashed'}, failed: false},
		]);
		expect(coordinator.getState().failed).toBe(false);

		finishLoad();
		expect(renders()).toMatchObject([
			{
				level: 'settle',
				stack: stackOf(1),
				generation: coordinator.getState().generation,
			},
		]);
	});

	it('does not time out a render that was answered', () => {
		const {coordinator, renders, answer, previews} = opened();
		coordinator.setStack({stack: stackOf(1)});
		answer(renders()[0]);
		vi.advanceTimersByTime(120_000);
		expect(previews).toHaveLength(1);
	});

	it('restarts after one crash and repeats the newest request', () => {
		const {coordinator, renders, previews, finishLoad, answer, frames, events} =
			opened();
		coordinator.setStack({stack: stackOf(1)});
		coordinator.setStack({stack: stackOf(2)});
		previews[0].fail('boom');

		expect(previews).toHaveLength(2);
		expect(previews[0].terminated).toBe(true);
		expect(events).toContainEqual({
			type: 'busy',
			level: 'settle',
			busy: false,
		});
		finishLoad();
		expect(renders()).toMatchObject([{level: 'settle', stack: stackOf(2)}]);
		answer(renders()[0]);
		expect(frames()).toHaveLength(1);

		previews[0].fail('late error from the terminated worker');
		expect(previews).toHaveLength(2);
		expect(previews[1].terminated).toBe(false);
		expect(coordinator.getState().failed).toBe(false);
	});

	it('closes a bitmap that a terminated worker delivers late', () => {
		const {coordinator, renders, previews, frames} = opened();
		coordinator.setStack({stack: stackOf(1)});
		const sent = renders()[0];
		previews[0].fail('boom');

		const late = bitmap();
		previews[0].reply({
			type: 'rendered',
			jobId: sent.jobId,
			generation: sent.generation,
			level: 'settle',
			width: 10,
			height: 10,
			bitmap: late,
			totalMs: 1,
			perInstanceMs: [1],
			warnings: [],
		});
		expect(late.closed).toBe(true);
		expect(frames()).toHaveLength(0);
	});

	it('closes the previous original when the source is reloaded after a crash', () => {
		const {posted, previews, preview, original, coordinator} = opened();
		previews[0].fail('boom');
		expect(original.closed).toBe(false);

		const reloaded = bitmap();
		const load = posted('loadSource').at(-1)!;
		preview().reply({
			type: 'sourceLoaded',
			requestId: load.requestId,
			sourceKey: load.sourceKey,
			settle: {width: 2364, height: 1773},
			drag: {width: 1182, height: 886},
			original: reloaded,
		});
		expect(original.closed).toBe(true);
		expect(reloaded.closed).toBe(false);
		expect(coordinator.getState().source?.original).toBe(reloaded);
	});

	it('enters the failed state on a second crash within 60 s, until retry()', () => {
		const {coordinator, renders, previews, finishLoad, errors} = opened();
		coordinator.setStack({stack: stackOf(1)});
		previews[0].fail('first');
		finishLoad();
		vi.advanceTimersByTime(59_000);
		previews[1].fail('second');

		expect(previews).toHaveLength(2);
		expect(previews[1].terminated).toBe(true);
		expect(coordinator.getState().failed).toBe(true);
		expect(errors().map((event) => event.failed)).toEqual([false, true]);

		coordinator.setStack({stack: stackOf(2)});
		vi.advanceTimersByTime(60_000);
		expect(previews).toHaveLength(2);

		coordinator.retry();
		expect(coordinator.getState().failed).toBe(false);
		expect(previews).toHaveLength(3);
		finishLoad();
		expect(renders()).toMatchObject([{level: 'settle', stack: stackOf(2)}]);
	});

	it('restarts again when the second crash comes after 60 s', () => {
		const {coordinator, previews, finishLoad, renders, answer} = opened();
		coordinator.setStack({stack: stackOf(1)});
		previews[0].fail('first');
		finishLoad();
		answer(renders()[0]);
		vi.advanceTimersByTime(60_001);
		previews[1].fail('second');
		expect(coordinator.getState().failed).toBe(false);
		expect(previews).toHaveLength(3);
	});
});

describe('full render', () => {
	const settled = () => {
		const context = opened();
		context.coordinator.setStack({stack: stackOf(1)});
		context.answer(context.renders()[0]);
		return context;
	};

	const tiles = () => [
		{x: 0, y: 0, bitmap: bitmap()},
		{x: 2048, y: 0, bitmap: bitmap()},
	];

	it('starts 500 ms after settle when the view is past 1.25 device pixels per proxy pixel', () => {
		const {coordinator, exports, events} = settled();
		// The proxy is 2364 px wide for 4000 source px: 0.74 gives 1.252 device px per proxy px.
		coordinator.setViewScale(0.73);
		vi.advanceTimersByTime(1000);
		expect(exports).toHaveLength(0);

		coordinator.setViewScale(0.74);
		expect(events.at(-1)).toEqual({type: 'busy', level: 'full', busy: true});
		vi.advanceTimersByTime(499);
		expect(exports).toHaveLength(0);
		vi.advanceTimersByTime(1);
		expect(exports).toHaveLength(1);
		expect(exports[0].posted).toMatchObject([
			{
				type: 'renderFull',
				generation: coordinator.getState().generation,
				blob: SOURCE.blob,
				sourceWidth: 4000,
				sourceHeight: 3000,
				stack: stackOf(1),
			},
		]);
	});

	it('gives up the 500 ms wait when the view goes back under the threshold', () => {
		const {coordinator, exports, events} = settled();
		coordinator.setViewScale(2);
		vi.advanceTimersByTime(300);
		coordinator.setViewScale(0.5);
		expect(events.at(-1)).toEqual({type: 'busy', level: 'full', busy: false});
		vi.advanceTimersByTime(1000);
		expect(exports).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('delivers the tiles, terminates the worker, and discards them on a stack change', () => {
		const {coordinator, exports, events} = settled();
		coordinator.setViewScale(2);
		vi.advanceTimersByTime(500);
		const [job] = exports[0].posted;
		const result = tiles();
		exports[0].reply({
			type: 'fullRendered',
			jobId: job.jobId,
			generation: coordinator.getState().generation,
			width: 4000,
			height: 3000,
			tiles: result,
		});
		expect(exports[0].terminated).toBe(true);
		expect(coordinator.getState().full).toMatchObject({
			width: 4000,
			height: 3000,
			tiles: result,
		});
		expect(events.at(-1)).toMatchObject({type: 'full', full: {width: 4000}});

		coordinator.setViewScale(3);
		vi.advanceTimersByTime(1000);
		expect(exports).toHaveLength(1);

		coordinator.setStack({stack: stackOf(2)}, {dragging: true});
		expect(coordinator.getState().full).toBeUndefined();
		expect(events).toContainEqual({type: 'full', full: undefined});
		expect(result.every((tile) => tile.bitmap.closed)).toBe(true);
	});

	it('terminates a running full render when the stack changes', () => {
		const {coordinator, exports, events} = settled();
		coordinator.setViewScale(2);
		vi.advanceTimersByTime(500);
		const [job] = exports[0].posted;
		coordinator.setStack({stack: stackOf(2)});
		expect(exports[0].terminated).toBe(true);
		expect(events).toContainEqual({type: 'busy', level: 'full', busy: false});

		const late = tiles();
		exports[0].reply({
			type: 'fullRendered',
			jobId: job.jobId,
			generation: 1,
			width: 4000,
			height: 3000,
			tiles: late,
		});
		expect(coordinator.getState().full).toBeUndefined();
		expect(late.every((tile) => tile.bitmap.closed)).toBe(true);
	});

	it('restarts the 500 ms wait when the stack changes before it ends', () => {
		const {coordinator, exports, renders, answer} = settled();
		coordinator.setViewScale(2);
		vi.advanceTimersByTime(400);
		coordinator.setStack({stack: stackOf(2)});
		vi.advanceTimersByTime(400);
		expect(exports).toHaveLength(0);
		answer(renders().at(-1)!);
		vi.advanceTimersByTime(499);
		expect(exports).toHaveLength(0);
		vi.advanceTimersByTime(1);
		expect(exports).toHaveLength(1);
	});

	it('is not requested when the settle proxy already has the source size', () => {
		const {coordinator, posted, preview, exports, renders, answer} = setup();
		coordinator.setSource({...SOURCE, width: 800, height: 600});
		preview().reply({
			type: 'sourceLoaded',
			requestId: posted('loadSource')[0].requestId,
			sourceKey: 'photo',
			settle: {width: 800, height: 600},
			drag: {width: 800, height: 600},
			original: bitmap(),
		});
		coordinator.setStack({stack: stackOf(1)});
		answer(renders()[0]);
		coordinator.setViewScale(4);
		vi.advanceTimersByTime(1000);
		expect(exports).toHaveLength(0);
	});

	it('reports a failed full render once and does not retry it for the same stack', () => {
		const {coordinator, exports, errors} = settled();
		coordinator.setViewScale(2);
		vi.advanceTimersByTime(500);
		exports[0].reply({
			type: 'error',
			jobId: exports[0].posted[0].jobId,
			code: 'out-of-memory',
			message: 'no memory',
		});
		expect(errors()).toMatchObject([
			{error: {code: 'out-of-memory'}, failed: false},
		]);
		expect(exports[0].terminated).toBe(true);
		coordinator.setViewScale(3);
		vi.advanceTimersByTime(1000);
		expect(exports).toHaveLength(1);
	});
});

describe('export', () => {
	it('runs in its own worker and resolves with the file', async () => {
		const {coordinator, exports} = opened();
		const progress: Array<[string, number]> = [];
		const task = coordinator.exportImage({
			stack: stackOf(1),
			scale: 0.5,
			format: 'jpeg',
			quality: 80,
			onProgress(stage, fraction) {
				progress.push([stage, fraction]);
			},
		});
		expect(exports[0].posted).toMatchObject([
			{
				type: 'export',
				blob: SOURCE.blob,
				sourceWidth: 4000,
				sourceHeight: 3000,
				scale: 0.5,
				format: 'jpeg',
				quality: 80,
				stack: stackOf(1),
			},
		]);
		const {jobId} = exports[0].posted[0];
		exports[0].reply({type: 'progress', jobId, stage: 'render', fraction: 0.5});
		const file = new Blob(['jpeg']);
		exports[0].reply({
			type: 'exported',
			jobId,
			file,
			width: 2000,
			height: 1500,
			mime: 'image/jpeg',
			totalMs: 12,
		});
		await expect(task.result).resolves.toEqual({
			status: 'done',
			file,
			width: 2000,
			height: 1500,
			mime: 'image/jpeg',
			totalMs: 12,
		});
		expect(progress).toEqual([['render', 0.5]]);
		expect(exports[0].terminated).toBe(true);
	});

	it('cancel terminates the worker and resolves as cancelled', async () => {
		const {coordinator, exports} = opened();
		const task = coordinator.exportImage({
			stack: stackOf(1),
			scale: 1,
			format: 'png',
		});
		task.cancel();
		expect(exports[0].terminated).toBe(true);
		await expect(task.result).resolves.toEqual({status: 'cancelled'});
	});

	it('resolves with the worker error, and with `internal` when the worker crashes', async () => {
		const {coordinator, exports, previews} = opened();
		const options = {stack: stackOf(1), scale: 1, format: 'png'} as const;
		const first = coordinator.exportImage(options);
		exports[0].reply({
			type: 'error',
			jobId: exports[0].posted[0].jobId,
			code: 'out-of-memory',
			message: 'no memory',
		});
		await expect(first.result).resolves.toEqual({
			status: 'error',
			error: {code: 'out-of-memory', message: 'no memory'},
		});

		const second = coordinator.exportImage(options);
		exports[1].fail('boom');
		await expect(second.result).resolves.toEqual({
			status: 'error',
			error: {code: 'internal', message: 'boom'},
		});
		expect(previews).toHaveLength(1);
		expect(coordinator.getState().failed).toBe(false);
	});

	it('fails without a source', async () => {
		const {coordinator, exports} = setup();
		const task = coordinator.exportImage({
			stack: stackOf(1),
			scale: 1,
			format: 'png',
		});
		await expect(task.result).resolves.toMatchObject({
			status: 'error',
			error: {code: 'internal'},
		});
		expect(exports).toHaveLength(0);
	});
});

describe('dispose', () => {
	it('closes a source that finishes loading after dispose and reports nothing', () => {
		const {coordinator, posted, preview, events} = setup();
		coordinator.setSource(SOURCE);
		const load = posted('loadSource')[0];
		coordinator.dispose();
		const count = events.length;

		const late = bitmap();
		preview().reply({
			type: 'sourceLoaded',
			requestId: load.requestId,
			sourceKey: load.sourceKey,
			settle: {width: 2364, height: 1773},
			drag: {width: 1182, height: 886},
			original: late,
		});
		expect(late.closed).toBe(true);
		expect(coordinator.getState().source).toBeUndefined();
		expect(events).toHaveLength(count);
	});

	it('terminates every worker, closes bitmaps and stops timers', async () => {
		const {coordinator, renders, answer, previews, exports, original} =
			opened();
		coordinator.setStack({stack: stackOf(1)});
		const shown = answer(renders()[0]);
		const task = coordinator.exportImage({
			stack: stackOf(1),
			scale: 1,
			format: 'png',
		});
		coordinator.setStack({stack: stackOf(2)}, {dragging: true});

		coordinator.dispose();
		expect(previews[0].terminated).toBe(true);
		expect(exports[0].terminated).toBe(true);
		expect(shown.closed).toBe(true);
		expect(original.closed).toBe(true);
		await expect(task.result).resolves.toEqual({status: 'cancelled'});
		expect(vi.getTimerCount()).toBe(0);

		coordinator.setStack({stack: stackOf(3)});
		coordinator.setSource({...SOURCE, key: 'other'});
		expect(previews).toHaveLength(1);
	});
});

describe('geometry transform', () => {
	const transformOf = (overrides: Partial<SourceTransform>) => ({
		...IDENTITY_TRANSFORM,
		...overrides,
	});
	const cropped = transformOf({
		crop: {x: 0, y: 0, width: 1200, height: 800},
	});
	const moved = transformOf({
		crop: {x: 500, y: 300, width: 1200, height: 800},
	});

	function loadedWith(transform: SourceTransform) {
		const context = setup();
		context.coordinator.setSource({...SOURCE, transform});
		const finishTransform = (
			width = 1200,
			height = 800,
			effective = {width, height},
		) => {
			const requests = [
				...context.posted('loadSource'),
				...context.posted('setTransform'),
			];
			const original = bitmap();
			context.preview().reply({
				type: 'sourceLoaded',
				requestId: Math.max(...requests.map((item) => item.requestId)),
				sourceKey: 'photo',
				settle: {width, height},
				drag: {width: width / 2, height: height / 2},
				effective,
				original,
			});
			return original;
		};

		const original = finishTransform();
		context.coordinator.setStack({stack: stackOf(1)});
		const shown = context.answer(context.renders()[0]);
		return {...context, finishTransform, original, shown};
	}

	it('sends the transform with the load and reports the effective size', () => {
		const {coordinator, posted} = loadedWith(cropped);
		expect(posted('loadSource')).toMatchObject([
			{sourceWidth: 4000, sourceHeight: 3000, transform: cropped},
		]);
		expect(coordinator.getState().source).toMatchObject({
			width: 1200,
			height: 800,
		});
	});

	it('invalidates everything rendered when only the crop changes', () => {
		const context = loadedWith(cropped);
		const {coordinator, posted, renders, events, original, shown} = context;
		coordinator.setStack({stack: stackOf(2)});
		const inFlight = renders().at(-1)!;
		const before = coordinator.getState().generation;

		coordinator.setSource({...SOURCE, transform: moved});

		expect(coordinator.getState().generation).toBeGreaterThan(before);
		expect(posted('setTransform')).toMatchObject([
			{sourceKey: 'photo', transform: moved},
		]);
		expect(posted('loadSource')).toHaveLength(1);
		expect(posted('cancel').at(-1)!.belowGeneration).toBe(
			coordinator.getState().generation,
		);
		expect(coordinator.getState().frame).toBeUndefined();
		expect(coordinator.getState().source).toBeUndefined();
		expect(events).toContainEqual({type: 'source', source: undefined});
		expect([original.closed, shown.closed]).toEqual([true, true]);

		// A result for the old crop that was already on its way is dropped.
		const stale = context.answer(inFlight);
		expect(stale.closed).toBe(true);
		expect(coordinator.getState().frame).toBeUndefined();

		const count = renders().length;
		const next = context.finishTransform();
		expect(coordinator.getState().source?.original).toBe(next);
		expect(renders()).toHaveLength(count + 1);
		expect(renders().at(-1)).toMatchObject({
			level: 'settle',
			generation: coordinator.getState().generation,
			stack: stackOf(2),
		});
	});

	it('ignores the same geometry, and no transform equals the identity', () => {
		const {coordinator, posted, frames} = loadedWith(IDENTITY_TRANSFORM);
		const before = coordinator.getState().generation;
		coordinator.setSource(SOURCE);
		coordinator.setSource({...SOURCE, transform: {...IDENTITY_TRANSFORM}});

		expect(posted('setTransform')).toEqual([]);
		expect(coordinator.getState().generation).toBe(before);
		expect(coordinator.getState().frame).toBe(frames()[0]);
	});

	it('sends the identity when a transform is removed', () => {
		const {coordinator, posted} = loadedWith(cropped);
		coordinator.setSource(SOURCE);
		expect(posted('setTransform')).toMatchObject([
			{transform: IDENTITY_TRANSFORM},
		]);
	});

	it('ignores the answer to a transform that was replaced', () => {
		const {coordinator, posted, preview} = loadedWith(cropped);
		coordinator.setSource({...SOURCE, transform: moved});
		coordinator.setSource({...SOURCE, transform: cropped});
		const late = bitmap();
		preview().reply({
			type: 'sourceLoaded',
			requestId: posted('setTransform')[0].requestId,
			sourceKey: 'photo',
			settle: {width: 1200, height: 800},
			drag: {width: 600, height: 400},
			effective: {width: 1200, height: 800},
			original: late,
		});

		expect(late.closed).toBe(true);
		expect(coordinator.getState().source).toBeUndefined();
	});

	it('judges the full-resolution zoom against the effective size', () => {
		const {coordinator, exports} = loadedWith(cropped);
		// The settle proxy is as large as the crop, though smaller than the source.
		coordinator.setViewScale(4);
		vi.advanceTimersByTime(1000);
		expect(exports).toHaveLength(0);
	});

	it('renders full and exports with the current transform', () => {
		const context = loadedWith(cropped);
		const {coordinator, exports} = context;
		coordinator.setSource({...SOURCE, transform: moved});
		// A proxy smaller than the crop, so zooming in asks for `full`.
		context.finishTransform(600, 400, {width: 1200, height: 800});
		context.answer(context.renders().at(-1)!);

		coordinator.exportImage({stack: stackOf(1), scale: 1, format: 'png'});
		expect(exports[0].posted[0]).toMatchObject({
			type: 'export',
			sourceWidth: 4000,
			sourceHeight: 3000,
			transform: moved,
		});

		coordinator.setViewScale(2);
		vi.advanceTimersByTime(500);
		expect(exports[1].posted[0]).toMatchObject({
			type: 'renderFull',
			transform: moved,
		});
	});

	it('loads the changed geometry into a restarted worker', () => {
		const {coordinator, preview, posted, previews} = loadedWith(cropped);
		coordinator.setSource({...SOURCE, transform: moved});
		preview().fail('boom');

		expect(previews).toHaveLength(2);
		expect(posted('loadSource')).toMatchObject([{transform: moved}]);
	});

	it('keeps a change made after repeated crashes for the retry', () => {
		const {coordinator, preview, posted, previews} = loadedWith(cropped);
		preview().fail('boom');
		preview().fail('boom');
		expect(coordinator.getState().failed).toBe(true);

		coordinator.setSource({...SOURCE, transform: moved});
		expect(previews).toHaveLength(2);
		coordinator.retry();
		expect(posted('loadSource')).toMatchObject([{transform: moved}]);
	});
});
