import {createHash} from 'node:crypto';
import {strFromU8, strToU8, unzipSync, zipSync, type Zippable} from 'fflate';
import {
	createDefaultExportSettings,
	createDefaultViewState,
} from '../../src/storage/helpers.ts';
import type {ProjectFileInput} from '../../src/storage/project-file.ts';
import type {
	HistoryEntryRecord,
	ProjectRecord,
	SourceRecord,
} from '../../src/storage/types.ts';
import type {SourceTransform} from '../../src/engine/transform.ts';
import type {EffectInstance, EffectStack} from '../../src/engine/types.ts';

// Deterministic bytes that compress badly, like an encoded image.
export function noise(length: number, seed = 1): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(length);
	let state = seed;
	for (let index = 0; index < length; index++) {
		state = (state * 48_271) % 2_147_483_647;
		bytes[index] = state % 256;
	}

	return bytes;
}

export function sourceRecord(
	bytes: Uint8Array<ArrayBuffer>,
	overrides: Partial<SourceRecord> = {},
): SourceRecord {
	return {
		sha256: createHash('sha256').update(bytes).digest('hex'),
		blob: new Blob([bytes], {type: 'image/png'}),
		mimeType: 'image/png',
		byteLength: bytes.length,
		width: 400,
		height: 300,
		createdAt: 1,
		...overrides,
	};
}

export function instance(
	overrides: Partial<EffectInstance> = {},
): EffectInstance {
	return {
		id: 'abcd1234',
		type: 'pixelSort',
		version: 1,
		enabled: true,
		params: {angle: 90, threshold: [0.25, 0.8]},
		mix: 1,
		blend: 'normal',
		...overrides,
	};
}

export function stackOf(...instances: EffectInstance[]): EffectStack {
	return {schemaVersion: 1, instances};
}

export const CROPPED: SourceTransform = {
	rotation: 90,
	flipX: true,
	flipY: false,
	crop: {x: 10, y: 20, width: 100, height: 200},
	resize: null,
};

// A project with two effects, a transform, side A, custom export settings and
// five commits after the initial entry (AC-F25.1).
export function projectInput(
	source: SourceRecord = sourceRecord(noise(200_000)),
): ProjectFileInput & {history: HistoryEntryRecord[]} {
	const stack = stackOf(
		instance(),
		instance({id: 'efgh5678', type: 'channelShift', mix: 0.5}),
	);
	const project: ProjectRecord = {
		id: '8b8f1c5e-2f0a-4c47-9d7e-0c0f4a7d2b11',
		name: 'Night Drive / take 2',
		sourceHash: source.sha256,
		referencedSourceHashes: [source.sha256],
		referencedMaskHashes: [],
		sourceWidth: source.width,
		sourceHeight: source.height,
		transform: CROPPED,
		effectiveWidth: 100,
		effectiveHeight: 200,
		stack,
		selectedInstanceId: 'efgh5678',
		stackA: stackOf(instance({id: 'side000a'})),
		selectedInstanceIdA: 'side000a',
		historyHeadSeq: 4,
		historyMinSeq: 0,
		historyMaxSeq: 5,
		viewState: {
			...createDefaultViewState(100, 200),
			fitMode: 'custom',
			zoom: 2,
			splitOrientation: 'horizontal',
		},
		exportSettings: {
			...createDefaultExportSettings(),
			format: 'jpeg',
			quality: 77,
			sizeMode: 'custom',
			customLongestSide: 150,
			maxFileSizeKb: 500,
		},
		createdAt: 1000,
		updatedAt: 2000,
		openedAt: 3000,
	};
	const history = Array.from({length: 6}, (_, seq): HistoryEntryRecord => ({
		projectId: project.id,
		seq,
		label: seq === 0 ? 'Initial' : `Commit ${seq}`,
		stack: seq === 0 ? stackOf() : stack,
		selectedInstanceId: null,
		transform: seq < 3 ? {...CROPPED, rotation: 0, crop: null} : CROPPED,
		createdAt: 1000 + seq,
	}));
	return {
		project,
		sources: [source],
		history,
		thumbnail: new Blob([noise(900, 7)], {type: 'image/webp'}),
		appVersion: '0.3.0',
		exportedAt: new Date(2026, 10, 26, 9, 5, 7),
	};
}

export async function entriesOf(
	blob: Blob,
): Promise<Record<string, Uint8Array>> {
	return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

export function jsonOf<T = Record<string, unknown>>(bytes: Uint8Array): T {
	return JSON.parse(strFromU8(bytes)) as T;
}

export function zipOf(entries: Zippable): Blob {
	return new Blob([zipSync(entries)]);
}

export type Edit = (entries: {
	manifest: Record<string, unknown>;
	project: Record<string, unknown>;
	history: Record<string, unknown>;
	files: Record<string, Uint8Array>;
}) => void;

// The archive with its JSON documents or entries changed.
export async function editedArchive(blob: Blob, edit: Edit): Promise<Blob> {
	const files = await entriesOf(blob);
	const documents = {
		manifest: jsonOf(files['manifest.json']),
		project: jsonOf(files['project.json']),
		history: files['history.json'] ? jsonOf(files['history.json']) : {},
		files,
	};
	edit(documents);
	for (const name of ['manifest', 'project', 'history'] as const) {
		const path = `${name}.json`;
		files[path] &&= strToU8(JSON.stringify(documents[name]));
	}

	return zipOf(files);
}
