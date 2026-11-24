Written by Claude Opus 5.5 (Antigravity, thought level high), spec subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.

# PixelSortGUI engine spec

Status: settled for first release, 2026-11-24. Terms are defined in [product.md section 2](product.md#2-terms). Storage of everything described here is in [persistence.md](persistence.md).

## 1. Scope and rules

The engine turns a source image and an effect stack into an output image. It is plain TypeScript with no DOM, React or browser storage dependencies, so it runs unchanged in a Web Worker, in Node (tests, benchmarks) and later in a native shell.

Rules every part of the engine follows:

1. **Own implementation.** Every algorithm here is described in our own words and formulas. Do not copy or translate code from pxlsort (no licence), pixel-sorter or rkargon/pixelsorter (GPL-3.0), or any of the unlicensed projects in the research. Implementers work from this file, not from those repositories.
2. **Pure effects.** An effect's output depends only on its input pixels, its parameters and the render context. No `Math.random`, `Date`, `performance.now` (except for the time-slice check in section 8.4), global state or I/O.
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

Canonical form: `canonicalStackJson(stack)` serialises with object keys sorted alphabetically at every level and numbers in shortest round-trip form. It is used as a cache key (section 8.5) and for equality in tests.

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
		| {kind: 'seed'} // uint32; a new instance gets a random seed from crypto.getRandomValues
	);
```

Rules:

- `unit: 'px'` means the value is in source-image pixels and the effect must convert it with `ctx.px` or `ctx.pxLength`.
- Numbers are stored rounded to their `step` (angles to 0.1). Integers are stored as integers.
- `validateParams(spec, params)` returns a complete, valid parameter object: missing keys get the default, values of the wrong type get the default, numbers are clamped to `[min, max]` and rounded to `step`, enums not in `options` get the default, ranges are clamped and swapped if `lo > hi`, angles are normalised with `wrap(round(a * 10), 3600) / 10`, seeds are converted with `>>> 0`. Unknown keys are dropped. The pipeline always validates before calling `render`.
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

- `input` and `output` have the same width and height and do not share memory. `render` reads `input` and writes every byte of `output`. It never writes `input`.
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
   3. Migrate parameters if the instance `version` is lower (section 4.4), then `validateParams`.
   4. Build the context (`scale = renderWidth / sourceWidth`, `seed = params.seed ?? 0`, `debugView` from `options.debug` when it names this instance, else `'none'`).
   5. `output` = whichever of `a`, `b` is not `current`. Call `render(current, output, params, ctx)`.
   6. If `debugView` is `'none'` and (`mix < 1` or `blend !== 'normal'`), composite in place: `output = composite(current, output, mix, blend)` (section 4.5).
   7. `current = output`.
   8. If this instance is the debug instance, stop here: later instances are not applied, so the selection view shows exactly this instance's selection.
3. Return `current` (copied out if it is a working buffer that will be reused).

Progress is reported as `(completedInstances + instanceFraction) / enabledInstanceCount`.

### 4.4 Versions and migration

- An effect type's `version` starts at 1. Bump it when a parameter is added, removed, renamed, its range or meaning changes, or when the output for the same parameters changes.
- `migrations[n]` converts parameters of version `n` to version `n + 1`. The pipeline applies them in sequence from the instance's `version` to the definition's `version`. Migrations are pure and idempotent with respect to their input.
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

Mix and blend are applied against the instance's own input at the same render size, so they work at every level (this avoids the scale mismatch the research found in pixel-sorter's blending).

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

| Param | Kind | Default | Range or options | Group | Visible when |
|---|---|---|---|---|---|
| `angle` | angle | 0 | [0, 360), step 0.1; snaps 0, 45, 90, 135, 180, 225, 270, 315 | Direction | always |
| `intervalMode` | enum | `threshold` | `threshold` "Threshold", `edges` "Edges", `whole` "Whole line" | Selection | always |
| `selectKey` | enum | `luma` | the 8 keys of section 5.3 | Selection | `intervalMode` = `threshold` |
| `threshold` | range | [0.25, 0.80] | 0..1, step 0.001 | Selection | `intervalMode` = `threshold` |
| `edgeThreshold` | number (ratio) | 0.20 | 0..1, step 0.01 | Selection | `intervalMode` = `edges` |
| `edgeBlur` | integer (px) | 1 | 0..8 | Selection | `intervalMode` = `edges` |
| `invert` | boolean | false | | Selection | `intervalMode` ≠ `whole` |
| `maxLength` | integer (px) | 0 | 0..16384; 0 means no limit | Length | always |
| `lengthJitter` | number (ratio) | 0 | 0..1, step 0.01 | Length | `maxLength` ≠ 0 |
| `skipChance` | number (ratio) | 0 | 0..1, step 0.01 | Length | always |
| `sortKey` | enum | `luma` | the 8 keys of section 5.3 | Order | always |
| `order` | enum | `ascending` | `ascending`, `descending`, `shuffle`, `random` ("Random direction") | Order | always |
| `discretize` | integer | 0 | 0..64 | Order | `fill` ≠ `average` |
| `fill` | enum | `sort` | `sort` "Sort", `average` "Average", `gradient` "Gradient" | Output | always |
| `seed` | seed | random | uint32 | Seed | always |

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

- A pixel with alpha 0 is never selected, in every mode.
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

Implementation hint: build a `Uint32Array` of `c * 65536 + localIndex` (local index < 65,536 because lines are at most 16,384 px), sort it with the built-in numeric typed-array sort, and read local indices from the low 16 bits. Values are unique, so the result equals a stable sort on every engine. For `n <= 24`, insertion sort on the same values is faster.

**Fill.**

- `sort`: write the ordered pixels back into the interval's positions in line order. All four channels move together. The output of the interval is a permutation of its input.
- `average`: every pixel of the interval becomes the channel-wise mean, `floorDiv(2 * sum + n, 2 * n)` for each of R, G, B, A. Order and discretize do not affect it.
- `gradient`: order the pixels as above, take the first ordered pixel `s` and the last `e`, and set pixel `j` (0-based in line order) of the interval to `floorDiv(2 * (s * (n - 1 - j) + e * j) + (n - 1), 2 * (n - 1))` per channel. Output colours are interpolated and are not a permutation.

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

| Param | Kind | Default | Range | Group |
|---|---|---|---|---|
| `redX`, `redY` | integer (px) | 6, 0 | −1024..1024 | Red |
| `greenX`, `greenY` | integer (px) | 0, 0 | −1024..1024 | Green |
| `blueX`, `blueY` | integer (px) | −6, 0 | −1024..1024 | Blue |
| `edge` | enum | `clamp` | `clamp` "Stretch edge", `wrap` "Wrap around" | Edges |

For channel `c` with offset `(dx, dy) = (ctx.px(cX), ctx.px(cY))`: `out.c(x, y) = in.c(E(x - dx, W), E(y - dy, H))`, where `E` is `clamp(v, 0, n - 1)` for `clamp` and `wrap(v, n)` for `wrap`. Positive `X` moves the channel right, positive `Y` down.

### 6.2 Later effects

Three already-specified glitch effects (`sliceShift`, `blockShuffle`, `channelSwap`) are deferred to section 16.1. Additional effects specified when scheduled (product.md section 6): `smear` (carry a colour along a line with per-pixel decay), `waveShift` (sine-modulated row offsets), `posterize`, `dither` (ordered Bayer), `grain`, `dataBend` (corrupts the compressed source bytes and decodes the result; it is a source-level stage, not a pixel effect, and needs its own interface), per-channel pixel sort, and the interval transforms (mirror, splice, fold, grouping equal colours) as new `pixelSort` parameters in a version 2.

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

### 8.3 Scheduling

The main-thread render coordinator (`src/render/coordinator.ts`) owns the preview worker (one project is open at a time) and keeps a monotonically increasing `generation` number.

- Every change of the effective stack (including uncommitted slider values) or of the debug view increments `generation`.
- While a control is being dragged: send a `drag` render of the newest stack whenever no `drag` render is in flight. Intermediate values that arrive while one is in flight are coalesced; only the newest is sent next. There is never more than one in-flight request per level.
- When the control is released, or 150 ms pass without a change: send a `settle` render of the newest stack.
- On a `settle` result, if the view shows the image at more than 1.25 device pixels per `settle` proxy pixel and the proxy scale is below 1, wait 500 ms without changes, then request a `full` render (8.6).
- Results whose `generation` is older than the newest result already displayed are dropped. A `settle` result replaces a `drag` result of the same or older generation; a `drag` result never replaces a newer `settle` result.

### 8.4 Cancellation

A worker cannot read new messages while a synchronous loop runs, and `SharedArrayBuffer` flags need cross-origin isolation, which the app does not require (decision D6). So:

- **Preview worker: cooperative time slicing.** `ctx.checkpoint()` checks `performance.now()`; once 8 ms have passed since the last yield, it yields to the event loop with a `MessageChannel` round trip (no 4 ms timer clamp), during which `render` and `cancel` messages are processed. If the running job's generation is now older than the newest requested generation, `checkpoint` throws `Cancelled`, the pipeline discards its work and the worker starts the newest request. Expected overhead: under 3% of render time.
- **Export worker: termination.** Exports and `full` renders run in a separate worker. Cancelling terminates it with `worker.terminate()`; a fresh worker is created for the next job.

### 8.5 Stage cache

The preview worker caches pipeline stage outputs so editing instance `j` re-renders only instances `j` and later. Key for the output after instance `i`: `level + ':' + width + 'x' + height + ':' + sourceKey + ':' + canonicalStackJson(enabled prefix 0..i)`. The cache holds at most 6 entries or 160 MB, whichever is smaller, evicting least recently used. It is cleared when the source or render size changes. Debug renders do not write to the cache.

### 8.6 Progressive refinement

1. `drag` while moving (fast, coarse), 2. `settle` after the control stops (sharp at normal zoom), 3. `full` when the user zooms past the `settle` proxy's resolution. The `full` result is sent to the main thread as tiles of at most 2,048 × 2,048 px as `ImageBitmap`s and drawn per visible tile. Only one `full` result is kept; any stack change discards it.

## 9. Performance budgets

Unbenchmarked engineering targets, not measurements: spike S1 (roadmap.md) measures them on the reference laptop; misses are reported with numbers. Reference device: product.md section 8 (desktop laptop only in the first release). Workload unless stated: one `pixelSort` instance with defaults at angle 0, on a representative 4:3 JPEG photo.

| Measure | Reference laptop (unbenchmarked target) |
|---|---|
| `drag` render at its starting cap (1 MP), p95 | ≤ 50 ms |
| Visible update after a change (input to pixels on screen), p95 | ≤ 100 ms |
| `settle` render (4 MP), p95 | ≤ 300 ms |
| Same, angle 30 | ≤ 1.5× the angle-0 time |
| `pixelSort` kernel throughput, angle 0, single thread | ≥ 25 MP/s |
| Project open: decode + first `settle` render, 12 MP source | ≤ 1.0 s |
| Export 12 MP, PNG, full size, including decode and encode | ≤ 2 s (engineering target, not yet benchmarked) |
| Export 24 MP, same | ≤ 5 s |
| Export 50 MP, same | ≤ 12 s |
| Main-thread long tasks during any render | none over 50 ms |
| Peak worker memory for a `full` render of `P` pixels | ≤ `3 × 4P + 2P` bytes plus encoder output |

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
- Random keys use source-space ids (`ctx.toSource` of line indices and positions, source tile and slice indices), so a choice made for a region at the `settle` level is the same choice the export makes for that region.
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
3. `pixelSort` with angle `θ` and `ascending` equals angle `θ + 180` with `descending` when all keys in the image are distinct.
4. Every effect: output size equals input size; input buffer is unchanged after `render`; rendering twice gives identical bytes; `mix = 0` returns the input exactly.
5. `channelShift` with all offsets 0 is the identity.
6. Stack: `JSON.parse(JSON.stringify(stack))` renders identically; `validateParams` is idempotent; migrations of every version produce parameters that pass validation.

### 14.4 Benchmarks

`vp run bench` runs the kernels in Node on synthetic 12 MP and 24 MP images and prints MP/s per effect and angle. A browser benchmark page (`/bench.html`, built only in dev) runs the same in a worker and reports p50 and p95 for spikes and release checks. CI runs benchmarks for information only; timing never fails CI.

## 15. Module layout

```
src/engine/            pure TypeScript, no DOM
  types.ts             RgbaImage, EffectStack, EffectInstance, ParamSpec, RenderContext
  params.ts            validateParams, defaults, migration runner
  registry.ts          createRegistry
  pipeline.ts          renderStack, StageCache
  composite.ts         mix and blend
  random.ts            mix32, hash32, unit, intIn
  keys.ts              the 8 keys
  lines.ts             line partition
  direction-table.ts   generated, checked in
  resample.ts          box downscale for the drag proxy and masks
  effects/index.ts     the registered list
  effects/pixel-sort/  index.ts, select.ts, edges.ts, fill.ts
  effects/channel-shift.ts
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

## 16. Later

Specifications preserved here for deferred work. None of section 16 is implemented in the first release.

### 16.1 Deferred glitch effects

#### `sliceShift` (version 1, glitch): "Shift random bands of the image sideways."

| Param | Kind | Default | Range | Group |
|---|---|---|---|---|
| `axis` | enum | `horizontal` | `horizontal` "Rows", `vertical` "Columns" | Slices |
| `sliceMin` | integer (px) | 4 | 1..2048 | Slices |
| `sliceMax` | integer (px) | 48 | 1..2048 | Slices |
| `probability` | number (ratio) | 0.3 | 0..1, step 0.01 | Slices |
| `maxOffset` | integer (px) | 80 | 0..4096 | Offset |
| `edge` | enum | `wrap` | `wrap`, `clamp` | Offset |
| `seed` | seed | random | | Seed |

Slices are defined in source space so the preview and export match. For `horizontal`, slices partition source rows `0..Hs-1` (for `vertical`, swap rows and columns, and `x` and `y` below). Let `lo = sliceMin`, `hi = max(sliceMin, sliceMax)`. Starting at `y0 = 0` with `i = 0`: slice `i` covers source rows `[y0, y0 + h)` with `h = intIn(lo, hi, seed, 1, i)`; it is active when `unit(seed, 2, i) < probability`; its offset is `o = intIn(-maxOffset, maxOffset, seed, 3, i)` when active, else 0; then `y0 += h`, `i += 1`, until `y0 >= Hs`.

Render: for render row `y`, find the slice containing `ys = clamp(ctx.toSource(y), 0, Hs - 1)`, let `or = ctx.px(o)`, and set `out(x, y) = in(E(x - or, W), y)` for all four channels, with `E` as in 6.1.

#### `blockShuffle` (version 1, glitch): "Swap square tiles around the image."

| Param | Kind | Default | Range | Group |
|---|---|---|---|---|
| `tileSize` | integer (px) | 64 | 4..1024 | Tiles |
| `amount` | number (ratio) | 0.15 | 0..1, step 0.01 | Tiles |
| `seed` | seed | random | | Seed |

Source grid: `T = tileSize`, `cols = floor(Ws / T)`, `rows = floor(Hs / T)`, `N = cols * rows` full tiles; the right and bottom remainders never move. If `N < 2`, output equals input. Permutation `π` starts as the identity; for `t` from 0 to `N - 1`, if `unit(seed, 1, t) < amount`, swap `π[t]` and `π[intIn(0, N - 1, seed, 2, t)]`.

Render pixel `(x, y)`: `xs = (x + 0.5) / scale`, `ys = (y + 0.5) / scale`, `tx = floor(xs / T)`, `ty = floor(ys / T)`. If `tx < cols` and `ty < rows`: `t2 = π[ty * cols + tx]`, `xs2 = xs + (t2 % cols - tx) * T`, `ys2 = ys + (floor(t2 / cols) - ty) * T`, and `out(x, y) = in(clamp(floor(xs2 * scale), 0, W - 1), clamp(floor(ys2 * scale), 0, H - 1))`. Otherwise `out(x, y) = in(x, y)`. At scale 1 this is an exact tile swap.

#### `channelSwap` (version 1, color): "Swap the red, green and blue channels."

One parameter `order`, enum, default `gbr`, options `rgb`, `rbg`, `grb`, `gbr`, `brg`, `bgr`. The three letters name the input channel written to output R, G and B: `gbr` means `outR = inG`, `outG = inB`, `outB = inR`.

#### Deferred built-in presets

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
