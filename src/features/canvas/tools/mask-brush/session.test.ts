import {describe, expect, it, vi} from 'vite-plus/test';
import {
	createBrushSession,
	type BrushSessionOptions,
	type BrushTarget,
} from './session.ts';
import {IDENTITY_TRANSFORM} from '@/engine/transform.ts';
import type {NewMask} from '@/storage/types.ts';
import type {MaskWorkerRequest, MaskWorkerResponse} from '@/worker/protocol.ts';

const sample = {x: 160, y: 160, rx: 160, ry: 160};
const settings = {hardness: 50, strength: 100};

const record = (sha256: string): NewMask => ({
	sha256,
	width: 100,
	height: 80,
	blob: new Blob([sha256]),
});

const target = (asset: string, invert = false): BrushTarget => ({
	asset,
	invert,
	geometry: {
		sourceWidth: 100,
		sourceHeight: 80,
		transform: IDENTITY_TRANSFORM,
	},
	overlay: {width: 100, height: 80},
});

async function settle() {
	for (let turn = 0; turn < 20; turn++) {
		await Promise.resolve();
	}
}

function setup() {
	const state: {target: BrushTarget | null} = {target: target('')};
	const sent: MaskWorkerRequest[][] = [];
	const terminated: number[] = [];
	let respond: (response: MaskWorkerResponse) => void = () => {};
	let fail: () => void = () => {};
	const commits: Array<{
		asset: Promise<NewMask | null>;
		settle(committed: boolean): void;
	}> = [];
	const problems: string[] = [];
	const options: BrushSessionOptions = {
		createWorker(handlers) {
			const index = sent.length;
			sent.push([]);
			respond = handlers.message;
			fail = handlers.error;
			return {
				post(message) {
					sent[index].push(message);
				},
				terminate() {
					terminated.push(index);
				},
			};
		},
		getTarget: () => state.target,
		loadMask: async (sha256) =>
			sha256 === 'lost' ? undefined : record(sha256),
		async commit(_mode, asset) {
			return new Promise((resolve) => {
				commits.push({asset, settle: resolve});
			});
		},
		onOpened: vi.fn(),
		onPatch: vi.fn(),
		onCommitted: vi.fn(),
		onProblem(problem) {
			problems.push(problem);
		},
	};
	const session = createBrushSession(options);
	const types = (worker = sent.length - 1) =>
		sent[worker].map((message) => message.type);
	// Answers the newest `strokeEnd` with a changed mask.
	const edited = (sha256: string) => {
		const end = sent.at(-1)!.findLast((m) => m.type === 'strokeEnd')!;
		respond({
			type: 'maskEdited',
			requestId: end.requestId,
			changed: true,
			asset: record(sha256),
		});
	};

	return {
		session,
		state,
		sent,
		terminated,
		commits,
		problems,
		types,
		edited,
		respond(response: MaskWorkerResponse) {
			respond(response);
		},
		fail() {
			fail();
		},
	};
}

describe('brush session', () => {
	it('does not reopen while its own strokes are being written', async () => {
		const context = setup();
		const {session, state, types, commits, edited} = context;
		expect(session.begin('paint', settings, sample)).toBe(true);
		session.end();
		await settle();
		edited('one');
		// The store still holds the old mask, and a second stroke starts.
		session.sync();
		session.begin('paint', settings, sample);
		session.end();
		await settle();
		edited('two');
		await expect(commits[0].asset).resolves.toMatchObject({sha256: 'one'});
		await expect(commits[1].asset).resolves.toMatchObject({sha256: 'two'});

		state.target = target('one');
		commits[0].settle(true);
		await settle();
		state.target = target('two');
		commits[1].settle(true);
		await settle();
		expect(types().filter((type) => type === 'maskOpen')).toHaveLength(1);
	});

	it('opens the stored mask again when a stroke was not written', async () => {
		const {session, types, commits, edited} = setup();
		session.begin('paint', settings, sample);
		session.end();
		await settle();
		edited('one');
		// Nothing reached the store, which still holds the empty mask.
		commits[0].settle(false);
		await settle();
		expect(types().filter((type) => type === 'maskOpen')).toHaveLength(2);
	});

	it('cancels the stroke when the mask changes under it', async () => {
		const {session, state, types} = setup();
		session.begin('paint', settings, sample);
		await settle();
		state.target = target('filled');
		session.sync();
		await settle();
		expect(session.stroking).toBe(false);
		expect(types()).toEqual([
			'maskOpen',
			'strokeStart',
			'strokeCancel',
			'maskOpen',
		]);
	});

	it('cancels the stroke when suspended and keeps the worker', async () => {
		const {session, state, types, terminated} = setup();
		session.begin('paint', settings, sample);
		state.target = null;
		session.sync();
		await settle();
		expect(types().at(-1)).toBe('strokeCancel');
		expect(session.begin('paint', settings, sample)).toBe(false);
		expect(terminated).toEqual([]);
	});

	it('paints nothing on a missing mask, even on the mask held before', async () => {
		const context = setup();
		const {session, state, sent, commits, problems, terminated} = context;
		session.sync();
		await settle();
		state.target = target('lost');
		// The stroke starts before the read has failed.
		session.begin('paint', settings, sample);
		session.end();
		await settle();
		expect(problems).toEqual(['missing']);
		expect(sent[0].map((message) => message.type)).toEqual(['maskOpen']);
		expect(terminated).toEqual([0]);
		await expect(commits[0].asset).resolves.toBeNull();
		commits[0].settle(false);
		await settle();
		expect(session.begin('paint', settings, sample)).toBe(false);

		// Fill stores a mask again.
		state.target = target('filled');
		session.sync();
		await settle();
		expect(sent[1].map((message) => message.type)).toEqual(['maskOpen']);
	});

	it('stops its worker only after the last stroke is written', async () => {
		const {session, commits, terminated, edited} = setup();
		session.begin('paint', settings, sample);
		session.end();
		session.dispose();
		await settle();
		expect(terminated).toEqual([]);
		edited('one');
		await expect(commits[0].asset).resolves.toMatchObject({sha256: 'one'});
		commits[0].settle(true);
		await settle();
		expect(terminated).toEqual([0]);
	});

	it('gives up a stroke when the worker dies, so no edit waits for it', async () => {
		const {session, commits, problems, fail} = setup();
		session.begin('paint', settings, sample);
		session.end();
		await settle();
		fail();
		await expect(commits[0].asset).resolves.toBeNull();
		expect(problems).toEqual(['failed']);
	});
});
