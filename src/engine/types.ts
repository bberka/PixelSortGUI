export type RgbaImage = {
	// 1..16384
	readonly width: number;
	// 1..16384
	readonly height: number;
	// Length `width * height * 4`: row-major RGBA, straight alpha, sRGB. Pixel `(x, y)` starts at byte `4 * (y * width + x)`.
	readonly data: Uint8ClampedArray;
};

export type ParamValue = number | boolean | string | readonly [number, number];

export type BlendMode = 'normal' | 'lighten' | 'darken' | 'difference';

export type EffectInstance = {
	// 8 lowercase base-36 characters, unique within its stack.
	id: string;
	type: string;
	// Version of the effect type's parameter schema that `params` follows.
	version: number;
	enabled: boolean;
	params: Record<string, ParamValue>;
	// 0..1 in steps of 0.01.
	mix: number;
	blend: BlendMode;
};

export type EffectStack = {
	schemaVersion: 1;
	// Applied in array order, index 0 first.
	instances: EffectInstance[];
};

export const STACK_SCHEMA_VERSION = 1;
export const MAX_STACK_INSTANCES = 32;

export type RenderLevel = 'drag' | 'settle' | 'full';

export type DebugView = 'none' | 'selection';

// An image other than the project's source that an `image` parameter names
// (engine.md section 16.5). `width` and `height` describe the pixels handed to
// the engine, which may be a proxy.
export type ExtraSource = RgbaImage & {
	// Size of the stored image in px.
	readonly sourceWidth: number;
	readonly sourceHeight: number;
};

export type RenderContext = {
	readonly level: RenderLevel;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	// Render width divided by source width, in (0, 1].
	readonly scale: number;
	// The instance's `seed` parameter if it has one, else 0.
	readonly seed: number;
	// Source pixels to render pixels: `roundHalfAway(sourcePx * scale)`.
	px(sourcePx: number): number;
	// Like `px`, but a positive source length never becomes 0.
	pxLength(sourcePx: number): number;
	// Render coordinate to source coordinate: `Math.floor((renderCoord + 0.5) / scale)`.
	toSource(renderCoord: number): number;
	// Throws (or rejects) when the render is stale. Await the result when it is a promise.
	checkpoint(): void | Promise<void>;
	// Fraction 0..1 of this instance's work that is done.
	progress(fraction: number): void;
	// A buffer reused between calls with the same slot. Its contents are undefined.
	scratch(slot: number, byteLength: number): Uint8Array;
	// The extra source with this SHA-256, or undefined when it was not supplied. Read only.
	getSource(sha256: string): ExtraSource | undefined;
	readonly debugView: DebugView;
};

export type VisibleWhen = {
	param: string;
	equals?: ReadonlyArray<string | boolean | number>;
	notEquals?: ReadonlyArray<string | boolean | number>;
};

export type ParamSpecBase = {
	label: string;
	group: string;
	help?: string;
	visibleWhen?: VisibleWhen;
};

export type ParamSpec = ParamSpecBase &
	(
		| {
				kind: 'number';
				min: number;
				max: number;
				step: number;
				default: number;
				unit?: 'ratio' | 'percent';
		  }
		| {kind: 'integer'; min: number; max: number; default: number; unit?: 'px'}
		| {kind: 'boolean'; default: boolean}
		| {
				kind: 'enum';
				options: ReadonlyArray<{value: string; label: string}>;
				default: string;
		  }
		| {
				kind: 'range';
				min: number;
				max: number;
				step: number;
				default: readonly [number, number];
		  }
		| {kind: 'angle'; default: number; snaps: readonly number[]}
		| {kind: 'seed'}
		// SHA-256 of an extra source as 64 lowercase hex digits, or '' for none.
		| {kind: 'image'; default: ''}
	);

export type ParamSpecs<
	P extends Record<string, ParamValue> = Record<string, ParamValue>,
> = {readonly [K in keyof P]: ParamSpec};

export type EffectCategory = 'sort' | 'glitch' | 'color';

export type EffectDefinition<
	P extends Record<string, ParamValue> = Record<string, ParamValue>,
> = {
	// CamelCase, unique, never renamed once released.
	readonly type: string;
	// Integer >= 1.
	readonly version: number;
	readonly label: string;
	readonly description: string;
	readonly category: EffectCategory;
	readonly params: ParamSpecs<P>;
	// `migrations[n]` converts parameters of version `n` to version `n + 1`.
	readonly migrations?: Readonly<
		Record<
			number,
			(old: Record<string, ParamValue>) => Record<string, ParamValue>
		>
	>;
	readonly debugViews?: ReadonlyArray<'selection'>;
	// Left out of the add-effect list and the guide. Stored instances still render.
	readonly unlisted?: boolean;
	// Reads `input`, writes every byte of `output`, and never writes `input`.
	render(
		input: RgbaImage,
		output: RgbaImage,
		params: P,
		ctx: RenderContext,
	): void | Promise<void>;
};

export type EffectRegistry = {
	get(type: string): EffectDefinition | undefined;
	// Registration order.
	list(): readonly EffectDefinition[];
};

// What `checkpoint` throws when a render is stale. `renderStack` lets it propagate.
export class Cancelled extends Error {
	override name = 'Cancelled';

	constructor() {
		super('Render cancelled');
	}
}

export function createImage(width: number, height: number): RgbaImage {
	return {width, height, data: new Uint8ClampedArray(width * height * 4)};
}

export function copyImage(image: RgbaImage): RgbaImage {
	return {
		width: image.width,
		height: image.height,
		data: new Uint8ClampedArray(image.data),
	};
}

function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function isOmitted(value: unknown): boolean {
	return (
		value === undefined ||
		typeof value === 'function' ||
		typeof value === 'symbol'
	);
}

/**
 JSON with object keys sorted by UTF-16 code unit at every level, no
 whitespace, and numbers in shortest round-trip form. Array order is kept.
 Values JSON cannot hold follow `JSON.stringify`: omitted in objects, `null`
 in arrays.
 */
export function canonicalJson(value: unknown): string {
	if (isOmitted(value)) {
		return 'null';
	}

	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
	}

	const record = value as Record<string, unknown>;
	const members = Object.keys(record)
		.filter((key) => !isOmitted(record[key]))
		.toSorted(compareCodeUnits)
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
	return `{${members.join(',')}}`;
}

export function canonicalStackJson(stack: EffectStack): string {
	return canonicalJson(stack);
}
