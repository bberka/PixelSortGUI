// The files a stack needs besides the project source: extra sources and painted
// masks (engine.md sections 8.3 and 16.6). Both are read from storage by hash
// and held by the preview worker for as long as the stack names them.

type RenderInput<File> = {
	status: 'reading' | 'decoding' | 'loaded' | 'missing' | 'broken';
	// A storage read is in flight. `missing` ones are read again.
	reading: boolean;
	// What storage returned, kept to load a restarted worker.
	file?: File;
	// Of the load sent to the current worker.
	requestId?: number;
};

// Resolves `undefined` when storage does not hold the hash.
export type RenderInputReader<File> = (
	sha256: string,
) => Promise<File | undefined>;

export type RenderInputsHost<File> = {
	// Posts the load to the preview worker and returns its request id, or `undefined` without a worker.
	load(file: File): number | undefined;
	unload(sha256: string): void;
	readFailed(error: unknown): void;
	// A pending file arrived or turned out to be unavailable.
	settled(): void;
};

export type RenderInputs<File> = {
	// Without one, everything stays missing.
	setReader(reader: RenderInputReader<File>): void;
	// Matches the held files to the hashes of the current stack.
	sync(wanted: ReadonlySet<string>, retryMissing: boolean): void;
	// For a new worker, which holds nothing yet.
	sendAll(): void;
	// The worker holds the file of this request.
	loaded(sha256: string, requestId: number): void;
	// The worker could not decode the file of this request. `false`: not one of these.
	broken(requestId: number): boolean;
	isPending(): boolean;
	isLoaded(sha256: string): boolean;
	// What a `full` render sends: read already, and not found undecodable.
	held(hashes: readonly string[]): File[];
	// What an export sends, reading what is not held. Rejects if a read fails.
	collect(hashes: readonly string[]): Promise<File[]>;
	clear(): void;
};

export function createRenderInputs<File>(
	host: RenderInputsHost<File>,
): RenderInputs<File> {
	const inputs = new Map<string, RenderInput<File>>();

	let reader: RenderInputReader<File> | undefined;

	const send = (input: RenderInput<File>) => {
		if (input.file === undefined) {
			return;
		}

		const requestId = host.load(input.file);
		if (requestId === undefined) {
			return;
		}

		input.status = 'decoding';
		input.requestId = requestId;
	};

	const read = async (sha256: string, input: RenderInput<File>) => {
		if (!reader || input.reading) {
			return;
		}

		input.reading = true;
		let file: File | undefined;
		let failure: {error: unknown} | undefined;
		try {
			file = await reader(sha256);
		} catch (error) {
			failure = {error};
		}

		input.reading = false;
		// Unloaded, or the coordinator is gone, while storage was answering.
		if (inputs.get(sha256) !== input) {
			return;
		}

		if (file !== undefined) {
			input.file = file;
			// Without a worker it is sent when the next one starts.
			input.status = 'decoding';
			send(input);
			return;
		}

		const wasPending = input.status === 'reading';
		input.status = 'missing';
		if (failure) {
			host.readFailed(failure.error);
		}

		if (wasPending) {
			host.settled();
		}
	};

	return {
		setReader(next) {
			reader = next;
		},
		sync(wanted, retryMissing) {
			for (const [sha256, input] of inputs) {
				if (wanted.has(sha256)) {
					continue;
				}

				inputs.delete(sha256);
				if (input.requestId !== undefined) {
					host.unload(sha256);
				}
			}

			for (const sha256 of wanted) {
				let input = inputs.get(sha256);
				if (!input) {
					input = {status: reader ? 'reading' : 'missing', reading: false};
					inputs.set(sha256, input);
				} else if (!(retryMissing && input.status === 'missing')) {
					continue;
				}

				void read(sha256, input);
			}
		},
		sendAll() {
			for (const input of inputs.values()) {
				send(input);
			}
		},
		loaded(sha256, requestId) {
			const input = inputs.get(sha256);
			if (input?.requestId !== requestId) {
				return;
			}

			input.status = 'loaded';
			host.settled();
		},
		broken(requestId) {
			const input = [...inputs.values()].find(
				(item) => item.requestId === requestId,
			);
			if (!input) {
				return false;
			}

			input.status = 'broken';
			return true;
		},
		isPending: () =>
			[...inputs.values()].some(
				({status}) => status === 'reading' || status === 'decoding',
			),
		isLoaded: (sha256) => inputs.get(sha256)?.status === 'loaded',
		held: (hashes) =>
			hashes.flatMap((sha256) => {
				const input = inputs.get(sha256);
				return input?.file !== undefined && input.status !== 'broken'
					? [input.file]
					: [];
			}),
		async collect(hashes) {
			const files = await Promise.all(
				hashes.map(
					async (sha256) =>
						inputs.get(sha256)?.file ?? (await reader?.(sha256)),
				),
			);
			return files.filter((file) => file !== undefined);
		},
		clear() {
			inputs.clear();
		},
	};
}
