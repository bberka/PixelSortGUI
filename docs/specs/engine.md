Written by Claude Opus 5.5 (Antigravity, thought level high), spec subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.
Updated for spike results by Gemini 4 Neon (Antigravity, thought level low), documentation subagent.
Updated after the engine foundation review by Gemini 4 Neon (Antigravity, thought level low), documentation subagent.
Updated after the engine tasks by Gemini 4 Neon (Antigravity, thought level low), documentation subagent.
Updated with post-v0.1.0 specs (F20 geometry, F21 formats, F22 effect catalogue) by Gemini 4 Neon (Antigravity, thought level medium), specification subagent.
Updated with multi-image blending (`imageBlend`, F26) spec by Gemini 4 Neon (Antigravity, thought level medium), specification subagent.

# Drift engine spec

Status: settled for first release, 2026-11-24. Terms are defined in [product.md section 2](product.md#2-terms). Storage of everything described here is in [persistence.md](persistence.md).

## 1. Scope and rules

The engine turns a source image and an effect stack into an output image. It is plain TypeScript with no DOM, React or browser storage dependencies, so it runs unchanged in a Web Worker, in Node (tests, benchmarks) and later in a native shell.

Rules every part of the engine follows:

1. **Own implementation.** Every algorithm here is described in our own words and formulas. Do not copy or translate code from pxlsort (no licence), pixel-sorter or rkargon/pixelsorter (GPL-3.0), or any of the unlicensed projects in the research. Implementers work from this file, not from those repositories.
2. **Pure effects.** An effect's output depends only on its input pixels, its parameters and the render context. No `Math.random`, `Date`, `performance.now` (except for the time-slice check in section 8.4, and `pipeline.ts` reading `performance.now()` solely to populate `perInstanceMs` timing stats without affecting pixels, cache keys, warnings or progress), global state or I/O.
3. **Exact arithmetic.** Wherever output depends on a number, the formula is given in integers or in IEEE-754 double operations that are exactly specified (`+ - * /`, comparisons, `Math.floor`). Functions that ECMAScript leaves implementation-approximated (`Math.cos`, `Math.sin`, `Math.pow`, `Math.cbrt`, `Math.exp`) are not used at render time; where trigonometry is needed it comes from a checked-in table (section 5.2).
4. **Same size out as in.** First-release effects do not change image dimensions.
5. **Resolution independence.** Spatial parameters are given in source-image pixels and scaled by the render context; random choices are keyed to source-image coordinates, so the `settle` preview and the full-resolution export show the same structure (section 10.3).

Helper definitions used in formulas:

- `floorDiv(a, b)` for integers `a` and `b > 0` is `Math.floor(a / b)`. All uses below keep `|a| < 2^53`, so the double division is exact enough that the floor is correct.
- `roundHalfAway(x)` is `Math.sign(x) * Math.floor(Math.abs(x) + 0.5)`.
- `clamp(v, lo, hi)` is `Math.min(Math.max(v, lo), hi)`.
- `wrap(v, n)` is `((v % n) + n) % n`.
- Channel values `R, G, B, A` are integers 0 to 255.

## 2. Data model

### 2.1 Pixel buffers

```ts
type RgbaImage = {
	readonly width: number; // 1..16384
	readonly height: number; // 1..16384
	readonly data: Uint8ClampedArray; // length width*height*4, row-major, RGBA, straight (not premultiplied) alpha, sRGB
};
```

Pixel `(x, y)` starts at byte `4 * (y * width + x)`. `x` grows to the right, `y` grows downward.

### 2.2 Effect stack

```ts
type ParamValue = number | boolean | string | readonly [number, number];

type BlendMode = 'normal' | 'lighten' | 'darken' | 'difference';

type EffectInstance = {
	id: string; // 8 lowercase base-36 characters, unique within its stack
	type: string; // effect type id, for example 'pixelSort'
	version: number; // version of the effect type's parameter schema these params follow
	enabled: boolean;
	params: Record<string, ParamValue>;
	mix: number; // 0..1, step 0.01, default 1
	blend: BlendMode; // default 'normal'
};

type EffectStack = {
	schemaVersion: 1;
	instances: EffectInstance[]; // applied in array order, index 0 first; at most 32
};
```

The stack is plain JSON. It is stored as-is in IndexedDB, in history entries and in presets. `schemaVersion` changes only when the shape of `EffectStack` or `EffectInstance` changes; per-effect parameter changes use the instance's `version` (section 4.4).

Canonical form: `canonicalStackJson(stack)` serialises with object keys sorted by UTF-16 code unit (not locale) at every level, numbers formatted as `JSON.stringify` writes them (shortest round-trip form), and array order preserved. It is used as a cache key (section 8.5) and for equality in tests.

### 2.3 Render context

```ts
type RenderLevel = 'drag' | 'settle' | 'full';

type RenderContext = {
	readonly level: RenderLevel;
	readonly sourceWidth: number; // source image size in px
	readonly sourceHeight: number;
	readonly scale: number; // render width / source width, in (0, 1]
	readonly seed: number; // the instance's seed parameter if it has one, else 0
	px(sourcePx: number): number; // roundHalfAway(sourcePx * scale)
	pxLength(sourcePx: number): number; // sourcePx <= 0 ? 0 : Math.max(1, px(sourcePx))
	toSource(renderCoord: number): number; // Math.floor((renderCoord + 0.5) / scale)
	checkpoint(): void | Promise<void>; // see section 8.4; throws Cancelled when stale
	progress(fraction: number): void; // 0..1 within this instance
	scratch(slot: number, byteLength: number): Uint8Array; // reusable buffer, contents undefined
	readonly debugView: 'none' | 'selection';
};
```

## 3. Parameter schema

Each effect type declares its parameters. The UI is generated from this schema, so an effect needs no UI code. Validation and migration also read it.

```ts
type VisibleWhen = {param: string; equals?: readonly (string | boolean | number)[]; notEquals?: readonly (string | boolean | number)[]};

type ParamSpecBase = {label: string; group: string; help?: string; visibleWhen?: VisibleWhen};

type ParamSpec = ParamSpecBase &
	(
		| {kind: 'number'; min: number; max: number; step: number; default: number; unit?: 'ratio' | 'percent'}
		| {kind: 'integer'; min: number; max: number; default: number; unit?: 'px'}
		| {kind: 'boolean'; default: boolean}
		| {kind: 'enum'; options: readonly {value: string; label: string}[]; default: string}
		| {kind: 'range'; min: number; max: number; step: number; default: readonly [number, number]}
		| {kind: 'angle'; default: number; snaps: readonly number[]} // degrees, stored in [0, 360), step 0.1
		| {kind: 'seed'} // uint32; engine default is 0; whoever creates an instance supplies a random seed (e.g. from crypto.getRandomValues)
	);
```

Rules:

- `unit: 'px'` means the value is in source-image pixels and the effect must convert it with `ctx.px` or `ctx.pxLength`.
- Numbers are stored rounded to their `step` (angles to 0.1). Integers are stored as integers.
- `validateParams(spec, params)` returns a complete, valid parameter object: missing keys get the default, values of the wrong type get the default (`NaN` counts as a wrong type; `±Infinity` clamps to `[min, max]` for `number` and `integer` and gets the default for `angle`, as does a finite angle large enough to overflow when multiplied by 10; a `range` that is not a two-number array gets the default; a `seed` of the wrong type becomes `0`), numbers are clamped to `[min, max]` and rounded to `step` (steps counted from `0`, not `min`: clamp, round half away from zero — dividing by `k` when `step` is `1/k` so decimals store cleanly — clamp again, and normalise `-0` to `0`), enums not in `options` get the default, ranges are clamped and swapped if `lo > hi`, angles are normalised with `wrap(roundHalfAway(a * 10), 3600) / 10`, seeds are converted with `>>> 0`. Unknown keys are dropped. `defaultParams` returns `0` for `seed`; whoever creates an effect instance supplies a random seed. The pipeline always validates before calling `render`.
- `visibleWhen` only hides controls; hidden parameters keep their values and still reach `render`.
- `group` names a section in the parameter panel. Groups appear in first-use order.

## 4. Effect interface, pipeline and registration

### 4.1 Effect definition

```ts
type EffectCategory = 'sort' | 'glitch' | 'color';

type EffectDefinition<P extends Record<string, ParamValue> = Record<string, ParamValue>> = {
	readonly type: string; // camelCase, unique, never renamed once released
	readonly version: number; // integer >= 1
	readonly label: string; // shown in the UI, sentence case
	readonly description: string; // one line, shown in the add-effect list
	readonly category: EffectCategory;
	readonly params: {readonly [K in keyof P]: ParamSpec};
	readonly migrations?: Readonly<Record<number, (old: Record<string, ParamValue>) => Record<string, ParamValue>>>;
	readonly debugViews?: readonly 'selection'[];
	render(input: RgbaImage, output: RgbaImage, params: P, ctx: RenderContext): void | Promise<void>;
};
```

Contract for `render`:

- `input` and `output` have the same width and height and do not share memory. `render` reads `input` and writes every byte of `output`. The pipeline does not copy `input` defensively; an effect must never write to `input`, and every effect's tests must prove it.
- It calls `ctx.checkpoint()` between lines or rows, at least once per 16,384 pixels processed, and awaits it when it returns a promise.
- It may allocate at most `2 * width * height` bytes of scratch memory per render, through `ctx.scratch`. Per-line buffers up to 16,384 entries are free.
- When `ctx.debugView` is `'selection'` and the effect lists `'selection'` in `debugViews`, it writes its selection view (defined per effect) instead of its result.

### 4.2 Registry

```ts
type EffectRegistry = {
	get(type: string): EffectDefinition | undefined;
	list(): readonly EffectDefinition[]; // registration order, used for the add-effect list
};
function createRegistry(definitions: readonly EffectDefinition[]): EffectRegistry; // throws on duplicate type
```

The app builds one registry from the array exported by `src/engine/effects/index.ts`. There is no runtime plug-in loading.

### 4.3 Pipeline

```ts
function renderStack(source: RgbaImage, stack: EffectStack, registry: EffectRegistry, options: PipelineOptions): Promise<PipelineResult>;

type PipelineOptions = {
	level: RenderLevel;
	sourceWidth: number;
	sourceHeight: number; // source dimensions; `source` here is already at render size
	debug?: {instanceId: string; view: 'selection'};
	cache?: StageCache; // section 8.5
	sourceKey?: string; // identifies the source image in stage cache keys; defaults to ''
	checkpoint: () => void | Promise<void>;
	onProgress?: (fraction: number) => void;
};

type PipelineResult = {
	image: RgbaImage;
	perInstanceMs: number[];
	warnings: {instanceId: string; code: 'unknown-type' | 'newer-version' | 'params-fixed'}[];
};
```

Algorithm:

1. `current = source`. Allocate two working buffers `a` and `b` of the render size (reused between renders while the size is unchanged).
2. For each instance `i` in order:
   1. Skip it if `enabled` is false.
   2. Look up its definition. If the type is unknown, or the instance `version` is greater than the definition's, skip it and add a warning.
   3. Migrate parameters if the instance `version` is lower (section 4.4), then `validateParams`. Emit a `params-fixed` warning when validation changed, added (including filling missing keys from defaults), or dropped a value after migration; migration alone does not emit it.
   4. Build the context (`scale = renderWidth / sourceWidth`, `seed = params.seed ?? 0`, `debugView` from `options.debug` when it names this instance and the effect lists that view in `debugViews`, else `'none'`).
   5. `output` = whichever of `a`, `b` is not `current`. Call `render(current, output, params, ctx)`. The pipeline does not copy `current` defensively before calling `render`.
   6. If `debugView` is `'none'` and (`mix < 1` or `blend !== 'normal'`), composite in place: `output = composite(current, output, mix, blend)` (section 4.5).
   7. `current = output`.
   8. If this instance is the debug instance, stop here: later instances are not applied, so the selection view shows exactly this instance's selection. If the debug instance's effect does not list `'selection'` in `debugViews`, it renders normally with mix and blend and the pipeline still stops there; if the debug instance is disabled or unknown, the whole stack renders normally.
3. Return a fresh copy of `current` (never aliasing `source`, a stage cache entry, or a working buffer).

`perInstanceMs` has one entry per stack instance at the same index, with `0` for instances that did not run. Progress is reported as `(completedInstances + instanceFraction) / enabledInstanceCount` (counting skipped unknown or newer-version instances as completed); fractions lower than the last reported are dropped, and a render that ends early (cache hit or debug stop) reports `1` at the end.

The pipeline enforces neither the 32-instance limit nor `schemaVersion` (nor instance `id` format or the `2 * width * height` scratch limit); the 32-instance limit and `schemaVersion` are enforced by storage and the UI.

### 4.4 Versions and migration

- An effect type's `version` starts at 1. Bump it when a parameter is added, removed, renamed, its range or meaning changes, or when the output for the same parameters changes.
- `migrations[n]` converts parameters of version `n` to version `n + 1`. The pipeline applies them in sequence from the instance's `version` to the definition's `version`. A version step with no entry in `migrations` is treated as identity. Each migration receives a shallow copy of the parameter object, so mutating its argument cannot change stored data. Migrations are pure and idempotent with respect to their input.
- Migrated instances are written back with the new `version` on the next save (persistence.md section 6). The stored history keeps old versions; they are migrated when loaded.
- Changing output without changing parameters is allowed with a version bump and a matching golden-image update in the same pull request; old projects then render with the new behaviour. Keeping old behaviours runnable is not required in the first release.

### 4.5 Mix and blend

For every pixel, with `i` the instance input channel, `f` the effect output channel and `m = Math.round(mix * 100)`:

| `blend` | Blended value `b` for R, G, B |
|---|---|
| `normal` | `f` |
| `lighten` | `max(i, f)` |
| `darken` | `min(i, f)` |
| `difference` | `abs(i - f)` |

- R, G, B: `out = floorDiv(2 * (i * (100 - m) + b * m) + 100, 200)`.
- A: `out = floorDiv(2 * (iA * (100 - m) + fA * m) + 100, 200)` (alpha always mixes as `normal`).

Mix and blend are applied against the instance's own input at the same render size, so they work at every level (this avoids the scale mismatch the research found in pixel-sorter's blending). Out-of-range `mix` is clamped to `[0, 1]` (`NaN` is treated as `1`) and an unknown `blend` mode renders as `'normal'`, without changing stored data.

### 4.6 Adding a new effect

The owner will add his own effects. The full procedure, which touches no UI or storage code:

1. Create `src/engine/effects/<kebab-name>/index.ts` (or `<kebab-name>.ts` for a single file) exporting an `EffectDefinition` with a new `type`, `version: 1`, label, description, category, parameter schema and `render`.
2. Add it to the array in `src/engine/effects/index.ts`. Its position sets its place in the add-effect list.
3. Add golden cases in `tests/golden/<type>/` (section 14.2) and run `vp run golden:update` to write their expected images; inspect the images, then commit them.
4. Add at least the generic property tests by listing the type in `tests/engine/effect-contract.test.ts` (output size, determinism, input not modified, mix 0 is identity).
5. Optionally add a built-in preset in `src/presets/builtin.ts`.

Nothing else changes: the parameter panel, persistence, history and presets all handle the new type through the schema.

### 4.7 On-canvas tool slot (reserved for later)

Designed now so future interactive canvas tools (such as painting a mask or drawing a sort path) can be added without changing `EffectDefinition`, `ParamSpec`, or `renderStack`. Not built in the first release.

- The engine remains DOM-free and knows nothing about pointer events or UI tools.
- A separate UI-side tool registry (later, under `src/features/canvas/tools/`) can register an optional tool binding keyed by `(effectType, version)` (or for a universal feature such as per-instance masks).
- When the selected instance matches a registered tool binding, the canvas stage mounts the tool's overlay ([DESIGN.md section 7.1](../../DESIGN.md#71-on-canvas-tool-slot-reserved-for-later)), which translates canvas pointer gestures into normal parameter updates or mask-asset writes and commits through the existing stack/history store.
- Effects that do not register a canvas tool require zero UI code and remain purely schema-driven.

## 5. Pixel sort effect (`pixelSort`)

`type: 'pixelSort'`, `version: 1`, `category: 'sort'`, label "Pixel sort", description "Sort runs of pixels along a direction by brightness, hue or a channel." `debugViews: ['selection']`.

### 5.1 Parameters

| Param | Label | Kind | Default | Range or options | Group | Visible when | Help |
|---|---|---|---|---|---|---|---|
| `angle` | Angle | angle | 0 | [0, 360), step 0.1; snaps 0, 45, 90, 135, 180, 225, 270, 315 | Direction | always | Degrees counter-clockwise from rightward: 0 sorts left to right, 90 bottom to top, 180 right to left, 270 top to bottom. |
| `intervalMode` | Interval mode | enum | `threshold` | `threshold` "Threshold", `edges` "Edges", `whole` "Whole line" | Selection | always | How pixels are selected for sorting: by a threshold on a key, between edges, or the whole line. |
| `selectKey` | Selection key | enum | `luma` | the 8 keys of section 5.3 | Selection | `intervalMode` = `threshold` | The key the threshold range is compared against. |
| `threshold` | Threshold range | range | [0.25, 0.80] | 0..1, step 0.001 | Selection | `intervalMode` = `threshold` | Pixels whose selection key lies in this range, inclusive at both ends, are selected. |
| `edgeThreshold` | Edge threshold | number (ratio) | 0.20 | 0..1, step 0.01 | Selection | `intervalMode` = `edges` | Edge strength, as a fraction of the maximum single-axis gradient, at which a pixel counts as an edge. Pixels that are not edges are selected. |
| `edgeBlur` | Edge blur | integer (px) | 1 | 0..8 | Selection | `intervalMode` = `edges` | Box blur radius applied before edge detection. |
| `invert` | Invert | boolean | false | | Selection | `intervalMode` ≠ `whole` | Select the pixels that would not be selected, and the other way round. |
| `maxLength` | Maximum interval length | integer (px) | 0 | 0..16384; 0 means no limit | Length | always | Splits each run into intervals of at most this length. 0 means no limit. |
| `lengthJitter` | Length jitter | number (ratio) | 0 | 0..1, step 0.01 | Length | `maxLength` ≠ 0 | Random variation of each interval length around the maximum. |
| `skipChance` | Skip chance | number (ratio) | 0 | 0..1, step 0.01 | Length | always | Chance that an interval is left unchanged. |
| `sortKey` | Sort key | enum | `luma` | the 8 keys of section 5.3 | Order | always | The key each interval is sorted by. |
| `order` | Order | enum | `ascending` | `ascending` "Ascending", `descending` "Descending", `shuffle` "Shuffle", `random` "Random direction" | Order | always | Ascending puts the smallest key first along the line direction. Random direction picks ascending or descending per interval. |
| `discretize` | Discretize | integer | 0 | 0..64 | Order | `fill` ≠ `average` | Colours within about this many 8-bit steps compare equal and keep their order, giving clumpier streaks. 0 turns it off. |
| `fill` | Fill | enum | `sort` | `sort` "Sort", `average` "Average", `gradient` "Gradient" | Output | always | Sort moves the pixels; average paints each interval with its mean colour; gradient blends from its first ordered pixel to its last. |
| `seed` | Seed | seed | random | uint32 | Seed | always | Drives length jitter, skipping, shuffle and random direction. |

The effect runs in three steps per line: select pixels (5.4), split selected pixels into intervals (5.4), then reorder or repaint each interval (5.5).

### 5.2 Lines: direction and angle

A pixel sort instance sorts along one direction. The image is partitioned into **lines**: ordered sequences of pixels such that every pixel belongs to exactly one line, consecutive pixels in a line are 8-connected neighbours, and no pixel is resampled. Pixels are moved, never interpolated, at every angle. (The surveyed tools rotate the image, sort rows and rotate back, which resamples twice; we do not.)

**Direction vector.** The angle is measured in degrees counter-clockwise from "rightward" on screen: 0 sorts left to right, 90 bottom to top, 180 right to left, 270 top to bottom. Let `a = wrap(Math.round(angle * 10), 3600)` (tenths of a degree). The integer direction `(DX, DY)` in screen coordinates (y down) is read from `DIRECTION_TABLE[a]`, a checked-in table of 3,600 pairs generated once by `scripts/gen-direction-table.ts` as `DX = roundHalfAway(4096 * cos(θ))`, `DY = roundHalfAway(-4096 * sin(θ))` with `θ = a / 10 * π / 180`, and with the four exact entries `a = 0: (4096, 0)`, `900: (0, -4096)`, `1800: (-4096, 0)`, `2700: (0, 4096)`. A unit test checks every entry against `Math.cos` and `Math.sin` within ±1. The table makes line geometry identical on every JavaScript engine.

**Partition.** For a render image of `W × H`:

- If `|DX| >= |DY|` (horizontal-major): let `sx = Math.sign(DX)` and, for `x` in `0..W-1`, `o(x) = floorDiv(2 * x * DY * sx + |DX|, 2 * |DX|)` (that is, `x * DY / DX` rounded half up). Line `k` holds the pixels `(x, k + o(x))` for every `x` where `0 <= k + o(x) < H`. Lines exist for every `k` from `-max(o)` to `H - 1 - min(o)`. Pixels in a line are ordered by increasing `x` when `DX > 0` and decreasing `x` when `DX < 0`. The **position** of a pixel in source space is `toSource(x)`.
- Otherwise (vertical-major): let `sy = Math.sign(DY)` and `o(y) = floorDiv(2 * y * DX * sy + |DY|, 2 * |DY|)`. Line `k` holds `(k + o(y), y)` for every `y` with `0 <= k + o(y) < W`, for `k` from `-max(o)` to `W - 1 - min(o)`. Order: increasing `y` when `DY > 0`, decreasing when `DY < 0`. Position: `toSource(y)`.

Every line has at most `max(W, H)` pixels, at most 16,384. For each line, the **source line id** is `toSource(k)` cast with `>>> 0`; it keys random choices (section 10.3).

Fast paths: angles 0 and 180 are rows, 90 and 270 are columns; implementations iterate them with strides instead of computing `o`. Other angles compute `o` once per render (an `Int32Array` of length `W` or `H`) and generate one line at a time into a reusable index buffer, so no full-image index map is built.

Examples: angle 45 gives `(DX, DY) = (2896, -2896)`, horizontal-major, `o(x) = -x`, so line `k` is `(x, k - x)` running up and to the right. Angle 90 gives columns read bottom to top.

### 5.3 Sort and selection keys

Every key maps a pixel's `R, G, B` (alpha ignored) to an integer `key16` in 0..65535 using integer arithmetic only. Let `M = max(R, G, B)`, `m = min(R, G, B)`, `d = M - m`.

| Key | Label | `key16` |
|---|---|---|
| `luma` | Luma | `Y = 2126*R + 7152*G + 722*B` (0..2,550,000); `key16 = floorDiv(Y * 131070 + 2550000, 5100000)` |
| `lightness` | Lightness | `floorDiv((M + m) * 131070 + 510, 1020)` |
| `value` | Value | `M * 257` |
| `saturation` | Saturation | `0` if `d = 0`; else `den = (M + m <= 255) ? (M + m) : (510 - M - m)` and `key16 = floorDiv(d * 131070 + den, 2 * den)` |
| `hue` | Hue | `0` if `d = 0`; else `h = G - B` if `M = R` (add `6*d` if negative), else `h = B - R + 2*d` if `M = G`, else `h = R - G + 4*d`; `key16 = floorDiv(h * 131072 + 6*d, 12*d)`, then `0` if it equals 65536 |
| `red` | Red | `R * 257` |
| `green` | Green | `G * 257` |
| `blue` | Blue | `B * 257` |

Notes: luma uses the Rec. 709 weights on gamma-encoded values (not linear light), which keeps it exact; a perceptual CIE L* key may be added later with a checked-in lookup table. Lightness and saturation follow HSL; value follows HSV. Hue ties go to red first, then green. Grey pixels have hue 0 and saturation 0.

Because keys are pure functions of 24-bit colour, implementations may memoise them (for example a `Map` or a 32,768-entry cache keyed on the colour) as long as results are identical.

### 5.4 Selection, runs and intervals

For each line, with pixels `p[0..n-1]` in line order:

**1. Selection.** Compute `selected[j]` for every pixel:

- A pixel with alpha 0 is never selected, in every mode; this check is applied after `invert`, and transparent pixels still feed the edge detector (their RGB values participate in `Y8`, blur, and Sobel).
- `threshold`: `lo16 = Math.floor(threshold[0] * 65535 + 0.5)`, `hi16 = Math.floor(threshold[1] * 65535 + 0.5)`. `inBand = lo16 <= selectKey16(p) <= hi16` (inclusive at both ends). `selected = inBand !== invert`.
- `edges`: computed on the instance's input at render size.
  1. `Y8 = floorDiv(2126*R + 7152*G + 722*B + 5000, 10000)` for every pixel.
  2. If `r = ctx.px(edgeBlur)` is above 0, box blur `Y8` horizontally then vertically with radius `r`: each output is `floorDiv(2 * S + (2r + 1), 2 * (2r + 1))` where `S` is the sum over `2r + 1` samples with coordinates clamped to the image.
  3. Sobel on the (blurred) map with coordinates clamped to the image: `gx = [Y(x+1,y-1) + 2Y(x+1,y) + Y(x+1,y+1)] - [Y(x-1,y-1) + 2Y(x-1,y) + Y(x-1,y+1)]`, `gy = [Y(x-1,y+1) + 2Y(x,y+1) + Y(x+1,y+1)] - [Y(x-1,y-1) + 2Y(x,y-1) + Y(x+1,y-1)]`.
  4. `t = Math.round(edgeThreshold * 1000)`. A pixel is an edge when `1000000 * (gx*gx + gy*gy) >= (1020 * t) * (1020 * t)`. (`1020` is the largest possible `|gx|`, so `edgeThreshold` is the edge strength as a fraction of the maximum single-axis gradient.) With `t = 0` every pixel is an edge.
  5. `selected = !isEdge !== invert`, that is, non-edges are selected unless inverted.
  This map is computed once per render into scratch memory (2 bytes per pixel at most) before lines are processed.
- `whole`: every pixel with alpha above 0 is selected. `invert` is ignored.
- Later, masks (5.6) also clear `selected`.

**2. Runs.** A **run** is a maximal sequence of consecutive selected pixels in a line. Runs never continue past the end of a line and never wrap to another line.

**3. Intervals.** Each run is split into **intervals** from its first pixel onward:

- If `maxLength = 0`, the whole run is one interval.
- Otherwise, starting at run index `s`, the next interval's length cap is `L = max(1, Math.floor(Lr * (1 + lengthJitter * (2u - 1))))`, where `Lr = ctx.pxLength(maxLength)` and `u = unit(seed, P_CAP, lineId, toSource(position of p[s]))` (section 10.1). The interval is `min(L, remaining)` pixels; the next interval starts right after it.

**Boundary rule.** Unselected pixels never move and are not part of any interval. An interval begins and ends on selected pixels. The unselected pixel that ends a run stays exactly where it was, so a run ending at a threshold edge keeps a sharp edge on the unsorted side. Line ends end runs. An interval of length 1 is left unchanged.

**4. Skip.** An interval of length 2 or more is left unchanged when `unit(seed, P_SKIP, lineId, toSource(position of its first pixel)) < skipChance`.

### 5.5 Order and fill

For each interval that is not skipped, with `q` its pixels in line order (`q.length = n >= 2`):

**Comparison key.** `c = sortKey16(pixel)`; if `discretize = D > 0`, `c = Math.floor(c / (D * 257))`, so colours within about `D` 8-bit steps compare equal and keep their order, giving clumpier streaks.

**Order.**

- `ascending`: stable sort by `c`, smallest first along the line direction.
- `descending`: stable sort by `65535 - c`. Equal keys keep their original order (descending is not the reverse of ascending when there are ties).
- `random`: per interval, ascending if `unit(seed, P_ORDER, lineId, toSource(first position)) < 0.5`, else descending.
- `shuffle`: Fisher–Yates on the interval: for `j` from `n - 1` down to 1, swap `q[j]` with `q[t]` where `t = intIn(0, j, seed, P_SHUFFLE, lineId, toSource(first position), j)`. `c` is not used.

Implementation note (informed by [spike S1](../research/spike-s1-engine-throughput.md)): pack `c * 65536 + localIndex` into a `Uint32Array` (local index < 65,536 because lines are at most 16,384 px); values are unique, so sorting them equals a stable sort on every engine. Spike S1 compared three approaches: the built-in `Uint32Array.prototype.sort()`, an exact 2-pass 8-bit LSD 16-bit radix sort (`radix-16`), and a 1-pass 8-bit counting sort (`counting-8`) that quantises keys. `radix-16` was fastest in Chromium by 1.60× at angle 0 (144.1 ms vs 231.2 ms) and 1.43× at angle 30 (212.4 ms vs 304.1 ms), while `Uint32Array.prototype.sort()` was slightly faster in Firefox by 1.11× at angle 0 (152.0 ms vs 168.0 ms) and 1.03× at angle 30 (270.0 ms vs 277.0 ms). The 8-bit counting sort is not exact and must not be used, because quantising keys breaks the determinism guarantee (section 10.2) and golden tests. Recommended choice: exact 16-bit radix sort (`radix-16`) with insertion sort for short runs (`n <= 32`). Both exact approaches produce bit-identical output, and the choice between them is an implementation detail that tests must not depend on.

**Fill.**

- `sort`: write the ordered pixels back into the interval's positions in line order. All four channels move together. The output of the interval is a permutation of its input.
- `average`: every pixel of the interval becomes the channel-wise mean, `floorDiv(2 * sum + n, 2 * n)` for each of R, G, B, A. Order and discretize do not affect it.
- `gradient`: order the pixels as above, take the first ordered pixel `s` and the last `e`, and set pixel `j` (0-based in line order) of the interval to `floorDiv(2 * (s * (n - 1 - j) + e * j) + (n - 1), 2 * (n - 1))` per channel. Output colours are interpolated and are not a permutation. With `shuffle` order, `s` and `e` are the first and last shuffled pixels; with tied keys, `s` and `e` come from the stable order (earliest and latest in the interval).

### 5.6 Masks (later; semantics fixed now)

Masks are a later feature (product.md section 6). When they arrive they follow these rules, so the first-release design does not block them:

- A mask is a single-channel 8-bit image at source resolution, stored as a separate asset and referenced from an effect instance by a new optional field (stack `schemaVersion` 2). At render time it is resampled to render size by box averaging.
- For every effect type, the mask scales the composite: in section 4.5, `m` becomes `Math.round(mix * 100 * mask / 255)` per pixel.
- For `pixelSort` it also affects selection: a pixel whose mask value is below 128 is not selected, so masked areas break runs exactly like unselected pixels.

### 5.7 Selection view

With `ctx.debugView = 'selection'`, the output is the input with every unselected pixel's R, G and B replaced by `c >> 2` (alpha unchanged). Intervals and skipping are ignored; only `selected` matters. The UI's "Show selection" switch uses it.

### 5.8 Random purpose codes

`P_CAP = 1`, `P_SKIP = 2`, `P_ORDER = 3`, `P_SHUFFLE = 4`. These values are part of the output definition and must not change without a version bump.

## 6. Other first-release effects

Keeps alpha from the input pixel at the same `(x, y)`.

### 6.1 `channelShift` (version 1, glitch): "Offset the red, green and blue channels."

| Param | Label | Kind | Default | Range | Group |
|---|---|---|---|---|---|
| `redX`, `redY` | Red X, Red Y | integer (px) | 6, 0 | −1024..1024 | Red |
| `greenX`, `greenY` | Green X, Green Y | integer (px) | 0, 0 | −1024..1024 | Green |
| `blueX`, `blueY` | Blue X, Blue Y | integer (px) | −6, 0 | −1024..1024 | Blue |
| `edge` | Edge mode | enum | `clamp` | `clamp` "Stretch edge", `wrap` "Wrap around" | Edges |

For channel `c` with offset `(dx, dy) = (ctx.px(cX), ctx.px(cY))`: `out.c(x, y) = in.c(E(x - dx, W), E(y - dy, H))`, where `E` is `clamp(v, 0, n - 1)` for `clamp` and `wrap(v, n)` for `wrap`. Positive `X` moves the channel right, positive `Y` down.

### 6.2 Later effects

`channelSwap` and `posterize` (both version 1, `color`) are implemented as specified in section 16.1. Two already-specified glitch effects (`sliceShift`, `blockShuffle`) are deferred to section 16.1. Additional effects specified when scheduled (product.md section 6): `smear` (carry a colour along a line with per-pixel decay), `waveShift` (sine-modulated row offsets), `dither` (ordered Bayer), `grain`, `dataBend` (corrupts the compressed source bytes and decodes the result; it is a source-level stage, not a pixel effect, and needs its own interface), per-channel pixel sort, and the interval transforms (mirror, splice, fold, grouping equal colours) as new `pixelSort` parameters in a version 2.

## 7. Built-in presets

Defined in `src/presets/builtin.ts` with ids `builtin:<slug>`. Parameters not listed use defaults. Seeds are fixed values listed here so a preset always gives the same result.

| Id | Name | Instances |
|---|---|---|
| `builtin:bright-streaks` | Bright streaks | `pixelSort` angle 0, threshold [0.50, 1.00] |
| `builtin:dark-drips` | Dark drips | `pixelSort` angle 270, threshold [0.00, 0.40] |
| `builtin:asdf-classic` | ASDF classic | `pixelSort` angle 270, threshold [0.25, 0.80]; then `pixelSort` angle 0, threshold [0.25, 0.80] |
| `builtin:grey-band` | Grey band | `pixelSort` angle 0, `selectKey` lightness, threshold [0.196, 0.627], `discretize` 3 |
| `builtin:hue-bands` | Hue bands | `pixelSort` angle 0, `intervalMode` whole, `sortKey` hue, `maxLength` 240, `lengthJitter` 0.5, seed 1 |
| `builtin:edge-melt` | Edge melt | `pixelSort` angle 270, `intervalMode` edges, `edgeThreshold` 0.20, `edgeBlur` 2 |

"ASDF classic" credits the column-then-row recipe of Kim Asendorf's ASDFPixelSort, the community's acknowledged origin of the technique; the About screen credits it. "Grey band" reproduces the look of a grey-band sort with a small tolerance, written in our own parameters. (`builtin:vhs-split` and `builtin:tile-scramble` move to section 16.1 with their effects.)

## 8. Preview strategy

### 8.1 Render sizes

`renderSize(W, H, s)` for a scale `s` in (0, 1]: `w = max(1, floor(W * s))`, `h = max(1, floor(H * s))`, and the context scale is `w / W`. For a pixel cap `P`: `s = min(1, sqrt(P / (W * H)))`, then `renderSize`. Export sizes use the same rule (1/2 of 4001 × 3001 is 2000 × 1500).

### 8.2 Levels

| Level | Pixel cap (desktop) | Produced by |
|---|---|---|
| `drag` | adaptive, starts at 1 MP (1,048,576), between 0.125 MP and 1 MP | preview worker, downscaled from the `settle` proxy by box averaging (our own resampler, deterministic) |
| `settle` | 4 MP (4,194,304) | preview worker, decoded with `createImageBitmap(blob, {resizeWidth, resizeHeight, resizeQuality: 'high'})` |
| `full` | source size (guaranteed up to 50 MP on desktop) | export worker (section 13) |

Adaptive `drag` cap: after each `drag` render, if its time exceeded the drag budget (section 9), halve the cap (not below 0.125 MP); if it took less than 40% of the budget, double it (not above the starting cap). The worker regenerates the drag proxy when the cap changes.

**Box downscale (`boxDownscale`):** exact alpha-weighted (premultiplied) area average with integer overlap weights. It throws `RangeError` on upscaling or non-positive/non-integer target dimensions. For source `sw × sh`, target `dw × dh`, destination pixel `(dx, dy)` and source pixel `(sx, sy)`:

- `wx = min((sx + 1) * dw, (dx + 1) * sw) - max(sx * dw, dx * sw)`
- `wy = min((sy + 1) * dh, (dy + 1) * sh) - max(sy * dh, dy * sh)`
- `w = wx * wy` for all `(sx, sy)` with `wx > 0` and `wy > 0`, and `total = sw * sh`.
- `sumA = sum(w * A)` and, for each colour channel `C` in `R, G, B`, `sumC = sum(w * A * C)`.
- Output alpha is `floorDiv(2 * sumA + total, 2 * total)`.
- If `sumA === 0`, the output pixel is `(0, 0, 0, 0)`; otherwise each colour channel is `floorDiv(2 * sumC + sumA, 2 * sumA)`.

For fully opaque images (`A = 255`), the output is bit-identical to straight-alpha area averaging.

### 8.3 Scheduling

The main-thread render coordinator (`src/render/coordinator.ts`) owns the preview worker (one project is open at a time) and keeps a monotonically increasing `generation` number.

- Every change of the effective stack (including uncommitted slider values) or of the debug view increments `generation`.
- While a control is being dragged: send a `drag` render of the newest stack whenever no `drag` render is in flight. Intermediate values that arrive while one is in flight are coalesced; only the newest is sent next. There is never more than one in-flight request per level.
- When the control is released, or 150 ms pass without a change: send a `settle` render of the newest stack.
- On a `settle` result, if the view shows the image at more than 1.25 device pixels per `settle` proxy pixel and the proxy scale is below 1, wait 500 ms without changes, then request a `full` render (8.6).
- Results whose `generation` is older than the newest result already displayed are dropped. A `settle` result replaces a `drag` result of the same or older generation; a `drag` result never replaces a newer `settle` result.

### 8.4 Cancellation

A worker cannot read new messages while a synchronous loop runs, and `SharedArrayBuffer` flags need cross-origin isolation, which the app does not require (decision D6). So:

- **Preview worker: cooperative time slicing.** `ctx.checkpoint()` checks `performance.now()`; once 8 ms have passed since the last yield, it yields to the event loop with a `MessageChannel` round trip (no 4 ms timer clamp), during which `render` and `cancel` messages are processed. If the running job's generation is now older than the newest requested generation, `checkpoint` throws `Cancelled` (exported from `src/engine/types.ts`; the pipeline does not depend on it and rethrows whatever `checkpoint` throws), the pipeline discards its work and the worker starts the newest request. Expected overhead: under 3% of render time.
- **Export worker: termination.** Exports and `full` renders run in a separate worker. Cancelling terminates it with `worker.terminate()`; a fresh worker is created for the next job.

### 8.5 Stage cache

The preview worker caches pipeline stage outputs so editing instance `j` re-renders only instances `j` and later. `StageCache` exposes `get`, `set`, `clear`, `size`, and `byteLength`, and is built by `createStageCache({maxEntries?, maxBytes?})`. Key for the output after instance `i`: `level + ':' + width + 'x' + height + ':' + sourceKey + ':' + canonicalStackJson(enabled prefix 0..i)`. The enabled prefix includes enabled instances of unknown type or newer version even though they do not render, so editing them invalidates later stages. The cache keeps at most 6 entries or 160 MiB (`160 * 1024 * 1024`), whichever is reached first, evicting least recently used; a long stack therefore re-renders from the start when an early instance (more than six from the end) changes. Because the key includes `sourceKey` and render size, stale entries cannot hit; the pipeline does not call `clear()`, and the worker calls `clear()` when the source or render size changes to free memory. Debug renders read earlier stages from the cache but never write to it.

### 8.6 Progressive refinement

1. `drag` while moving (fast, coarse), 2. `settle` after the control stops (sharp at normal zoom), 3. `full` when the user zooms past the `settle` proxy's resolution. The `full` result is sent to the main thread as tiles of at most 2,048 × 2,048 px as `ImageBitmap`s and drawn per visible tile. Only one `full` result is kept; any stack change discards it.

## 9. Performance budgets

Reference device: product.md section 8 (desktop laptop only in the first release). Workload unless stated: one `pixelSort` instance with defaults at angle 0, on a representative 4:3 JPEG photo. Angled sorting uses the same 25 MP/s throughput floor at 12 MP rather than a relative ratio to angle 0, because a ratio penalises a fast axis-aligned path and does not say whether angled sorting is fast enough.

Measured values below come from [spike S1](../research/spike-s1-engine-throughput.md) on one Linux desktop laptop (13th Gen Intel Core i7-13650HX, 62 GiB RAM, CachyOS Linux) in headless Chromium `159.0.8154.6` and Firefox `159.0` on a synthetic image (author run / lead rerun where both were run).

| Measure | Reference laptop (engineering target) | Measured in S1 (one machine, headless) |
|---|---|---|
| `drag` render at its starting cap (1 MP), p95 | ≤ 50 ms | Chromium: 19.2 ms / 15.6 ms; Firefox: 21.0 ms / 28.0 ms |
| Visible update after a change (input to pixels on screen), p95 | ≤ 100 ms | Chromium: 20.0 ms / 17.1 ms; Firefox: 25.0 ms / 31.0 ms |
| `settle` render (4 MP), p95 | ≤ 300 ms | Chromium: 60.0 ms / 61.8 ms; Firefox: 97.0 ms / 82.0 ms |
| `pixelSort` kernel throughput, angle 0, single thread (12 MP, p50) | ≥ 25 MP/s | Chromium: 83.3 / 85.9 MP/s (`radix-16`); Firefox: 78.9 / 79.5 MP/s (`typed-array`; `radix-16`: 71.4 MP/s) |
| `pixelSort` kernel throughput, angle 30, single thread (12 MP, p50) | ≥ 25 MP/s | Chromium: 56.5 MP/s (212.4 ms) / 54.5 MP/s (220.0 ms); Firefox: 44.4 MP/s (270.0 ms) / 44.9 MP/s (267.0 ms) |
| Project open: decode + first `settle` render, 12 MP source | ≤ 1.0 s | not measured in S1 (unbenchmarked) |
| Export 12 MP, PNG, full size, including decode and encode | ≤ 2 s (unbenchmarked target) | not measured in S1 (kernel only: 144.1 / 139.7 ms Chromium, 152.0 / 151.0 ms Firefox) |
| Export 24 MP, same | ≤ 5 s (unbenchmarked target) | not measured in S1 (kernel only: 288.9 ms Chromium, 306.0 ms Firefox) |
| Export 50 MP, same | ≤ 12 s (unbenchmarked target) | not measured in S1 (kernel only: 581.0 ms Chromium, 624.0 ms Firefox) |
| Main-thread long tasks during any render | none over 50 ms | Chromium: 0 long tasks (0.0 ms); Firefox: stall probe max 12.0 ms / 14.0 ms (Long Tasks API unsupported) |
| Peak worker memory for a `full` render of `P` pixels | ≤ `3 × 4P + 2P` bytes plus encoder output | not directly measured (50 MP peak process-tree RSS: 889.8 MiB Chromium, 1,333.2 MiB Firefox) |

Several figures above are unbenchmarked engineering targets that are tighter than a product.md acceptance criterion. The acceptance limit is the product.md number; missing the engineering target alone does not fail acceptance:

- Export 12 MP, PNG, full size, laptop: engineering target 2 s; the acceptance limit is 5 s (product.md AC-F12.1).
- `drag` render (50 ms) and visible update (100 ms), laptop: engineering targets; the acceptance limit is at least 5 preview updates per second while dragging (product.md AC-F8.1).

The memory budget means: source buffer, two working buffers, at most 2 bytes per pixel of scratch, plus the encoded file.

## 10. Determinism

### 10.1 Seeded randomness

All randomness comes from a counter-based hash, so results do not depend on processing order, chunking or worker count.

```ts
function mix32(x: number): number; // x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0
function hash32(seed: number, ...keys: number[]): number; // h = mix32(seed >>> 0); for each key: h = mix32((h ^ (key >>> 0)) >>> 0); return h
function unit(seed: number, ...keys: number[]): number; // hash32(seed, ...keys) / 4294967296, in [0, 1)
function intIn(lo: number, hi: number, seed: number, ...keys: number[]): number; // lo + Math.floor(unit(seed, ...keys) * (hi - lo + 1))
```

`mix32` uses the published "lowbias32" integer hash constants (public domain). The first key is always the effect's purpose code; the rest identify the decision (line id, position, counter).

### 10.2 The guarantee

For identical input pixels, an identical effect stack (after migration and validation) and an identical render size, the output bytes are identical on every run, in every browser and in Node. Two limits:

- Input pixels come from the browser's decoder. JPEG decoders and the `settle` resize differ slightly between browsers, so the same file can give slightly different results across browsers (for example Chrome and Firefox). PNG sources decode identically.
- The `drag` and `settle` previews are exact renders at their size, not downscaled copies of the full result. Their structure matches the export (10.3), but pixel values differ.

### 10.3 Resolution independence

- Spatial parameters are source pixels converted with `ctx.px` and `ctx.pxLength`.
- Random keys use source-space ids (`ctx.toSource` of line indices and positions, source tile and slice indices). Because `toSource` maps a render pixel's centre to source coordinates, a proxy render and an export make the same random choice only when keyed to the same source line and position; a half-size preview of a stack that uses random order, skip chance, length jitter, or shuffle is therefore similar to, not identical with, the export.
- Pixel sort selection depends on pixel content, which the proxy approximates; intervals in the preview are therefore close to, not identical to, the export's.

## 11. Worker protocol

Two worker scripts: `src/worker/preview.worker.ts` (one, long-lived, reloaded with each opened project's source) and `src/worker/export.worker.ts` (one per export or `full` render, terminated afterwards). Both are module workers created with `new Worker(new URL('./x.worker.ts', import.meta.url), {type: 'module'})`. Messages are plain objects with a `type` field; types live in `src/worker/protocol.ts` and are shared by both sides.

```ts
type StackRequest = {stack: EffectStack; debug?: {instanceId: string; view: 'selection'}};

type PreviewRequest =
	| {type: 'loadSource'; requestId: number; sourceKey: string; blob: Blob; sourceWidth: number; sourceHeight: number; caps: {drag: number; settle: number}}
	| ({type: 'render'; jobId: number; generation: number; sourceKey: string; level: 'drag' | 'settle'} & StackRequest)
	| {type: 'cancel'; belowGeneration: number}
	| {type: 'setDragCap'; pixels: number}
	| {type: 'unloadSource'; sourceKey: string};

type PreviewResponse =
	| {type: 'sourceLoaded'; requestId: number; sourceKey: string; settle: {width: number; height: number}; drag: {width: number; height: number}; original: ImageBitmap}
	| {type: 'progress'; jobId: number; fraction: number}
	| {type: 'rendered'; jobId: number; generation: number; level: 'drag' | 'settle'; width: number; height: number; bitmap: ImageBitmap; totalMs: number; perInstanceMs: number[]; warnings: PipelineResult['warnings']}
	| {type: 'cancelled'; jobId: number}
	| {type: 'error'; jobId?: number; requestId?: number; code: EngineErrorCode; message: string};

type ExportRequest =
	| ({type: 'export'; jobId: number; blob: Blob; sourceWidth: number; sourceHeight: number; scale: number; format: 'png' | 'jpeg' | 'webp'; quality: number} & StackRequest)
	| ({type: 'renderFull'; jobId: number; generation: number; blob: Blob; sourceWidth: number; sourceHeight: number} & StackRequest);

type ExportResponse =
	| {type: 'progress'; jobId: number; stage: 'decode' | 'render' | 'encode'; fraction: number}
	| {type: 'exported'; jobId: number; file: Blob; width: number; height: number; mime: string; totalMs: number}
	| {type: 'fullRendered'; jobId: number; generation: number; width: number; height: number; tiles: {x: number; y: number; bitmap: ImageBitmap}[]}
	| {type: 'error'; jobId: number; code: EngineErrorCode; message: string};

type EngineErrorCode = 'decode-failed' | 'unsupported-format' | 'too-large' | 'out-of-memory' | 'encode-failed' | 'internal';
```

Rules:

- `ImageBitmap`s and `ArrayBuffer`s are transferred, not copied. Blobs are passed by reference.
- `loadSource` decodes the `settle` proxy, derives the `drag` proxy, and returns the `settle`-size source as `original` for Compare.
- Allocation failures (`RangeError`) become `out-of-memory`; the UI suggests a smaller export size.
- Crash handling: if a worker fires `error` or does not answer a `render` within 30 s, the coordinator terminates it, starts a new one, reloads the source and repeats the newest request. A second crash within 60 s shows the error state in DESIGN.md section 9.
- The main thread never runs effect code; it only draws bitmaps.

## 12. Where WebGPU plugs in later

Effect definitions do not change when GPU acceleration arrives. The plan:

1. A separate registry of GPU kernels: `registerGpuKernel({type: 'pixelSort', version: 1, supports(params, size): boolean, run(device, inputTexture, outputTexture, params, ctx)})` in `src/engine/gpu/`. The CPU `render` stays the reference.
2. The pipeline, per instance, uses a GPU kernel only when one is registered for the exact `type` and `version`, a device passed the startup smoke test (request adapter and device, run a tiny compute pass, compare to the CPU result), and `supports` returns true. Otherwise it uses the CPU. Consecutive GPU instances keep data on the GPU; the pipeline reads back only when the next instance is CPU-only or at the end.
3. A GPU kernel is enabled for `settle` and `full` only after it passes the same golden tests bit for bit (it must use the integer key formulas of 5.3 and the direction table of 5.2, with line offsets precomputed on the CPU). A kernel that is close but not exact may be enabled for `drag` only.
4. The first candidate is axis-aligned `pixelSort` with lines up to 4,096 px: per-line workgroups, selection and interval splitting by parallel scans and a sorting network in workgroup memory, as described in the research for an MIT-licensed project. If code from that project is ported rather than rewritten, its MIT notice goes in the third-party notices.
5. Device loss falls back to the CPU for the rest of the session.

## 13. Full-resolution decode and export

The first release targets desktop browsers and uses native browser canvas APIs for decode and encode (the iOS > 16.78 MP path is deferred to section 16.2).

**Decode to an `RgbaImage` at render/export size:**

- `createImageBitmap(blob, {imageOrientation: 'from-image', colorSpaceConversion: 'default'})` (with `resizeWidth` / `resizeHeight` when scaling down for 1/2, 1/4, or custom export sizes), draw onto a reused `OffscreenCanvas`, read with `getImageData`, release the bitmap with `close()`, and shrink the canvas to `1 × 1` afterwards.
- `ImageDecoder` (WebCodecs) is not used.

**Encode** (native canvas encoders only):

| Format | Encoder |
|---|---|
| PNG | `OffscreenCanvas.convertToBlob({type: 'image/png'})` |
| JPEG | `OffscreenCanvas.convertToBlob({type: 'image/jpeg', quality})` |
| WebP | `OffscreenCanvas.convertToBlob({type: 'image/webp', quality})`, offered only when a startup probe returns `blob.type === 'image/webp'` (Chrome, Edge, Firefox) |

Every native encode checks `blob.type` against the requested MIME type, because unsupported types fall back to PNG silently. Encoding from raw RGBA canvas pixels carries no EXIF, GPS, or ICC metadata from the source file.

Limits and codec details:

- The 200 MB input file size limit is 209,715,200 bytes (`200 * 1024 * 1024`).
- Export quality is given as 50 to 100 and divided by 100 for `convertToBlob`.
- Transparent pixels are flattened onto white (`#ffffff`) before JPEG encoding.
- A PNG with partial transparency does not round-trip exactly because browsers premultiply alpha in a 2D canvas (opaque images are exact); exact decoding of partially transparent PNGs is later work.

**Size-limited encoding** (optional `maxBytes` / `maxFileSizeKb` in 10 KB–100 MB):

When `maxFileSizeKb` is unset or `null`, encoding runs once at the requested dimensions and quality with no extra work. When `maxFileSizeKb` is set (`maxBytes = maxFileSizeKb * 1024`):

1. Encode once at the requested dimensions and quality. If `blob.size <= maxBytes`, return immediately with `targetMet: true`.
2. For lossy formats (`jpeg`, `webp`), binary-search integer quality in `[10, requestedQuality]` (quality floor `10`, i.e. `0.10`; up to 7 iterations) to find the highest quality where `blob.size <= maxBytes`.
3. If still `> maxBytes` (or for lossless `png`), iteratively downscale the rendered image uniformly on an `OffscreenCanvas` (bounded to at most 6 scaling iterations; uniform floor scale `minScale = Math.min(1, 64 / Math.min(width, height))` so aspect ratio is always preserved and sources with a side `<= 64` px are not downscaled; per-step multiplier `clamp(Math.sqrt(maxBytes / blob.size) * 0.92, minScale / scale, 0.9)`, jumping directly to `minScale` on the final iteration if not yet reached, with `nextWidth = Math.max(1, Math.round(width * scale))` and `nextHeight = Math.max(1, Math.round(height * scale))`) and re-encode. For lossy formats at a downscaled size, test at the quality floor first and refine quality upward with binary search if it fits.
4. Check cancellation (via an optional `isCancelled` callback or worker termination) and report encode progress between iterations so cancellation still completes within 1 s.
5. Return the final `blob` together with metadata: `actualWidth` (the encoded `width`), `actualHeight` (the encoded `height`), `effectiveQuality` (integer `10..100` for JPEG/WebP, `undefined` for PNG), and `targetMet` (`blob.size <= maxBytes`).

## 14. Testing

### 14.1 Unit tests

Run with `vp test run` in Node. Required per module:

- `keys.ts`: every key against hand-computed values for at least 12 colours, including black, white, pure R, G, B, greys, ties (`R = G`), and the hue wrap point; monotonic in the relevant channel.
- `lines.ts`: the partition properties in 14.3 for angles 0, 0.1, 30, 44.9, 45, 45.1, 90, 135, 180, 225, 270, 315, 359.9.
- `random.ts`: fixed vectors (`hash32(0)`, `hash32(1, 2, 3)` and 8 more) so the function can never change silently; `intIn` stays within bounds over 100,000 draws.
- `params.ts`: every validation rule of section 3.
- `pipeline.ts`: disabled instances skipped; unknown types skipped with a warning; mix and blend formulas on hand-computed pixels; debug view stops the pipeline at its instance.

### 14.2 Golden images

- Inputs are synthetic images generated in code by `tests/fixtures/synthetic.ts` from `hash32`, so no photos are needed in the repository: `gradient-64x48` (diagonal colour gradient), `noise-97x61` (hashed RGB noise, odd size), `bands-80x80` (horizontal bands of 8 grey levels with 1 px black separators), `alpha-32x32` (gradient with a transparent quarter).
- Each case is `tests/golden/<type>/<case>.json` holding `{input, stack, scale}` and `tests/golden/<type>/<case>.png` holding the expected output, encoded and decoded with `fast-png` (a dev dependency that task `T2.7` adds) in Node tests.
- The test renders the case at `scale` and compares bytes exactly. On mismatch it writes `<case>.actual.png` and a diff image to `tests/golden/.out/` (git-ignored) and reports the count of differing pixels.
- `vp run golden:update` rewrites expected images and is never run by CI.
- Minimum cases for `pixelSort`: every interval mode; every sort key at angle 0; every order; every fill; angles 0, 30, 45, 90, 180, 270, 333.3; `invert`; `maxLength` with and without jitter; `skipChance` 0.5; `discretize` 4; selection debug view; the `alpha-32x32` input; scale 0.5. For `channelShift`: defaults, two non-default settings, scale 0.5.

### 14.3 Property tests

With `fast-check`, at least 200 runs each, on random images up to 64 × 64 and random valid parameters:

1. Lines: every pixel appears in exactly one line; consecutive pixels are 8-connected; line length ≤ `max(W, H)`.
2. `pixelSort` with `fill = sort`: each line's multiset of RGBA values is unchanged; unselected pixels are unchanged; within every non-skipped interval with `order` ascending or descending, comparison keys are monotonic in the stated direction.
3. `pixelSort` with angle `θ` and `ascending` equals angle `θ + 180` with `descending` when all keys in the image are distinct and `maxLength` is 0, `skipChance` is 0, and `discretize` is 0.
4. Every effect: output size equals input size; input buffer is unchanged after `render`; rendering twice gives identical bytes; `mix = 0` returns the input exactly.
5. `channelShift` with all offsets 0 is the identity.
6. Stack: `JSON.parse(JSON.stringify(stack))` renders identically; `validateParams` is idempotent; migrations of every version produce parameters that pass validation.

### 14.4 Benchmarks

`vp run bench` runs the kernels in Node on synthetic 12 MP and 24 MP images and prints MP/s per effect and angle. A browser benchmark page (`/bench.html`, built only in dev) runs the same in a worker and reports p50 and p95 for spikes and release checks. CI runs benchmarks for information only; timing never fails CI.

## 15. Module layout

```
src/engine/            pure TypeScript, no DOM (no barrel file; import from each module)
  types.ts             RgbaImage, EffectStack, EffectInstance, ParamSpec, RenderContext, Cancelled, canonicalStackJson
  math.ts              floorDiv, roundHalfAway, clamp, wrap
  params.ts            validateParams, defaults, migration runner
  registry.ts          createRegistry
  pipeline.ts          renderStack, StageCache, createStageCache
  composite.ts         mix and blend
  random.ts            mix32, hash32, unit, intIn
  keys.ts              the 8 keys
  lines.ts             line partition
  direction-table.ts   generated, checked in
  resample.ts          box downscale for the drag proxy and masks
  effects/index.ts     the registered list
  effects/pixel-sort/  index.ts, select.ts, edges.ts, fill.ts
  effects/channel-shift.ts
  effects/channel-swap.ts
  effects/posterize.ts
  effects/slice-shift.ts
  effects/scanline-wave.ts
  gpu/                 later
src/codec/             decode.ts, encode.ts (worker-side, uses OffscreenCanvas)
src/worker/            protocol.ts, preview.worker.ts, export.worker.ts
src/render/            coordinator.ts (main thread: generations, scheduling, crash restart)
src/presets/           builtin.ts
tests/engine/          unit and property tests
tests/golden/          golden cases
tests/fixtures/        synthetic.ts
scripts/               gen-direction-table.ts, golden-update.ts, bench.ts
```

## 16. Next release (v0.2.0) and later

Specifications for post-v0.1.0 features (`F20`, `F21`, `F22`) and deferred mobile/Safari work. None of section 16 is implemented in `v0.1.0`. Since then, `channelSwap`, `sliceShift`, `posterize` and `scanlineWave` (section 16.1) and the import format detection (animation notice, HEIC/HEIF and RAW refusal) and SVG rasterised import of section 16.4 have been implemented.

### 16.1 Deferred glitch effects and v0.2.0 catalogue

This catalogue specifies 11 deterministic effects beyond `pixelSort` and `channelShift`. All 11 use the existing `ParamSpec` vocabulary (section 3), preserve `output.width === input.width` and `output.height === input.height`, never mutate `input`, and call `ctx.checkpoint()` at least once per 16,384 pixels.

**Ranking by value to effort (top 5 targeted for `v0.2.0`):**

| Rank | Effect `type` | Category | Locality | Cost class (4 MP) | `selection` debug | Target |
|---|---|---|---|---|---|---|
| 1 | `sliceShift` | `glitch` | Per line (row or col) | Low (< 15 ms) | No | `v0.2.0` |
| 2 | `channelSwap` | `color` | Per pixel | Low (< 10 ms) | No | `v0.2.0` |
| 3 | `blockShuffle` | `glitch` | Whole image | Low (< 15 ms) | No | `v0.2.0` |
| 4 | `scanlineWave` | `glitch` | Per line (row or col) | Low (< 15 ms) | No | `v0.2.0` |
| 5 | `posterize` | `color` | Per pixel | Low (< 10 ms) | No | `v0.2.0` |
| 6 | `bayerDither` | `color` | Per pixel (tile-local) | Low (< 15 ms) | No | Post-v0.2.0 |
| 7 | `rgbNoise` | `glitch` | Per pixel | Low (< 20 ms) | No | Post-v0.2.0 |
| 8 | `pixelSmear` | `glitch` | Per line (angled) | Medium (20 to 60 ms) | Yes | Post-v0.2.0 |
| 9 | `mirrorFold` | `glitch` | Whole image | Low (< 15 ms) | No | Post-v0.2.0 |
| 10 | `thresholdInvert` | `color` | Per pixel | Low (< 15 ms) | Yes | Post-v0.2.0 |
| 11 | `jpegCrush` | `glitch` | Whole image (8×8 blocks) | Medium (30 to 90 ms) | No | Post-v0.2.0 |

#### 1. `sliceShift` (version 1, `glitch`, top 5): "Shift random bands of the image sideways."

Partitions the image into variable-height horizontal bands (or variable-width vertical bands) in source space and shifts a random fraction of bands along the band axis, creating classic VHS tape-tracking tears and digital transmission glitches.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `axis` | Axis | enum | `horizontal` | `horizontal` "Rows", `vertical` "Columns" | Slices | always |
| `sliceMin` | Min band size | integer (px) | 4 | 1..2048 | Slices | always |
| `sliceMax` | Max band size | integer (px) | 48 | 1..2048 | Slices | always |
| `probability` | Probability | number (ratio) | 0.30 | 0..1, step 0.01 | Slices | always |
| `maxOffset` | Max offset | integer (px) | 80 | 0..4096 | Offset | always |
| `edge` | Edge mode | enum | `wrap` | `wrap` "Wrap around", `clamp` "Stretch edge" | Offset | always |
| `seed` | Seed | seed | random | uint32 | Seed | always |

- **Behavior:** Slices are defined in source space so preview and export match. For `horizontal`, slices partition source rows `0..Hs-1` (for `vertical`, swap rows and columns, and `x` and `y`). Let `lo = sliceMin`, `hi = max(sliceMin, sliceMax)`. Starting at `y0 = 0` with `i = 0`: slice `i` covers source rows `[y0, y0 + h)` with `h = intIn(lo, hi, seed, 1, i)`; it is active when `unit(seed, 2, i) < probability`; its offset is `o = intIn(-maxOffset, maxOffset, seed, 3, i)` when active, else 0; then `y0 += h`, `i += 1`, until `y0 >= Hs`. For render row `y`, find the slice containing `ys = clamp(ctx.toSource(y), 0, Hs - 1)`, let `or = ctx.px(o)`, and set `out(x, y) = in(E(x - or, W), y)` for all four channels, with `E` as in section 6.1.
- **Determinism & locality:** Deterministic via `hash32` with `seed` and purpose codes `1, 2, 3`. Per line once the slice table is built (at most `max(Hs, Ws)` entries). Cost class: Low. Debug views: none.
- **Provenance:** Standard glitch-art technique (VHS/scanline tearing). Clean-room own specification; no external code copied.
- **Tests:** hand-computed rows and columns in both edge modes, with the same offset on all four channels; `probability` 0 and `maxOffset` 0 are the identity; `sliceMin` above `sliceMax` behaves as `sliceMax = sliceMin`; slice boundaries and offsets follow the source-space table on a half-scale render; 1 × 1, 1 × N and N × 1 images and both ends of every range; the generic checks of section 14.3; stack JSON round trip; golden cases for defaults, two non-default settings and scale 0.5.

#### 2. `channelSwap` (version 1, `color`, top 5): "Swap the red, green and blue channels."

Reassigns the red, green, and blue colour channels of every pixel according to one of the six permutations of `(R, G, B)` while leaving alpha untouched, producing instant false-colour and retro-palette shifts.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `order` | Channel order | enum | `gbr` | `rgb` "RGB (identity)", `rbg` "RBG", `grb` "GRB", `gbr` "GBR", `brg` "BRG", `bgr` "BGR" | Channels | always |

- **Behavior:** The three letters name the input channel written to output R, G, and B: `gbr` means `outR = inG`, `outG = inB`, `outB = inR`, `outA = inA`.
- **Determinism & locality:** Fully deterministic, no seed. Pure per-pixel. Cost class: Low. Debug views: none.
- **Provenance:** Standard channel permutation (also noted in `jeffThompson/PixelSorting` `OtherSortingIdeas`, no licence file, never copied). Clean-room own implementation.

#### 3. `blockShuffle` (version 1, `glitch`, top 5): "Swap square tiles around the image."

Divides the image into a square grid of tiles in source space and swaps a random subset of tiles with other tiles on the grid, producing corrupted-frame mosaic and macroblock-reorder effects.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `tileSize` | Tile size | integer (px) | 64 | 4..1024 | Tiles | always |
| `amount` | Shuffle amount | number (ratio) | 0.15 | 0..1, step 0.01 | Tiles | always |
| `seed` | Seed | seed | random | uint32 | Seed | always |

- **Behavior:** Source grid: `T = tileSize`, `cols = floor(Ws / T)`, `rows = floor(Hs / T)`, `N = cols * rows` full tiles; the right and bottom remainders never move. If `N < 2`, output equals input. Permutation `π` starts as identity; for `t` from 0 to `N - 1`, if `unit(seed, 1, t) < amount`, swap `π[t]` and `π[intIn(0, N - 1, seed, 2, t)]`. Render pixel `(x, y)`: `xs = (x + 0.5) / scale`, `ys = (y + 0.5) / scale`, `tx = floor(xs / T)`, `ty = floor(ys / T)`. If `tx < cols` and `ty < rows`: `t2 = π[ty * cols + tx]`, `xs2 = xs + (t2 % cols - tx) * T`, `ys2 = ys + (floor(t2 / cols) - ty) * T`, and `out(x, y) = in(clamp(floor(xs2 * scale), 0, W - 1), clamp(floor(ys2 * scale), 0, H - 1))`. Otherwise `out(x, y) = in(x, y)`. At scale 1 this is an exact tile swap.
- **Determinism & locality:** Deterministic via `hash32` with `seed` and purpose codes `1, 2`. Needs whole image (random tile gather). Cost class: Low. Debug views: none.
- **Provenance:** Classic tile-scramble glitch effect. Clean-room own specification; no external code copied.

#### 4. `scanlineWave` (version 1, `glitch`, top 5): "Displace rows or columns along a wave with optional jitter."

Shifts each row (or column) horizontally (or vertically) by a periodic wave function combined with optional per-line random jitter, creating CRT horizontal-sync wobble, liquid distortion, and analogue interference.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `axis` | Axis | enum | `horizontal` | `horizontal` "Rows", `vertical` "Columns" | Wave | always |
| `waveform` | Waveform | enum | `sine` | `sine` "Sine", `triangle` "Triangle", `square` "Square", `sawtooth` "Sawtooth" | Wave | always |
| `amplitude` | Amplitude | integer (px) | 24 | 0..2048 | Wave | always |
| `wavelength` | Wavelength | integer (px) | 120 | 4..4096 | Wave | always |
| `phase` | Phase | angle | 0 | [0, 360), step 0.1; snaps 0, 90, 180, 270 | Wave | always |
| `jitter` | Line jitter | integer (px) | 0 | 0..512 | Jitter | always |
| `edge` | Edge mode | enum | `wrap` | `wrap` "Wrap around", `clamp` "Stretch edge" | Edges | always |
| `seed` | Seed | seed | random | uint32 | Seed | `jitter` ≠ 0 |

- **Behavior:** For `horizontal`, each render row `y` maps to source coordinate `ys = clamp(ctx.toSource(y), 0, Hs - 1)` (for `vertical`, swap axes). Normalized cycle position `t = wrap(ys / wavelength + phase / 360, 1)` computed via integer index `idx = wrap(floorDiv(ys * 3600, wavelength) + Math.round(phase * 10), 3600)` into `DIRECTION_TABLE[idx]` (section 5.2) so no `Math.sin` runs at render time:
  - `sine`: `wave = -DIRECTION_TABLE[idx].dy / 4096` (exact in `[-1, 1]`).
  - `triangle`: `p = idx / 3600`; `wave = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4`.
  - `square`: `wave = idx < 1800 ? 1 : -1`.
  - `sawtooth`: `wave = 2 * (idx / 3600) - 1`.
  Source offset `os = roundHalfAway(amplitude * wave) + (jitter > 0 ? intIn(-jitter, jitter, seed, 1, ys) : 0)`. Render offset `or = ctx.px(os)`. Set `out(x, y) = in(E(x - or, W), y)` for all four channels.
- **Determinism & locality:** Deterministic via `DIRECTION_TABLE` and `hash32` (purpose code `1`). Per line. Cost class: Low. Debug views: none.
- **Provenance:** Classic scanline/CRT wave displacement. Clean-room own implementation reusing `DIRECTION_TABLE` from section 5.2.
- **Tests:** hand-computed line offsets for all four waveforms on both axes and in both edge modes, with the same offset on all four channels; `phase` advances the cycle; `amplitude` 0 with `jitter` 0 is the identity; jitter is one draw per source line, repeats for a seed, changes with the seed, and the seed is ignored without jitter; a proxy render evaluates the wave and jitter at source lines; input is never written and the same input and parameters give the same output; parameters survive a saved-stack round trip and out-of-range values are repaired; golden cases for each waveform.

#### 5. `posterize` (version 1, `color`, top 5): "Reduce colour depth by quantising levels or crushing low bits."

Quantises each RGB channel into a small number of discrete steps or zeroes the lowest bits of each 8-bit channel, turning smooth photo gradients into bold graphic bands or harsh digital bit-crush contours.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `mode` | Mode | enum | `levels` | `levels` "Levels", `bitCrush` "Bit crush" | Quantise | always |
| `levels` | Levels per channel | integer | 6 | 2..64 | Quantise | `mode` = `levels` |
| `bitsDropped` | Bits dropped | integer | 4 | 1..7 | Quantise | `mode` = `bitCrush` |
| `preserveLuma` | Monochrome (luma) | boolean | false | | Output | always |

- **Behavior:** If `preserveLuma` is true, compute `Y8 = floorDiv(2126*R + 7152*G + 722*B + 5000, 10000)` and quantise `Y8`, writing the result to R, G, and B. Otherwise quantise R, G, and B independently. Alpha is copied unchanged.
  - `levels` (`L` in `2..64`): `stepIdx = floorDiv(c * (L - 1) + 127, 255)`, `out = floorDiv(stepIdx * 255 + floorDiv(L - 1, 2), L - 1)` (maps 0 to 0 and 255 to 255 evenly).
  - `bitCrush` (`b` in `1..7`): `mask = (0xff << b) & 0xff`, `out = c & mask`.
- **Determinism & locality:** Fully deterministic, no seed. Pure per-pixel (256-entry lookup table built once per render). Cost class: Low. Debug views: none.
- **Provenance:** Standard digital image quantisation. Clean-room own implementation.

#### 6. `bayerDither` (version 1, `color`): "Apply ordered Bayer matrix dithering."

Adds a repeating threshold matrix (2×2, 4×4, or 8×8 Bayer pattern) before quantising each channel, producing retro print, Game Boy, and early-computer crosshatch textures.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `matrix` | Matrix size | enum | `4` | `2` "2×2", `4` "4×4", `8` "8×8" | Pattern | always |
| `levels` | Levels per channel | integer | 2 | 2..16 | Palette | always |
| `monochrome` | Monochrome | boolean | false | | Palette | always |
| `spread` | Spread | number (ratio) | 1.0 | 0..1, step 0.01 | Pattern | always |
| `pixelScale` | Pattern scale | integer (px) | 1 | 1..16 | Pattern | always |

- **Behavior:** Standard recursive Bayer threshold matrices `B2` (values `0..3`), `B4` (`0..15`), `B8` (`0..63`) checked in as integer constants (`M = matrix`, `N = M * M`). For render pixel `(x, y)`, source matrix coordinates are `mx = wrap(floorDiv(ctx.toSource(x), pixelScale), M)` and `my = wrap(floorDiv(ctx.toSource(y), pixelScale), M)`. Normalised offset `d = (B[my * M + mx] + 0.5) / N - 0.5` (in `(-0.5, 0.5)`). Let `q = 255 / (levels - 1)` and `s = Math.round(spread * 100) / 100`. For each channel `c` (or `Y8` when `monochrome` is true): `v = clamp(c + d * q * s, 0, 255)`, `idx = Math.floor(v * (levels - 1) / 255 + 0.5)`, `out = floorDiv(idx * 255 + floorDiv(levels - 1, 2), levels - 1)`. Alpha unchanged.
- **Determinism & locality:** Fully deterministic, no seed. Pure per-pixel. Cost class: Low. Debug views: none.
- **Provenance:** Bryce Bayer (1973) ordered dithering algorithm (public domain mathematical definition). Clean-room own implementation.

#### 7. `rgbNoise` (version 1, `glitch`): "Add deterministic colour or monochrome noise and dead pixels."

Adds counter-hashed film/sensor grain or per-channel RGB static, plus optional dead/hot pixel dropout, keyed to source-image coordinates so preview and export have matching grain structure.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `amount` | Amount | number (ratio) | 0.15 | 0..1, step 0.01 | Noise | always |
| `monochrome` | Monochrome | boolean | false | | Noise | always |
| `dropout` | Dead/hot pixel chance | number (ratio) | 0 | 0..0.25, step 0.001 | Dropout | always |
| `grainSize` | Grain size | integer (px) | 1 | 1..16 | Noise | always |
| `seed` | Seed | seed | random | uint32 | Seed | always |

- **Behavior:** For render pixel `(x, y)`, cell coordinates in source space are `gx = floorDiv(ctx.toSource(x), grainSize)` and `gy = floorDiv(ctx.toSource(y), grainSize)`. If `dropout > 0` and `unit(seed, 4, gx, gy) < dropout`, set RGB to `(255, 255, 255)` if `unit(seed, 5, gx, gy) >= 0.5`, else `(0, 0, 0)` (alpha unchanged). Otherwise, let `amp = Math.round(amount * 255)`. If `monochrome`: `delta = intIn(-amp, amp, seed, 1, gx, gy)`, add `delta` to R, G, and B and clamp to `0..255`. If colour: compute independent `deltaR`, `deltaG`, `deltaB` with purpose codes `1, 2, 3` and clamp each to `0..255`.
- **Determinism & locality:** Deterministic via `hash32` with purpose codes `1..5`. Pure per-pixel. Cost class: Low. Debug views: none.
- **Provenance:** Standard counter-based procedural noise. Clean-room own implementation.

#### 8. `pixelSmear` (version 1, `glitch`): "Smear selected pixels along a direction with decay trails."

Walks along angled pixel lines (using `DIRECTION_TABLE` and `lines.ts` from section 5.2) and carries a pixel's colour forward through selected runs, blending it gradually with each pixel it passes to create melting trails and phosphor streaks.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `angle` | Angle | angle | 270 | [0, 360), step 0.1; snaps 0, 45, 90, 135, 180, 225, 270, 315 | Direction | always |
| `selectKey` | Selection key | enum | `luma` | the 8 keys of section 5.3 | Selection | always |
| `threshold` | Threshold range | range | [0.50, 1.00] | 0..1, step 0.001 | Selection | always |
| `invert` | Invert | boolean | false | | Selection | always |
| `decay` | Trail decay | number (ratio) | 0.92 | 0..0.99, step 0.01 | Smear | always |
| `maxLength` | Max trail length | integer (px) | 120 | 1..4096 | Smear | always |

- **Behavior:** Uses the exact line partition from section 5.2 and threshold selection from section 5.4 (`lo16 <= selectKey16(p) <= hi16`, `selected = inBand !== invert`, alpha 0 never selected). Walk each line in order maintaining `(carryR, carryG, carryB, remaining)` initialized to `remaining = 0`. Let `L = ctx.pxLength(maxLength)` and `d = Math.round(decay * 1000)` (integer 0..990). At pixel `j`:
  - If `selected[j]`: start or refresh the carry buffer with pixel `j`'s RGB, set `remaining = L`, write pixel `j` unchanged.
  - Else if `remaining > 0` and `inA > 0`: blend `outC = floorDiv(2 * (carryC * d + inC * (1000 - d)) + 1000, 2000)` for R, G, B (alpha unchanged), update `carryC = outC`, decrement `remaining`.
  - Else: write pixel `j` unchanged.
- **Selection debug view:** Lists `debugViews: ['selection']`. Uses the same convention as section 5.7 (unselected pixels darkened via `c >> 2`).
- **Determinism & locality:** Fully deterministic, no seed. Per line (reuses `lines.ts`). Cost class: Medium.
- **Provenance:** Classic directional pixel melt / smear trail. Clean-room own implementation reusing `lines.ts` and `keys.ts`.

#### 9. `mirrorFold` (version 1, `glitch`): "Mirror or fold the image into symmetrical quadrants or wedges."

Reflects one half, quadrant, or octant of the image across horizontal, vertical, or diagonal symmetry axes around a configurable centre, creating surreal architectural and kaleidoscope glitch compositions.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `mode` | Symmetry | enum | `horizontal` | `horizontal` "Left to right", `vertical` "Top to bottom", `quad` "Quad (4-way)", `octant` "Kaleidoscope (8-way)" | Fold | always |
| `flipSource` | Flip source side | boolean | false | | Fold | always |
| `centerX` | Centre X | number (ratio) | 0.50 | 0..1, step 0.01 | Axis | always |
| `centerY` | Centre Y | number (ratio) | 0.50 | 0..1, step 0.01 | Axis | `mode` ≠ `horizontal` |

- **Behavior:** Let `cx = roundHalfAway(centerX * (W - 1))`, `cy = roundHalfAway(centerY * (H - 1))`.
  - `horizontal`: if `flipSource` is false, mirror `x > cx` to `sx = clamp(2 * cx - x, 0, W - 1)` (else mirror `x < cx`); `sy = y`.
  - `vertical`: mirror `y` across `cy` (`sx = x`).
  - `quad`: apply both `horizontal` and `vertical` mirrors.
  - `octant`: compute `dx = x - cx`, `dy = y - cy`, fold `|dx|` and `|dy|` into the first octant (`if |dy| > |dx|` swap `(|dx|, |dy|)`), then sample `sx = clamp(cx + (flipSource ? -ax : ax), 0, W - 1)`, `sy = clamp(cy + (flipSource ? -ay : ay), 0, H - 1)`.
  Copy all four channels from `(sx, sy)`.
- **Determinism & locality:** Fully deterministic, no seed. Whole image (reads across symmetry axes). Cost class: Low. Debug views: none.
- **Provenance:** Standard image reflection / kaleidoscope folding (note: unrelated to `rkargon/pixelsorter` interval mirror, GPL-3.0, never copied). Clean-room own implementation.

#### 10. `thresholdInvert` (version 1, `color`): "Invert colours or channels for pixels within a key range."

Inverts the RGB channels (or selected channels) of pixels whose key value falls inside a threshold band, creating solarisation, negative-band highlights, and false-colour contours.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `selectKey` | Selection key | enum | `luma` | the 8 keys of section 5.3 | Selection | always |
| `threshold` | Threshold range | range | [0.50, 1.00] | 0..1, step 0.001 | Selection | always |
| `invertSelection` | Invert selection | boolean | false | | Selection | always |
| `channels` | Target channels | enum | `rgb` | `rgb` "RGB", `red` "Red", `green` "Green", `blue` "Blue" | Output | always |

- **Behavior:** Uses exact `key16` from section 5.3 and `lo16`, `hi16` from section 5.4. `selected = (lo16 <= key16(p) <= hi16) !== invertSelection` (alpha 0 never selected). For selected pixels, replace target channel(s) with `255 - c`; unselected pixels and alpha are copied unchanged.
- **Selection debug view:** Lists `debugViews: ['selection']`. Unselected pixels darkened via `c >> 2`.
- **Determinism & locality:** Fully deterministic, no seed. Pure per-pixel. Cost class: Low.
- **Provenance:** Classic Sabattier solarisation / threshold inversion. Clean-room own implementation.

#### 11. `jpegCrush` (version 1, `glitch`): "Simulate heavy JPEG macroblock quantisation and byte-bend glitches."

Runs a deterministic integer 8×8 block transform and aggressive quantisation directly on the RGBA image buffer (with optional deterministic block-coefficient corruption and chroma subsampling), producing repeatable JPEG-artifact amplification and data-bend-style colour blocks without relying on browser JPEG encoders.

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `blockSize` | Block size | integer (px) | 8 | 4..64 | Blocks | always |
| `quality` | Crush quality | integer | 12 | 1..100 | Quantise | always |
| `chromaSubsample` | Subsample chroma | boolean | true | | Quantise | always |
| `corruptRate` | Block corruption | number (ratio) | 0.05 | 0..0.50, step 0.01 | Data bend | always |
| `corruptShift` | Corruption strength | number (ratio) | 0.50 | 0..1, step 0.01 | Data bend | `corruptRate` ≠ 0 |
| `seed` | Seed | seed | random | uint32 | Seed | `corruptRate` ≠ 0 |

- **Behavior:** Operates on source-aligned blocks of size `B = ctx.pxLength(blockSize)` (default 8 source px):
  1. Convert RGB to integer YCbCr (`Y = floorDiv(299*R + 587*G + 114*B + 500, 1000)`, `Cb = clamp(128 + floorDiv(-169*R - 331*G + 500*B + 500, 1000), 0, 255)`, `Cr = clamp(128 + floorDiv(500*R - 419*G - 81*B + 500, 1000), 0, 255)`).
  2. If `chromaSubsample` is true, average `Cb` and `Cr` over each `max(2, floorDiv(B, 2))` sub-block.
  3. Apply a fixed-point integer 2D 8×8 Haar or integer-DCT-approximation transform on each block (resampled to 8×8 grid when `B !== 8`, or applied on 8×8 sub-tiles), quantise coefficients with a checked-in ITU-T T.81 baseline luminance/chrominance quantisation table scaled by `quality` (using integer arithmetic only, no `Math.cos`), then invert.
  4. If `corruptRate > 0`: for each source block `(bx, by)`, when `unit(seed, 1, bx, by) < corruptRate`, perturb the block's DC `Cb`/`Cr` offsets by `intIn(-s, s, seed, 2|3, bx, by)` where `s = Math.round(corruptShift * 127)` and optionally swap or zero 1 to 3 AC coefficients keyed to `(seed, 4, bx, by)`, creating unmistakable magenta/green data-bend macroblocks.
  5. Convert YCbCr back to RGB with integer arithmetic and copy alpha unchanged.
- **Determinism & locality:** Deterministic via integer tables and `hash32` (purpose codes `1..4`). Whole image (block-aligned). Cost class: Medium. Debug views: none.
- **Provenance:** Standard ITU-T T.81 JPEG baseline quantisation tables (public standard) and data-bending aesthetics. Clean-room own implementation. (Note: true raw-bitstream JPEG corruption remains deferred because browser JPEG decoders vary across engines; pixel-space `jpegCrush` gives identical output across Chromium, Firefox, and Node.)

#### Deferred built-in presets (enabled with F22 top 5)

| Id | Name | Instances |
|---|---|---|
| `builtin:vhs-split` | VHS split | `sliceShift` defaults with seed 7; then `channelShift` defaults |
| `builtin:tile-scramble` | Tile scramble | `blockShuffle` `tileSize` 96, `amount` 0.25, seed 3; then `channelSwap` `gbr` |

### 16.2 iOS canvas-limit decode and export path

Needed when mobile/Safari acceptance is added or when packaging for iOS/macOS with Tauri (which uses WebKit).

iOS Safari invalidates any single canvas over 16,777,216 px and limits total canvas memory to 384 MB (224 MB on older devices) per the research's verified sources.

**Mobile preview caps (later):** phone `drag` starts at 0.5 MP (524,288, down to 0.125 MP), `settle` at 2 MP (2,097,152), `full` up to 24 MP (25,165,824 px) on phones and tablets.

**Tiled decode to an `RgbaImage` at source size (later):**

1. `createImageBitmap(blob, {imageOrientation: 'from-image', colorSpaceConversion: 'default'})`, then copy it out in tiles of at most 4,096 × 4,096 px: draw each tile onto one reused `OffscreenCanvas` of that size, `getImageData`, copy into the big buffer. Release the bitmap with `close()` and shrink the canvas to 1 × 1 afterwards.
2. If step 1 fails for images over the canvas limit, decode per tile with `createImageBitmap(blob, sx, sy, sw, sh, options)`.
3. If that fails for JPEG, decode with a WebAssembly JPEG decoder loaded on demand (candidate `@jsquash/jpeg`).

**Encode above 16,777,216 px on iOS/iPadOS WebKit (later):**

- **PNG (`src/codec/png-writer.ts`):** 8-bit, colour type 2 (RGB) when every alpha is 255, else 6 (RGBA); each row filtered with filter type 1 (Sub); compressed with `fflate` deflate in streaming mode at level 6; standard IHDR, IDAT chunks of at most 1 MiB, IEND; CRC-32 from a 256-entry table. No ancillary chunks (no gamma, ICC, text or time), so files carry no metadata.
- **JPEG:** WebAssembly JPEG encoder loaded on demand (candidate `@jsquash/jpeg`).
- **WebP:** not offered on Safari unless native or via Wasm encoder.

### 16.3 Geometry transforms (F20)

Geometry transforms are non-destructive and stored per project (not inside `EffectStack`), applied **before** the effect stack so every effect operates on the transformed **effective image**.

#### Data model (`src/engine/transform.ts`)

```ts
type RotationDegrees = 0 | 90 | 180 | 270;
type ResizeFilter = 'lanczos3' | 'bilinear' | 'nearest';

type CropRect = {
	readonly x: number; // integer, 0 <= x < orientedWidth
	readonly y: number; // integer, 0 <= y < orientedHeight
	readonly width: number; // integer, 1 <= width <= orientedWidth - x
	readonly height: number; // integer, 1 <= height <= orientedHeight - y
};

type ResizeSpec = {
	readonly width: number; // integer, 1..16384
	readonly height: number; // integer, 1..16384
	readonly filter: ResizeFilter; // default 'lanczos3'
};

type SourceTransform = {
	readonly rotation: RotationDegrees; // clockwise degrees, default 0
	readonly flipX: boolean; // horizontal mirror, default false
	readonly flipY: boolean; // vertical mirror, default false
	readonly crop: CropRect | null; // null = full oriented image
	readonly resize: ResizeSpec | null; // null = cropped dimensions
};
```

`IDENTITY_TRANSFORM` is `{rotation: 0, flipX: false, flipY: false, crop: null, resize: null}`.

#### Canonical order and exact dimensions

Given decoded EXIF-normalized source dimensions `(Ws, Hs)`:

1. **Orientation:** Rotate clockwise by `rotation` (0, 90, 180, or 270), then apply `flipX` (mirror left-right: `x -> Wo - 1 - x`), then `flipY` (mirror top-bottom: `y -> Ho - 1 - y`). Oriented dimensions: `(Wo, Ho) = (rotation === 90 || rotation === 270) ? (Hs, Ws) : (Ws, Hs)`. Pixel mapping is an exact bijection with zero resampling.
2. **Crop:** Extract rectangle `[crop.x, crop.x + crop.width) × [crop.y, crop.y + crop.height)` from oriented pixels. Cropped dimensions: `(Wc, Hc) = crop ? (crop.width, crop.height) : (Wo, Ho)`.
   - **Fixed aspect ratio `a:b` rounding rules:**
     - Initial centred box in `(Wo, Ho)`: if `Wo * b <= Ho * a`, `w = Wo` and `h = clamp(roundHalfAway(Wo * b / a), 1, Ho)`; else `h = Ho` and `w = clamp(roundHalfAway(Ho * a / b), 1, Wo)`. `x = Math.floor((Wo - w) / 2)`, `y = Math.floor((Ho - h) / 2)`.
     - Interactive handle drag with locked `a:b`: anchor the opposite corner/edge, clamp the dragged axis length `d` to available space, compute the paired axis with `roundHalfAway(d * b / a)` (or `a / b`), clamp both to stay inside `[0, Wo] × [0, Ho]` and at least `1 × 1`.
     - Numeric entry: round with `roundHalfAway`, clamp `width` to `[1, Wo]`, `height` to `[1, Ho]`, then clamp `x` to `[0, Wo - width]` and `y` to `[0, Ho - height]`.
3. **Resize:** Resample `(Wc, Hc)` to `(We, He) = resize ? (resize.width, resize.height) : (Wc, Hc)`.
   - **Percent mode:** `w = Math.max(1, roundHalfAway(Wc * percent / 100))`, `h = Math.max(1, roundHalfAway(Hc * percent / 100))`.
   - **Limits:** `1 <= We <= 16384`, `1 <= He <= 16384`, and `We * He <= Math.max(50_000_000, Wc * Hc)`.
   - **Resampling filters (all deterministic, straight-alpha in/out, premultiplied-alpha internally):**
     - `lanczos3` (default): separable horizontal-then-vertical 3-lobe Lanczos filter (`a = 3`), reading kernel weights from a checked-in 1,024-entry lookup table on `[0, 3]` (generated by a script so no `Math.sin` runs at render time, rule 3 of section 1). When downscaling by factor `r = dst / src < 1`, widen support to `3 / r` to prevent aliasing. Premultiply RGB by alpha before filtering, clamp sums to `[0, 255]`, and unpremultiply afterwards.
     - `bilinear`: uses exact `boxDownscale` (`src/engine/resample.ts`) when downscaling on both axes (`We <= Wc && He <= Hc`), and premultiplied-alpha bilinear interpolation with exact pixel-centre mapping `sx = (dx + 0.5) * Wc / We - 0.5` otherwise.
     - `nearest`: `sx = Math.min(Wc - 1, Math.floor((dx + 0.5) * Wc / We))`, `sy = Math.min(Hc - 1, Math.floor((dy + 0.5) * Hc / He))`, copying all four channels unchanged.

#### Pipeline, proxy, stage cache, and effect-parameter interaction

- **Where it runs:** Before `renderStack`. `effectiveDimensions(Ws, Hs, transform)` returns `(We, He)`. `renderStack` receives `sourceWidth: We, sourceHeight: He`.
- **Preview worker (`src/worker/preview.worker.ts`):** `loadSource` and a new `setTransform` message receive `transform: SourceTransform`. When `crop` is null and `resize` is null (identity or rotate/flip only), the worker may decode at `settle` cap and apply rotate/flip directly. When `crop` or `resize` is set, the worker decodes at a resolution sufficient to yield the full `settle` proxy (up to 4 MP of `(We, He)`), applies `applyTransform`, derives `drag` via `boxDownscale`, returns the transformed `settle` bitmap as `original` (so Compare and Split align 1:1 with the edited result), and clears the stage cache.
- **Stage cache (`src/engine/pipeline.ts`):** `sourceKey` passed to `renderStack` becomes `${sourceHash}:${canonicalJson(transform)}` so two different crops with identical `(We, He)` never collide in the cache.
- **Export worker (`src/worker/export.worker.ts`):** `export` and `renderFull` receive `transform: SourceTransform`. Export decodes full source, applies orientation and crop, then resizes directly to `renderSize(We, He, exportScale)` using `transform.resize?.filter ?? 'lanczos3'` (avoiding double resampling when both `transform.resize` and `exportScale < 1` are active), and runs `renderStack` with `sourceWidth: We, sourceHeight: He`.
- **Effect parameters with `unit: 'px'`:** Stored unchanged in effective-image pixels. Cropping or resizing never rewrites effect parameters.

### 16.4 Extended format support (F21)

#### Current state (`v0.1.0`)

- **Import (`src/codec/decode.ts`):** Calls `createImageBitmap(blob, {imageOrientation: 'from-image', colorSpaceConversion: 'default'})`. No bundled decoders.
- **Export (`src/codec/encode.ts`):** Calls `OffscreenCanvas.convertToBlob` for `image/png`, `image/jpeg` (alpha flattened onto white via `flattenAlphaForJpeg`), and `image/webp` (gated on startup `probeSupportedEncodeFormats`).

#### Candidate format matrix (verified 2026-11-25)

Target browsers: Chrome/Edge 120+, Firefox 128+ (desktop). Sources: MDN Image file type and format guide (`developer.mozilla.org`), WHATWG HTML `ImageBitmap` specification (`html.spec.whatwg.org`), MDN `OffscreenCanvas.convertToBlob`, Can I use (`caniuse.com`), `docs/research/engine-architecture.md` section 5, npm/GitHub package registries (`@jsquash/avif`, `photopea/UTIF.js` / `utif2`, `libheif-js`, `heic2any`, `LibRaw`, `dcraw`).

| Format | Native decode (Chrome 120+ / Firefox 128+) | Native canvas encode (`convertToBlob`) | Bundled codec option, size, and licence | Decision for `v0.2.0` |
|---|---|---|---|---|
| **AVIF** (`image/avif`) | Yes (Chrome 85+, Firefox 93+) | No (both silently fall back to `image/png`) | `@jsquash/avif` (`libavif` + `libaom` Wasm), **~3.3 MB** `.wasm` uncompressed, **Apache-2.0** (MIT-compatible) | **Accept:** native import (test in CI) + lazy-loaded Wasm export |
| **BMP** (`image/bmp`) | Yes (Chrome & Firefox) | No (falls back to `image/png`) | Own pure-TS 24/32-bit BI_RGB writer, **~1 KB**, 0 deps, **MIT** | **Accept:** native import + own pure-TS export |
| **TIFF** (`image/tiff`) | No (Safari only) | No | `utif2` (`photopea/UTIF.js`), **~25 to 30 KB gzipped** (~95 KB raw), 0 deps, **MIT** | **Accept:** lazy-loaded `utif2` import (first IFD, 16-bit -> 8-bit) and uncompressed RGBA export |
| **GIF first frame** (`image/gif`) | Yes (first frame per HTML spec) | No | None needed for still import; palette GIF export deferred to Motion | **Accept import (native first frame); refuse still GIF export** |
| **Animated inputs** (GIF, WebP, APNG, AVIF) | First frame only via `createImageBitmap` (HTML spec) | No | Full multi-frame decode deferred to Motion milestone | **Accept first frame with notice toast; refuse animation editing** |
| **SVG rasterised** (`image/svg+xml`) | Unreliable via `createImageBitmap(blob)` in Chrome; works via main-thread `<img>` -> canvas | No | Main-thread `<img>` rasteriser (~50 lines, 0 deps, **MIT**; browser blocks scripts and external fetches in `<img>` SVGs) | **Accept import (rasterise to PNG blob on import); refuse SVG export** |
| **HEIC / HEIF** (`image/heic`, `image/heif`) | No (Safari 17+ only; HEVC patent-encumbered) | No | `libheif-js` (**LGPL-3.0**, ~756 KB gzip / ~3 MB min); `heic2any` (MIT wrapper over LGPL `libheif`, compliance risk) | **Refuse:** licence incompatibility (`docs/agents/licensing.md`), HEVC patents, heavy Wasm |
| **RAW camera** (`.dng`, `.cr2`, `.cr3`, `.nef`, `.arw`, `.raf`) | No | No | `dcraw` (**GPL-2.0+**); `LibRaw` Wasm (**LGPL-2.1 / CDDL-1.0**, ~150 to 250 KB gzip); requires RAW development | **Refuse:** licence incompatibility + RAW development is a non-goal (`product.md` §8) |

#### Codec architecture changes for `v0.2.0`

- `src/codec/decode.ts`: detect TIFF magic bytes (`0x49 0x49 0x2A 0x00` or `0x4D 0x4D 0x00 0x2A`) and dynamically `import('utif2')` in the worker; convert 16-bit samples to 8-bit via `v >>> 8`. Detect HEIC (`ftypheic`/`ftypheix`/`ftypmif1`) and common RAW extensions/headers before `createImageBitmap` so the user gets the specific refusal message instead of a generic decode error. Detect animated GIF/WebP/APNG/AVIF headers on import to trigger the first-frame toast.
  - **Refusals** are decided before `createImageBitmap`, after the file size limit. RAW: the extension is `.dng`, `.cr2`, `.cr3`, `.nef`, `.arw`, `.raf`, `.orf`, or `.rw2` (case-insensitive), or the header is CR2 (`II*\0` then `CR` at offset 8), CR3 (`ftyp` brand `crx `), RAF (`FUJIFILMCCD-RAW`), ORF (`IIRO`, `IIRS`, `MMOR`), or RW2 (`IIU\0`). TIFF-based DNG, NEF, and ARW are recognised by extension only. HEIC/HEIF: the extension is `.heic` or `.heif`, or the `ftyp` major brand is `heic`, `heix`, `heim`, `heis`, `hevc`, `hevx`, `hevm`, or `hevs`, or the major brand is `mif1` or `msf1` and no brand is `avif` or `avis` (AVIF files may use `mif1` as major brand and must import).
  - **Animation** is read from the file's content, never its name: GIF with at least two image blocks, PNG with an `acTL` chunk before `IDAT` declaring more than one frame, WebP with the `VP8X` animation flag, AVIF with the `avis` brand. A truncated or malformed header counts as not animated and the file goes on to the browser decoder. The notice is shown once per stored file, after it is saved.
- `src/features/import/`: detect `image/svg+xml` (or `.svg`), rasterise on the main thread via `HTMLImageElement` + `<canvas>` (default longest side 2,048 px when no intrinsic pixel size exists, clamped to 16,384 px and 50 MP), and store the resulting PNG `Blob` in `sources`.
  - **Detection:** the MIME type is `image/svg+xml` or the extension is `.svg` (case-insensitive). The 200 MB file limit applies before the file is read.
  - **Size:** `width` and `height` on the root element count when they are positive absolute lengths (unitless, `px`, `pt`, `pc`, `in`, `cm`, `mm`, `Q`, converted at 96 px per inch). With both, they are the pixel size. With one and a `viewBox`, the other follows the `viewBox` aspect ratio. With neither, the `viewBox` is scaled (up or down) to a longest side of 2,048 px. Without a `viewBox`, a missing side takes the browser's default viewport (300 wide, 150 high), which also stands in for the `viewBox`.
  - **Cap:** a size over 16,384 px per side or 50 MP is scaled down to fit both, keeping the aspect ratio to the nearest whole pixel (an added `viewBox` stretches to fill it), so the large-image dialog never appears for an SVG.
  - **Rasterise:** the file is parsed with `DOMParser` (an inert document), the target size and a missing `viewBox` are written onto the root element, and the result is loaded into an `<img>` from a `data:` URL (Chromium taints the canvas for a `blob:` URL SVG holding a `foreignObject`). The browser's SVG-as-image mode runs no script and loads no external resource, so an SVG that references one renders without it. The file is never inserted into the page. A file that is not well-formed SVG gets the unreadable-format error.
- `src/codec/encode.ts`: extend `ExportFormat` to `'png' | 'jpeg' | 'webp' | 'avif' | 'bmp' | 'tiff'`. `bmp` runs synchronously via `src/codec/bmp-writer.ts`; `tiff` lazy-loads `utif2`; `avif` lazy-loads `@jsquash/avif` in `export.worker.ts` (never imported on the main thread). All three carry zero EXIF/GPS/ICC metadata.

### 16.5 Multi-image blending (`imageBlend`, F26)

#### Architectural choice: `imageBlend` effect vs full layer model

Two designs were evaluated for merging multiple images:

- **Option (a): `imageBlend` effect in the existing stack (recommended).** An `EffectDefinition` (`type: 'imageBlend'`, `version: 1`, `category: 'color'`) references another stored source by its SHA-256 hash and composites it onto the pipeline's current buffer. Preserves the same-size-in, same-size-out contract (`engine.md` §1 rule 4, `src/engine/types.ts`), lets effects run both before and after a blend, supports 3+ images by stacking instances, and reuses the existing stack UI, stage cache, undo history, and presets with minimal additions.
- **Option (b): Full layer model (one effect stack per layer).** Would require replacing `EffectStack` with a multi-layer document tree (`schemaVersion: 2`), rewriting `renderStack` into a multi-pass layer compositor with `N` separate stage caches and `N`-times worker RAM, adding a second hierarchy panel (Layers + per-layer Stack) that crowds the 390 px phone layout, redesigning presets, and contradicting `product.md` §8 ("no general photo editor: no layers").

Option (a) is specified below.

#### New `ParamSpec` kind (`'image'`)

Extend `ParamSpec` (`src/engine/types.ts`) with an 8th kind:

```ts
| {kind: 'image'; default: ''} // 64 lowercase hex SHA-256 referencing a SourceRecord, or '' (none)
```

- `ParamValue` already includes `string`, so `EffectStack` JSON and `canonicalStackJson` require no changes.
- `validateParams` (`src/engine/params.ts`): accepts `''` or a string matching `/^[0-9a-f]{64}$/`; any other value falls back to `''`.
- UI (`src/features/params/`): add `ImageSpec` to `format.ts` (`isDefaultParamValue` returns `value === ''`), add `ImageControl` (`src/features/params/image-control.tsx`), and add `case 'image'` to `ParamControl` (`src/features/params/param-control.tsx`).

#### `imageBlend` effect definition (`src/engine/effects/image-blend.ts`)

`type: 'imageBlend'`, `version: 1`, `category: 'color'`, label `"Image blend"`, description `"Composite another image over the current result with blend mode, fit, and transform."`

| Param | Label | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|---|
| `image` | Blend image | `image` | `''` | 64-char SHA-256 or `''` | Source | always |
| `blendMode` | Blend mode | `enum` | `normal` | `normal` "Normal", `multiply` "Multiply", `screen` "Screen", `overlay` "Overlay", `lighten` "Lighten", `darken` "Darken", `difference` "Difference", `exclusion` "Exclusion", `add` "Add", `subtract` "Subtract" | Blend | always |
| `opacity` | Opacity | `number` (`percent`) | `1` | `0..1`, step `0.01` | Blend | always |
| `fit` | Fit | `enum` | `cover` | `cover` "Cover", `contain` "Contain", `stretch` "Stretch", `tile` "Tile", `none` "Original size" | Placement | always |
| `scale` | Scale | `number` (`percent`) | `1` | `0.1..4`, step `0.01` | Placement | always |
| `offsetX` | Offset X | `number` (`percent`) | `0` | `-1..1`, step `0.01` | Placement | always |
| `offsetY` | Offset Y | `number` (`percent`) | `0` | `-1..1`, step `0.01` | Placement | always |
| `rotation` | Rotation | `angle` | `0` | `[0, 360)`, step `0.1`; snaps `0, 45, 90, 135, 180, 225, 270, 315` | Placement | always |

Note: The universal instance `Blend & Mix` controls (`EffectInstance.blend` and `mix`, AC-F4.7) remain unchanged on every instance; `imageBlend` uses its own `blendMode` and `opacity` parameters so all 10 photographic/glitch blend modes are available without changing AC-F4.7.

#### Blend mode formulas (exact integer arithmetic)

For base channel `i` in `0..255` and overlay channel `f` in `0..255`, `blendChannel(i, f, mode)` returns `b` in `0..255`:

| `blendMode` | Exact integer formula for `b` |
|---|---|
| `normal` | `f` |
| `multiply` | `floorDiv(2 * i * f + 255, 510)` |
| `screen` | `255 - floorDiv(2 * (255 - i) * (255 - f) + 255, 510)` |
| `overlay` | `i < 128 ? floorDiv(4 * i * f + 255, 510) : 255 - floorDiv(4 * (255 - i) * (255 - f) + 255, 510)` |
| `lighten` | `max(i, f)` |
| `darken` | `min(i, f)` |
| `difference` | `abs(i - f)` |
| `exclusion` | `clamp(i + f - floorDiv(4 * i * f + 255, 510), 0, 255)` |
| `add` | `min(255, i + f)` |
| `subtract` | `max(0, i - f)` |

#### Alpha handling (W3C Compositing Level 1, straight-alpha in/out)

Let the base pixel be `(iR, iG, iB, iA)` and the sampled overlay pixel be `(sR, sG, sB, sA)`. Let `op = Math.round(opacity * 100)` (`0..100`) and effective overlay alpha `effA = floorDiv(2 * sA * op + 100, 200)` (`0..255`):

1. If `effA === 0`, copy `(iR, iG, iB, iA)` unchanged.
2. Otherwise compute `outA_num = effA * 255 + iA * (255 - effA)` (`0..65025`) and `outA = floorDiv(2 * outA_num + 255, 510)` (`0..255`).
3. If `outA === 0`, output `(0, 0, 0, 0)`.
4. Otherwise, for each channel `C` in `R, G, B`, let `bC = blendChannel(iC, sC, blendMode)` and `premul = effA * ((255 - iA) * sC + iA * bC) + iA * (255 - effA) * iC`. Output `outC = clamp(floorDiv(2 * premul + outA_num, 2 * outA_num), 0, 255)`.

All intermediate values stay below `2^32`, well within IEEE-754 exact integers (`2^53 - 1`), and match W3C Compositing Level 1 `source-over` with separable blend modes without dark fringing on transparent bases.

#### Placement, rotation, and sampling (deterministic)

Given base render dimensions `(W, H)` (with `ctx.sourceWidth = Ws`, `ctx.sourceHeight = Hs`, `ctx.scale = W / Ws`) and overlay render image `(Ow, Oh)` (with overlay source dimensions `(Ows, Ohs)`):

1. Compute base-to-overlay fit scale `(fx, fy)` in render pixels:
   - `cover`: `s = max(W / Ow, H / Oh)`, `fx = s`, `fy = s`.
   - `contain`: `s = min(W / Ow, H / Oh)`, `fx = s`, `fy = s`.
   - `stretch`: `fx = W / Ow`, `fy = H / Oh`.
   - `tile` or `none`: `fx = (ctx.scale * Ows) / Ow`, `fy = (ctx.scale * Ohs) / Oh` (1:1 source-pixel scale regardless of proxy level).
2. Apply user `scale`: `sx = fx * scale`, `sy = fy * scale`.
3. Overlay centre in render pixels: `cx = W / 2 + offsetX * W`, `cy = H / 2 + offsetY * H`.
4. Rotation angle `a = wrap(Math.round(rotation * 10), 3600)` reads `(DX, DY) = DIRECTION_TABLE[a]` (`src/engine/direction-table.ts`; `cos = DX / 4096`, `sin = -DY / 4096`, zero `Math.sin`/`Math.cos` calls).
5. For each output pixel `(x, y)`:
   - Relative offset `dx = (x + 0.5) - cx`, `dy = (y + 0.5) - cy`.
   - Inverse rotate: `rx = dx * cos + dy * sin`, `ry = -dx * sin + dy * cos`.
   - Overlay sample coordinate: `ux = rx / sx + Ow / 2 - 0.5`, `uy = ry / sy + Oh / 2 - 0.5`.
   - If `fit === 'tile'`: wrap `ux` into `[0, Ow)` and `uy` into `[0, Oh)` with `wrap`.
   - Else if `ux < -0.5 || ux > Ow - 0.5 || uy < -0.5 || uy > Oh - 0.5`: sampled pixel is `(0, 0, 0, 0)` (transparent, leaves base unchanged).
   - Otherwise sample `(ux, uy)` with premultiplied-alpha bilinear interpolation (clamping edge taps to `[0, Ow - 1] × [0, Oh - 1]`, or wrapping taps when `fit === 'tile'`).

#### Pipeline, worker protocol, proxies, and stage cache

- **Context and pipeline (`src/engine/types.ts`, `src/engine/pipeline.ts`):**
  - `PipelineOptions` adds `extraSources?: ReadonlyMap<string, RgbaImage>` (keyed by `sha256`).
  - `RenderContext` adds `getSource(sha256: string): RgbaImage | undefined`.
  - `PipelineWarning['code']` adds `'missing-source'`. When `imageBlend` has a non-empty `params.image` that `ctx.getSource` cannot resolve, it copies `input` to `output` unchanged and the pipeline records `{instanceId, code: 'missing-source'}`.
- **Stage cache (`src/engine/pipeline.ts`):** `stageCacheKey` already hashes `canonicalStackJson(enabledPrefix)`, which contains `params.image` (an immutable content-addressed SHA-256). When `preview.worker.ts` finishes loading an extra source, it calls `cache.clear()` so any earlier render that saw `'missing-source'` is invalidated.
- **Preview worker (`src/worker/protocol.ts`, `src/worker/preview.worker.ts`):**
  - `PreviewRequest` adds `{type: 'loadExtraSource'; requestId: number; sha256: string; blob: Blob; width: number; height: number}` and `{type: 'unloadExtraSource'; sha256: string}`.
  - `PreviewResponse` adds `{type: 'extraSourceLoaded'; requestId: number; sha256: string}`.
  - Each extra source is stored in the preview worker as a `settle` proxy (capped at `SETTLE_PIXEL_CAP` = 4 MP) and a `drag` proxy (derived via `boxDownscale` to the active `drag` cap and updated on `setDragCap`). Maximum 8 distinct extra sources per project (`<= 160 MiB` total proxy memory at 4 MP settle + 1 MP drag).
- **Export worker (`src/worker/export.worker.ts`):**
  - `ExportRequest` (`export` and `renderFull`) adds `extraSources?: ReadonlyArray<{sha256: string; blob: Blob; width: number; height: number}>`.
  - Decodes each referenced extra source at `renderSize(width, height, job.scale)` (full size for `renderFull` / `scale === 1`) before `renderStack`, releasing decoded buffers after export completes.
- **Determinism:** Uses only `DIRECTION_TABLE`, exact integer blend/alpha formulas, and deterministic bilinear sampling. Output bytes are identical across runs, browsers, and Node for identical decoded input pixels.
