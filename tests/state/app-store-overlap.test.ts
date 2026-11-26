import {describe, expect, it} from 'vite-plus/test';
import {createTestStore, makeTestBlob} from './fixtures.ts';

// An edit is written to storage before the state changes, so a second edit can
// arrive while the first is still being written. None of these await in between.
async function setup() {
	const context = createTestStore();
	const {project} = await context.store.getState().importImage({
		name: 'overlap.png',
		blob: makeTestBlob('overlap'),
		width: 400,
		height: 300,
	});
	return {...context, project};
}

type Context = Awaited<ReturnType<typeof setup>>;

const active = ({store}: Context) => store.getState().activeProject!;

const labels = async ({repository, project}: Context) =>
	(await repository.getHistory(project.id)).map((entry) => entry.label);

describe('app store — overlapping edits', () => {
	it('keeps both values when a second parameter is committed during the first write', async () => {
		const context = await setup();
		const {store, repository, project} = context;
		const {id} = await store.getState().addEffect('channelShift');

		await Promise.all([
			store.getState().commitParam(id, 'redX', 20),
			store.getState().commitParam(id, 'blueX', -20),
		]);

		const expected = {redX: 20, blueX: -20};
		expect(active(context).stack.instances[0].params).toMatchObject(expected);
		const stored = await repository.getProject(project.id);
		expect(stored!.stack.instances[0].params).toMatchObject(expected);
		expect(await labels(context)).toHaveLength(4);
		expect(store.getState().history.map((entry) => entry.seq)).toEqual([
			0, 1, 2, 3,
		]);
	});

	it('keeps both effects when two are added at once', async () => {
		const context = await setup();
		const {store} = context;

		await Promise.all([
			store.getState().addEffect('channelShift'),
			store.getState().addEffect('pixelSort'),
		]);

		expect(active(context).stack.instances.map((item) => item.type)).toEqual([
			'channelShift',
			'pixelSort',
		]);
	});

	it('applies a mix change and an undo in the order they were made', async () => {
		const context = await setup();
		const {store} = context;
		const {id} = await store.getState().addEffect('channelShift');

		await Promise.all([
			store.getState().commitParam(id, 'redX', 20),
			store.getState().commitMix(id, 0.5),
			store.getState().undo(),
		]);

		const instance = active(context).stack.instances[0];
		expect(instance.params.redX).toBe(20);
		expect(instance.mix).toBe(1);
	});

	it('finishes an edit being written before it closes the project', async () => {
		const context = await setup();
		const {store} = context;
		const {id} = await store.getState().addEffect('channelShift');
		const {repository} = context;
		const write = repository.commitStack.bind(repository);
		const gate = Promise.withResolvers<void>();
		repository.commitStack = async (input) => {
			await gate.promise;
			return write(input);
		};

		const committed = store.getState().commitParam(id, 'redX', 20);
		const closed = store.getState().closeProject();
		// The memory repository settles in microtasks, so one turn of the event
		// loop lets a close that does not wait run to its end.
		await new Promise((resolve) => {
			setImmediate(resolve);
		});
		gate.resolve();
		await Promise.all([committed, closed]);

		expect(store.getState().activeProject).toBeNull();
		expect(await labels(context)).toHaveLength(3);
	});

	it('runs the next edit after one fails', async () => {
		const context = await setup();
		const {store} = context;

		const [failed] = await Promise.allSettled([
			store.getState().duplicateEffect('missing'),
			store.getState().addEffect('channelShift'),
		]);

		expect(failed.status).toBe('rejected');
		expect(active(context).stack.instances).toHaveLength(1);
	});
});
