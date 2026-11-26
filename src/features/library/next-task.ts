/**
 Resolves in a later task, so input and painting run before the work that
 follows.
 */
export async function nextTask(): Promise<void> {
	await new Promise<void>((resolve) => {
		globalThis.setTimeout(resolve, 0);
	});
}
