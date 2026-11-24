Written by deepseek-flash (thinking medium), research subagent.

# Pixel sorting ecosystem survey

Feature and technique catalogue for 10 open source pixel sorting projects, written to inform
what a browser based glitch and pixel sort editor should offer. Two projects,
`notlauren/pxlsort` and `Krzysztofz01/pixel-sorter`, are covered by another agent and are out
of scope here.

## Method and what the markers mean

Every repository below was cloned shallow (`git clone --depth 1`) into `/tmp/psurvey` and read
from disk: READMEs, docs, and the sorting source itself. Licence metadata was checked both
against the file in the repo and against GitHub's licence detector through the API.

Two markers are used, and nothing below is presented without one of them:

- **[read]** means the statement comes from a file I read (README, source, licence).
- **[inferred]** means my own conclusion from reading the code, or general knowledge about the
  technique. Nothing in this document was produced by running any of the projects on an image,
  except one JavaScript comparator behaviour noted in section 6, which was checked by
  evaluating the exact constants in Node.

Repo states at the time of survey (GitHub API, `stargazers_count`):

| Repo | Licence | Stars | Last push |
|---|---|---|---|
| satyarth/pixelsort | MIT | 877 | 2026-09-03 |
| jeffThompson/PixelSorting | none on GitHub; README claims CC BY-NC-SA 3.0 | 423 | 2020-10-01 |
| kimasendorf/ASDFPixelSort | none | 659 | 2022-05-09 |
| GarrettGunnell/Pixel-Sorting | MIT | 241 | 2023-09-16 |
| DavidMcLaughlin208/PixelSorting | none | 118 | 2022-02-19 |
| julescarbon/sortpixels.js | none | 110 | 2012-10-06 |
| czycha/pxlsrt | MIT | 123 | 2018-04-09 |
| rkargon/pixelsorter | GPL-3.0 | 109 | 2023-10-04 |
| ruccho/BitonicPixelSorter | MIT | 113 | 2026-06-07 |
| DenizBicer/Pixel-Sorting | none | 67 | 2023-05-13 |

All ten repositories were accessible. None was skipped.

---

## 1. satyarth/pixelsort (Python)

**Licence:** MIT, Copyright (c) 2015 satyarth **[read]**

**What it is:** the reference Python implementation and CLI (`python3 -m pixelsort img.jpg
[opts]`) plus an importable `pixelsort()` function. Uses Pillow. This is the de facto baseline
that later tools compare against, and the one DavidMcLaughlin208 benchmarks against. **[read]**

**Interval selection modes** (`-i`, all in `pixelsort/interval.py`) **[read]**:

| Mode | Behaviour |
|---|---|
| `threshold` (default) | Per row, records the x positions of pixels whose HSL lightness is outside `[lower, upper]`. Those positions become the split points, so only in-range runs are sorted. |
| `edges` | Pillow `ImageFilter.FIND_EDGES`, then any pixel darker than `lower_threshold * 255` in the edge map becomes a split point. |
| `random` | Walks the row adding `int(char_length * random())` each step; the accumulated positions are the split points, so the width distribution is linear up to `char_length`. |
| `waves` | Fixed step of `char_length + randint(0, 10)`, giving near-uniform bands with slight jitter. |
| `file` | Split points come from a supplied black and white image of the same size. |
| `file-edges` | Edge detection run on the supplied image instead of the input. |
| `none` | No split points: each full row is one span, stopping only at image borders. |

**Sort keys** (`-s`, `pixelsort/sorting.py`) **[read]**: `lightness` (HSL L, default), `hue`
(HSL H), `saturation` (HSL S), `intensity` (r+g+b), `minimum` (min of r, g, b). All are wrapped
in `functools.cache`, which is a cheap and effective optimisation: the key is computed once per
distinct pixel value, not once per pixel.

**Direction / path:** one angle only. `-a <degrees>` rotates the image with PIL
`rotate(angle, expand=True)`, sorts rows, then rotates back with `-angle` and centre crops with
`crop_to()`. **[read]** The mask image is rotated the same way with `fillcolor=0`, and the
interval image too. **[read]**

Consequence worth knowing: the rotation resamples the whole image twice per sort, so a non-zero
angle costs two interpolations and the untouched regions are not bit-identical. **[inferred]**

**Mask support:** `-m <image>`, any image, converted to mode `1`. Masked-out pixels are excluded
from the interval and then written back unchanged, so the mask acts per pixel rather than per
span. **[read]** Note the ordering in `sort_image`: the mask is applied while collecting the
span, so a mask edge does not break a span, it punctures it. **[inferred]**

**Notable parameters:** `-r randomness` (percentage of spans left unsorted), `-c char_length`,
`-t lower`, `-u upper`, `-l log level`.

**Techniques worth copying:**

- Two-pass recipe documented in the README for reproducing Kim Asendorf's look: sort `-a 90`
  (vertical) first, then sort the result horizontally in default threshold mode. **[read]**
  Worth turning into a one-click "ASDF look" preset. **[inferred]**
- Key memoisation per pixel value (above).
- Interval functions return *split points*, not spans. That representation makes every interval
  mode a one-liner and centralises span construction in the sorter. **[inferred]**

**Quirk to be aware of:** because split points are recorded at the out-of-range pixel and then
used as `interval = [x_min, x_max)`, the boundary pixel starts the next span and can itself be
moved. This differs subtly from the one-sided ASDF behaviour where the boundary pixel stays put.
**[inferred from `sorter.py` and `interval.py`]**

---

## 2. jeffThompson/PixelSorting (Processing, experiments)

**Licence:** no `LICENSE` file. The README says "all code available under Creative Commons
BY-NC-SA license" linking to CC BY-NC-SA 3.0. GitHub's detector reports no licence. **[read]**
Treat as non-commercial plus share-alike, which is stricter than GPL for our purposes (see
section 14).

**What it is:** eight separate Processing sketches, each a different experiment rather than one
tool with modes. Most depend on the toxiclibs colour utilities for non-default sorting. **[read]**

| Sketch | Interval or traversal model | Sort key | Extra parameters |
|---|---|---|---|
| `SeedSorting` | Grows from seeds: edge-detected or random seed pixels, then each step collects the seeds' neighbours, sorts them, and repeats. | packed colour (`sort(color[])`) or hue via toxi | `steps` (2500), `getDiagonal` (4 vs 8 neighbours), `edgeSeed`, `numRandSeeds` (30), `thresh` (0.1), `distThresh` (400), `limitSeeds` |
| `SortImageByLeastResistance` | Path of least colour change: from bottom centre, repeatedly step to whichever of left, up-left, up, up-right, right has the smallest summed-RGB difference. That path is sorted, then shifted one pixel right and repeated across the width. | packed colour | start point |
| `SortImageByNpx` | Treats the image as a flat array and sorts consecutive chunks of N pixels, so chunks wrap across row boundaries. | packed colour | `numPx` (5) |
| `SortImageByNpx_Block` | Same idea in 2D: rectangular `horizBlock x vertBlock` tiles sorted independently. | toxi `clusterSort(BRIGHTNESS, HUE, 12, true)` | block sizes, output resize, optional ffmpeg video |
| `SortPixelPortal` | Sort a column strip of length `dist` downward, then use the last sorted pixel's colour to find a new seed elsewhere within `margin`, and repeat. Tracks traversed pixels. | packed colour | `maxIterations` (2000), `dist` (200), `margin` (50) |
| `SortThroughSeamCarving` | Seam carving: Sobel-style energy map, dynamic programming cumulative sums, walk the lowest energy path from bottom centre, sort that path, shift 1 px, repeat across the width. | packed colour or toxi | reverse, plus rotate-and-iterate variants that rotate 90 degrees between passes |
| `SpiralSortPixels` | Reads the image as concentric rings from the outer edge inward; each ring is one span, sorted, written back in ring order. | packed colour | none |
| `SortByHighestRGBValue` | Not a spatial sort: partitions every pixel by its dominant channel into three arrays, sorts each array, writes back into the original positions of that channel group. | packed colour | none |
| `OtherSortingIdeas` | Notes file only: worst-path seam sorting, channel swapping (r>g, g>b, b>r), "sort red, green and blue separately" (marked done). | n/a | n/a |

**Direction / path:** the traversal model is the experiment. Between sketches you get rows,
columns, 1D chunks with row wrap, 2D blocks, concentric rings, seed-grown regions, and two
different least-energy paths. No angle parameter, no mask, no threshold anywhere in this repo.
**[read]**

**Technique worth copying:** the rotate-90-and-iterate loop.
`SortThroughSeamCarving_RotateAndIterate` loads, sorts, rotates 90 degrees, sorts again,
`numIterations` times, which turns a single pass into a much denser texture. **[read]**
`AutomaticVersions/SeedSorting_AutoIterate` does the same for seeds. This is cheap to implement
and visually strong, so it is a good candidate for a "repeat with rotation" control. **[inferred]**

Also worth noting: `SortByHighestRGBValue` uses `ArrayList<Integer>` rather than Processing's
`append()`, with an inline comment that it turned 15 minutes into 2 seconds. A reminder that the
naive per-pixel array growth pattern is the real performance trap, not the sort itself. **[read]**

---

## 3. kimasendorf/ASDFPixelSort (Processing, the canonical script)

**Licence:** none. No `LICENSE`, no licence statement in the README, GitHub detector reports
none. All rights reserved by default. **[read]**

**What it is:** the 2010 original, one `.pde` file, about 350 lines. This is the algorithm every
other project on this list either reimplements or cites. **[read]**

**Interval selection modes:** four hardcoded modes, selected by an `int mode` **[read]**:

| Mode | Name | Break condition |
|---|---|---|
| 0 | white | sorts runs of pixels whose packed value is `>= whiteValue` (`-12345678`), breaks on darker |
| 1 | black | sorts runs whose packed value is `<= blackValue` (`-3456789`), breaks on brighter |
| 2 | bright | sorts runs whose `brightness()` is `>= brightValue` (`127`) |
| 3 | dark | sorts runs whose `brightness()` is `<= darkValue` (`223`) |

Thresholds are compile-time constants the user is expected to edit by hand. **[read]**

**Sort key:** one only, the numeric colour value via Processing's `sort(color[])`, which is a
signed 32-bit ARGB comparison and therefore effectively sorts by packed RGB with alpha constant.
**[read]**

**Direction / path:** exactly two passes in one run: every column top to bottom, then every row
left to right, inside `draw()` while `frameCount <= loops` (`loops` defaults to 1). **[read]** No
angle, no mask, no path options, no runtime parameters.

**Technique worth copying:** the *semantics of the four modes* are worth preserving as named
presets rather than re-derived, because the community recognises "bright", "dark", "white" and
"black" as distinct looks. Note the asymmetry: white and bright sort everything at or above a
threshold, black and dark sort everything at or below one, and the two families produce visibly
different images on the same photo. **[inferred]**

**What it does not have,** and what that tells us: the most copied pixel sorting script in
existence has no mask, no angle, no band width control and one sort key. Its enduring appeal is
the two-pass rows-plus-columns recipe and four named thresholds. A modern editor should keep
that recipe cheap to reach. **[inferred]**

---

## 4. GarrettGunnell/Pixel-Sorting (Unity, real time)

**Licence:** MIT, Copyright (c) 2023 Garrett Gunnell **[read]**

**What it is:** a Unity built-in render pipeline image effect by "Acerola", written as an honest
attempt at real time pixel sorting with no faking. The README is candid: "The pixel sorting is
legitimate, but in the end, it is not very performant". **[read]** Files:
`Assets/PixelSorter.cs` (MonoBehaviour, parameter surface), `Assets/PixelSorter.compute`
(kernels), `Assets/PixelSorting.cginc` (luminance, hash, RGB and HSL conversions). **[read]**

### How the GPU sort is done

Six dispatch stages per frame **[read]**:

1. `CS_CreateMask`, 8x8 threads. For each pixel, converts to luminance and sets the mask to 1
   when `low <= l <= high`, else 0. Optional `_InvertMask`. Optional per-line random UV offset:
   the sampling position is shifted along the sort axis by
   `hash(seed + frameTime * animationSpeed) * maskRandomOffset`, with one seed per row or
   column, so every line samples a slightly different slice of the source. **[read]**
2. `CS_ClearBuffer`, 8x8, clears the span texture. **[read]**
3. `CS_IdentifySpans`, dispatched with one group per line (`width` or `height` groups of 1x1).
   One thread walks an entire line sequentially, accumulating consecutive mask==1 pixels, and
   writes the span length into an R16F texture at the span's start pixel. A per-span length cap
   `_SpanLimit - hash(seed*seed) * _MaxRandomOffset` is recomputed at each span start, which
   randomises span lengths. **[read]** So span detection is serial per line but parallel across
   lines.
4. `CS_RGBtoSortValue`, 8x8, converts each pixel to a scalar key from R, G, B, or HSL lightness,
   saturation, hue. **[read]**
5. `CS_PixelSort`, dispatched one thread per pixel, but only the thread sitting on a span start
   does any work. That thread copies the span into
   `groupshared half gs_PixelSortCache[1080]`, then runs a selection-sort-like loop: repeatedly
   find min and max in the cache, write them into the two ends of the output, and mark the used
   entries by overwriting them with `2` and `-2`, skipped on later passes by the test
   `v == saturate(v)`. That is O(n^2/2) per span with all comparisons on one thread. **[read]**
6. `CS_Composite`, 8x8, copies sorted pixels back only where mask == 1, applying
   `pow(abs(col), gamma)`. **[read]**

There is also a fixed 512-element bitonic sort kernel (`CS_TestBitonicSort`) and two other test
kernels in the same file, but none of them is used by the pipeline. **[read]**

### What that limits

- **Span length:** hard capped at 1080 pixels by `groupshared half gs_PixelSortCache[1080]` and
  by the inspector range on `maxSpanLength` (0 to 1080). **[read]**
- **Image size:** not capped directly, but every line gets one thread doing a serial scan, and
  each span gets one thread doing a serial O(n^2) sort, so cost grows with span count and span
  length, not with pixel count alone. The author's own conclusion is that it is not viable on a
  low performance budget. **[read]**
- **Correctness detail:** marking used entries with `2` and `-2` depends on no real key ever
  being exactly `2` or `-2` after `saturate()`. Since keys are in `[0, 1]` that holds, but it is
  a fragile pattern to port. **[inferred]**

**Sort keys:** `Red`, `Green`, `Blue`, `Lightness`, `Saturation`, `Hue`. For the mask, always
Rec.601 luminance (`dot(col, 0.299, 0.587, 0.114)`). **[read]**

**Direction / path:** horizontal or vertical only (`_HorizontalSorting`), plus reverse order. No
angle, no diagonals, no arbitrary paths. **[read]**

**Mask support:** the generated threshold mask, invertible, plus debug outputs of the mask and
the spans, plus a span visualisation kernel that paints each span a random flat colour.
**[read]** The span visualisation is a direct answer to "show me what will be sorted", and it is
the most useful debugging affordance in this survey. **[inferred]**

**Notable parameters** (inspector, `PixelSorter.cs`) **[read]**: `lowThreshold` 0.2,
`highThreshold` 0.8, `animateThresholds` with `animationSpeed` (thresholds drift toward a target
over time), `maskRandomOffset` (-0.1 to 0.1 UV), `offsetAnimationSpeed`, `invertMask`, `sortBy`,
`gamma` (0.1 to 10), `horizontalSorting`, `reverseSorting`, `maxSpanLength` (0 to 1080),
`maxRandomSpanOffset` (0 to 512), `useImage` with `image` (sort a still instead of the camera
feed), `debugMask`, `debugSpans`, `debugSorting`, `visualizeSpans`.

**Techniques worth copying:**

- Per-line random UV offset to jitter interval edges without recomputing spans. Cheap and
  visually effective. **[read]**
- Threshold animation toward a target, giving a smooth "sort is growing" reveal. **[read]**
- Debug views as first class outputs (mask, spans, sorted). **[read]**
- Gamma applied only to sorted pixels on composite. **[read]**

---

## 5. DavidMcLaughlin208/PixelSorting ("Pixel Sortium", C++ / openFrameworks, GUI, video)

**Licence:** none. No `LICENSE` file, no licence statement in the README, GitHub detector
reports none. **[read]**

**What it is:** an openFrameworks + OpenCV + ofxDatGui desktop app for images and video,
explicitly built to (a) handle video and (b) multithread the sort. The README's headline
numbers: satyarth's Python tool takes about 17 s on a 1920x1200 image at 45 degrees with default
thresholds; this takes 2.1 s with live display and rapid iteration. **[read]** Source is small
and readable: `src/ofApp.cpp` (1071 lines) holds the whole sorter and the UI wiring,
`src/PSImage.cpp` holds rotation and save. **[read]**

### GUI controls and workflow

Two `ofxDatGui` panels plus an info strip. **[read]**

**Left panel, "Image Sorting Controls"** (`setupDatGui`, line 641 onward):

- `Sort` button (also stops a running sort), `Save Image`, `Revert Changes`
- `Sorting Parameter` dropdown: Brightness, Hue, Saturation
- `Sorting Type` dropdown: THRESHOLD, RANDOM
- `Lower Threshold` slider 0 to 1, default 0.25
- `Upper Threshold` slider 0 to 1, default 0.80
- `Angle` slider 0 to 359, integer degrees, default 0
- `Falloff` slider 0 to 100, default 100
- `Thread Count` slider 1 to 50, default 30
- A scroll view listing every supported file found in the `images/` directory

**Right panel, "Mask Controls":**

- `Clear Mask`, `Save Mask`, `Invert Mask`
- `Mask Opacity` slider 0 to 1 (default 0.4), only affects the on-screen overlay
- `Draw Mask Tool` toggle button
- `Brush Type` dropdown: Circle, Square, Click And Drag
- `Brush Size` slider 0 to 100
- A scroll view listing mask files from `images/masks/`

**Info panel:** current status string ("Idle", "Sorting", "Saving Image"), progress fraction,
last sort duration in ms, and for video the current frame over total frames. **[read]**

**Workflow, as the code enforces it:** drop images into `images/`, masks into `images/masks/`,
click a filename in a scroll list to load. Painting a mask requires toggling the mask tool, then
dragging on the image; the brush writes alpha into an RGBA mask image, so the mask is an ordinary
savable image. Press `Sort` and the app sorts incrementally rather than in one blocking call:
each `update()` launches `threadCount` `std::thread`s, each sorting exactly one row (or column
after rotation), advancing a shared row index and publishing progress. When the index passes the
image height the sort completes, the image is re-uploaded and the info panel shows elapsed time.
For video, the same loop sorts one frame, writes it through `cv::VideoWriter`, then pulls the
next frame and repeats. **[read]** `Angle` triggers a rotation with `cv::warpAffine` into a padded
square canvas sized to the image diagonal (padding added once and reused for later angle
changes), and `save()` rotates back by `-currentImageAngle` and centre crops to the original
size. **[read]**

**Interval selection modes:** two, encoded as `SortType` **[read]**:

- `THRESHOLD`: a span runs while `value >= lower && value <= upper` on the selected parameter,
  ending at the first pixel outside the band, or at the row edge, or where the mask rejects, or
  where alpha is 0.
- `RANDOM`: on finding a span start, picks `endOfInterval = min(i + width*0.01 + rand(1..100),
  rowEnd)` and sorts that immediately. So this mode is "start anywhere in band, then take a short
  random length", which differs from satyarth's per-span randomness flag.
- `falloffChance` is a separate per-span skip probability: after a span is found,
  `randFloat(0,100) > randomFalloff` drops it unsorted. At the default 100 nothing is dropped.
  **[read]**

**Sort keys:** Brightness (`ofColor::getBrightness`, HSV V), Hue (`getHue`), Saturation. All
compared with `std::sort` and a per-key comparator struct. Only r, g and b are copied back; alpha
is not sorted. **[read]**

**Direction / path:** rows only, plus a 0 to 359 degree rotation solved by rotating the whole
image with OpenCV. Rows then become arbitrary angles. There is no columns-only mode without using
angle 90, and no diagonals or curves. **[inferred from `pixelSortRow` and `rotateImage`]**

**Mask support:** the strongest mask story of the ten. Hand painted mask with three brush types,
brush size, opacity overlay, invert, clear, save to `images/masks/`, reload from a list, and the
mask is sampled with an inverse rotation of each sorted pixel's coordinates so it stays
registered while the image sits at an arbitrary angle (`pixelSortRow`'s rotate, untranslate, unpad
block). **[read]** The README's own enhancement list admits the weak points: no "use mask as
intervals", no "any image as a mask with threshold", no interval preview shader, no undo.
**[read]**

**Techniques worth copying:**

- **Incremental, cancellable sorting with progress.** Sort a slice per frame, show partial
  results, publish elapsed time. For a browser editor this maps directly onto chunked work in a
  worker with a progress event, and it makes an expensive operation feel responsive. **[inferred]**
- **Rotate once into a padded square canvas, sort rows, crop back on save.** Better than rotating
  twice per sort, which is what satyarth does. Padding is computed from the diagonal and reused
  across angle changes. **[read]**
- **Mask sampled in unrotated space.** Any editor with both masks and angles needs this, or masks
  slide when the angle changes. **[inferred]**
- **Falloff as a per-span probability** is a one-parameter way to get torn, partially sorted
  results. **[read]**

---

## 6. julescarbon/sortpixels.js (JavaScript)

**Licence:** none. No `LICENSE`, the README is usage notes only, GitHub detector reports none.
**[read]**

**What it is:** a direct port of ASDFPixelSort to JavaScript and `canvas` 2D, about 300 lines,
with no dependencies in the sorting code (jQuery only in the demo pages). Exposes
`sortPixels(img, mode, loops)` returning a canvas. Ships `test.html`, `live.html` with a file
upload, an iterations field and a mode dropdown, and `plop.html`. **[read]**

**Interval selection modes:** the three that appear in the ASDF family, with different numbering
from the original: `0` black, `1` brightness, `2` white. Constants: `blackValue = -10000000`,
`whiteValue = -6000000`, `brightnessValue = 30`. **[read]**

**Sort keys:** one. Pixels are repacked into `(((255 << 8 | r) << 8 | g) << 8 | b)`, which lands
as a signed 32-bit ARGB-compatible integer, and the array is sorted with
`Array.prototype.sort()`. Comparison is therefore by packed RGB, that is R most significant, then
G, then B. **[read]**

**Direction / path:** rows and columns both, unconditionally, in that order (columns first in
`draw()`, then rows), repeated `loops` times. No angle, no mask, no threshold controls beyond
editing constants. Brightness is HSV value (`max(r,g,b)/255*100`), not Processing's
`brightness()`, so mode 1 does not match ASDF pixel for pixel. **[read]**

**Two divergences a port must not inherit:**

1. **`unsorted.sort()` with no comparator.** With no argument, `Array.sort` compares string
   forms. Since the packed values are negative and of varying digit length, the result is not
   numeric ascending order. I checked this in Node against the actual constant values:
   `[-16777216, -1, -10192756, -12345678, -9, -100]` sorts to
   `[-1, -100, -10192756, -12345678, -16777216, -9]` under the default comparator, versus
   `[-16777216, -12345678, -10192756, -100, -9, -1]` numerically. The two differ, so this port
   sorts in a scrambled order relative to the original. **[verified by evaluating the comparator
   in Node, not by rendering an image]**
2. **Brightness definition differs** from ASDF's `brightness()` (HSV V versus Processing's
   perceptual mix), so the brightness mode is a different look. **[read]**

**Technique worth copying:** little beyond the observation that the whole effect fits in a few
hundred lines of plain JS against `ImageData`. That is a useful floor for sizing our own CPU
implementation. **[inferred]** Its demo UI (upload, iterations, mode dropdown) is a reasonable
minimum viable control set for a first version.

---

## 7. czycha/pxlsrt (Ruby)

**Licence:** MIT, Copyright (c) 2014 czycha **[read]**

**What it is:** a Ruby gem with a Thor CLI and four distinct sorters selectable as subcommands:
`brute`, `smart`, `kim`, `seed`. PNG only (ChunkyPNG and oily_png). A JRuby branch and a Node
port (`pxlsrt.js`) are mentioned in the README but are not in this repo. **[read]**

**Interval selection modes, per subcommand** **[read]**:

| Subcommand | Span source |
|---|---|
| `brute` | Random slices along each line with `--min` and `--max` bandwidths (`Lines.randomSlices`, widths drawn uniformly inside the range). |
| `smart` | Sobel edge magnitude; a span continues while the *change* in Sobel value between adjacent pixels stays under `--threshold` (default 20), or while the absolute value stays under it with `--absolute`. |
| `kim` | Reimplementation of ASDFPixelSort, single pass over columns then rows, with `--method black/brightness/white` and a `--value` override for the break constant. |
| `seed` | Seeds from 3x3 edge detection below `--threshold`, optionally pruned to be at least `--distance` apart (default 100), or `--random N` random seeds. Each seed then grows along a **spiral** (`Pxlsrt::Spiral`) collecting pixels until the spiral is blocked or repeats a direction and cycle; each seed's collection is then sorted and written back along its own spiral order. |

**Sort keys:** 18 named methods in `Colors::METHODS` **[read]**: `sum-rgb`, `red`, `green`,
`blue`, `sum-hsb`, `hue`, `saturation`, `brightness`, `uniqueness` (Euclidean RGBA distance from
the span's own average colour), `luma` (BT.709 plus alpha), `random`, `magenta` (r+b), `cyan`
(g+b), `yellow` (r+g), `alpha`, `sum-rgba`, `sum-hsba`, `none`.

**Direction / path:** `--vertical` switches to columns, `--diagonal` switches to upper-left to
lower-right diagonals, `--vertical --diagonal` switches to lower-left to upper-right diagonals.
Diagonal extraction is index arithmetic on the flat pixel array (`Lines.getDiagonals`,
`Lines.fromDiagonals`), plus a hand written array rotation (`Lines.rotateImage`) that the author
added because ChunkyPNG's rotate doubled runtime. **[read]** No arbitrary angle, no mask.

**Post-sort band transforms** (applied per span, in `Helpers.handlePixelSort`) **[read]**:

- `--smooth`: groups identical pixels together inside the span before and after sorting, so equal
  keys stay adjacent. Genuinely fixes the muddy look of hue sorting.
- `--reverse` reverses the band; `--reverse either` randomly reverses each band independently.
- `--middle N` ("middlate"): folds the band from the middle outwards, `N` times, with negative
  `N` unfolding. `Lines.middlate` implements it as index arithmetic with a documented example:
  `[a,b,c,d,e] -> [d,b,a,c,e]`. This produces a sunrise-gradient look from a sorted band, and no
  other project has it.

**Technique worth copying:** `middlate` and `smooth` are both small, self contained,
output-transforming steps that compose with any span source, and they are the cheapest way to get
looks that do not read as "default pixel sort". Also worth stealing: the `magenta`, `cyan` and
`yellow` pair sums are a two-line way to get three more distinct palettes without writing colour
space code. **[inferred]**

---

## 8. rkargon/pixelsorter (Python)

**Licence:** GPL-3.0 (`LICENSE.txt` holds the GPLv3 text), every source file carries a GPL
header. **[read]**

**What it is:** a Python library plus CLI, and by a wide margin the richest of the ten on *paths*
and *span modifiers*. Documented in `docs/DOCUMENTATION.md` and `docs/PATHS.md` with example
images for each feature. Also handles GIF input, GIF output, and parameter animation. **[read]**

**Interval selection modes** **[read]**:

- `--max-interval N`: consecutive spans of N pixels along the path; omitted means the whole path
  line is one span.
- `--randomize`: each span length drawn from `1..max_interval`.
- `--progressive-amount F`: span length grows by `F * max_interval` each time a new span starts,
  so spans get longer as the traversal advances. The docs suggest values under 0.001.
- `--edge-threshold T`: Sobel magnitude; a pixel above the threshold ends the span.
- `--image-threshold F`: luma outside `[F*255/2, 255 - F*255/2]` ends the span. Docs are clear
  that 0 sorts everything and 1 sorts nothing.
- `--image-mask FILE`: any pixel whose luma is above 128 ends the span (white means do not sort,
  black means sort).
- `--use-tiles` with `--tile-x`, `--tile-y`, `--tile-density`, `--randomize-tiles`: the image is
  cut into a grid and each tile sorted as an independent image. Density picks a fraction of tiles,
  either uniformly spread or randomly.
- A span also ends at the end of the path line.

The delimiter pixel is consumed and dropped from the span without being modified, which is
cleaner than satyarth's boundary handling. **[read]**

**Sort keys** (`keys.py`, 13 entries) **[read]**: `sum`, `red`, `green`, `blue`, `intensity`
(mean of RGB), `brightness` (alias for intensity), `lightness` (HSL L), `luma` (BT.709), `chroma`
(`max - min`), `hue` (0 to 360), `saturation`, `value` (`max`), `random`. Plus `--discretize N`,
which divides the key by N and floors it, so near-equal pixels bin together and stay put. That
single parameter is the most useful "protect detail" control in the survey. **[read]**

**Direction / path** (`paths.py`, 12 entries) **[read]**:

| Path | Notes |
|---|---|
| `horizontal` (default), `vertical` | plain rows and columns |
| `angled-line angle=D` | lines at D degrees, drawn with a Bresenham-style `draw_line`, adjacent lines tiled to cover the image |
| `diagonal` | 45 degree lines from top-left to bottom-right, successive lines from bottom-left upward |
| `diagonal-single` | the same pixels, but as **one single span** covering the whole image diagonally, giving a smooth global gradient instead of stripes |
| `concentric` | concentric rectangles from the border inward |
| `circles` | concentric Bresenham circles about the image centre, expanding until corners are covered |
| `fill-circles radius=R` | overlapping filled circles on a grid, each built from concentric rings |
| `random-walk`, `-horizontal`, `-vertical` | Markov walks over the 8 neighbours with a configurable distribution; the horizontal and vertical variants start on an edge and only step forward |

**Post-sort band modifiers** (`sort_filter` in `sort.py`) **[read]**:

- `--mirror`: places successive sorted elements alternately at the start and end of the span, so
  loops (concentric, circles) have continuous seams.
- `--splice F` (0 to 1) and `--splice-random`: rotate the span to start at a chosen or random
  position.
- `-R` or `--reverse`.

**Channel support:** `--channel red/green/blue` sorts the image normally then keeps only that
channel from the sorted result, producing a channel-separation glitch effect. **[read]**

**Animation:** `--animate "PARAM START STOP N_STEPS"` interpolates one numeric parameter over N
frames and writes a GIF; `path.arg` addresses path parameters, so you can animate `angled-line`'s
angle from 0 to 90. GIF input is sorted frame by frame, optionally with the animation applied per
frame. `--save-frames` dumps the frames. **[read]**

**Custom paths:** documented as a public extension point. A path is any callable taking
`(width, height)` and returning a generator of generators of `(x, y)`. The docs show
`horizontal_path` in five lines as the template. **[read]**

**Technique worth copying, in order of value:**

1. **The path abstraction itself**, a generator of generators of coordinates. Every mode (rows,
   diagonals, circles, walks, tiles) becomes data, the sorter never changes, and custom paths come
   free. This is the best structural idea in the survey for our editor. **[inferred]**
2. **`diagonal-single` versus `diagonal`**: the same pixel set, one span versus many. Shows that
   span count is a first class artistic control independent of geometry.
3. **`--discretize`** for preserving detail while sorting.
4. **`--channel`** for a one-click channel glitch.
5. **Tiles with density** as a compositional tool.
6. **`mirror` and `splice`** as cheap composable band transforms.

**Caveats:** `collections.MutableMapping` in `sort.py` was removed in Python 3.10, so `SortingArgs`
will not import on a current interpreter without a fix. **[inferred from the import and the
standard library history]** The `saturation` key divides by `max(p)` with a guard only for
`max_c == 0`, so pure black is handled but the division path relies on the earlier return.
**[inferred]** The repo's own TODO lists "better circles", "seed sorting", "more curved paths",
"finish tests". **[read]**

---

## 9. ruccho/BitonicPixelSorter (Unity, GPU bitonic sort)

**Licence:** MIT, Copyright (c) 2020 ruccho **[read]**

**What it is:** a genuine real time pixel sorter for Unity, packaged as a UPM package, with a
built-in RP image effect path and a URP renderer feature. The README is unusually precise about
the algorithm and the limits, and the compute shader matches the description. **[read]** Files:
`Packages/com.ruccho.bitonicpixelsorter/Runtime/BitonicPixelSorter.compute` and `.cs`, plus a URP
feature under the sibling package. **[read]**

### How the GPU sort is done

One compute kernel, `SortPass`, one dispatch, one thread group per line
(`shader.Dispatch(kernel, lines, 1, 1)`). **[read]**

1. **Load.** `MAX_THREADS` threads per group, 128 by default. Each thread owns a contiguous chunk
   of pixel *pairs* (`ops` pairs each). It computes Rec.601-ish brightness
   (`0.298912 r + 0.586611 g + 0.114478 b`) for both pixels of each pair, packs
   `(index << 16) | f16(brightness)` into `groupshared uint groupCache[MAX_SIZE]`, and records
   which of the two pixels are inside `[thresholdMin, thresholdMax]` in a per-thread
   `uint rangeMask` bitfield. Packing index and key into one 32-bit word makes a comparator swap a
   single integer exchange. **[read]**
2. **Span detection as two parallel scans.** Span starts are found with an inclusive
   **prefix-max** scan (Hillis-Steele) over each thread's "last out-of-threshold index + 1", then
   a short per-chunk walk turns the carry into a start index for every pair. Span ends are found
   symmetrically with a **suffix-min** scan over "first out-of-threshold index". Cost is
   `O(log threads)` per thread, not `O(line length)`. Pixels outside the threshold form spans of
   length 1, so they never move. **[read]**
3. **Adaptive phase count.** A parallel max-reduction finds the longest span in the line and sets
   `lineLevels = floor(log2(maxLen)) + 1`, instead of `ceil(log2(lineWidth))`. Because network cost
   grows with the square of the phase count, short spans (the normal case under thresholding)
   finish far earlier, and a line with nothing to sort skips the network entirely. One extra merge
   phase handles spans whose length is an exact power of two so every span ends up merged in the
   same direction. **[read]**
4. **Per-span bitonic sort inside one network.** Comparator indices are computed relative to each
   pair's own span start, which lets every span in the line be sorted independently in the same
   network with no divergent control flow. Spans that are not a power of two are handled with the
   odd-network technique: a comparator that would reach past the span end compares an element with
   itself. Ascending versus descending at each comparator is derived from block parity and ordering,
   so alternating runs stay correct. **[read]**
5. **Output.** Only the sorted *indices* are used; full colour pixels are gathered from the source
   texture into the output texture, so colours never pass through shared memory. **[read]**

### What that limits

- **Line length is the hard limit:** `MAX_SIZE 2048` by default because of group shared memory
  (`groupshared uint groupCache[MAX_SIZE]` is 8 KiB). With the `BPS_SIZE_4096` shader keyword it
  becomes 4096 and 16 KiB, at `MAX_THREADS 256` to keep the pair count per thread constant, "at
  some occupancy cost". Above 4096 the C# refuses: it logs "Size of source texture must be 4096 or
  smaller" and blits the source through unchanged. **[read]**
- **Image size is limited on the sorted axis only**, and only by that same line limit. The number
  of lines is unbounded by the shader; it is just the dispatch group count. **[inferred]**
- **Only a brightness band is supported.** One scalar key (luminance) serves both the threshold and
  the ordering. No hue sort, no channel key, no mask image, no angle: direction is a single bool.
  **[read]**
- **Performance, as reported:** about 340 microseconds at 1920x1080 on an RTX 4070, over 1000 FPS.
  **[read, from the README's own measurement]** I did not run it.

**Parameters:** `useAsImageEffect`, `shader`, `direction` (horizontal or vertical bool), `ascending`
bool, `thresholdMin` 0.4, `thresholdMax` 0.6. Plus `Execute(Texture, RenderTexture)` for manual
use. **[read]**

**Browser relevance:** the README links a live WebGPU port at `https://ruccho.com/bps-webgpu/`,
which I fetched and confirmed returns HTTP 200 with WebGPU and Bitonic PixelSort strings in the
page. The port's source is not in this repo. **[read for the link, and for the page responding;
how faithful the port is remains [inferred]]**

---

## 10. DenizBicer/Pixel-Sorting (Unity compute shader, fake sort)

**Licence:** none. No `LICENSE` file, the README is six lines, GitHub detector reports none.
**[read]**

**What it is:** a Unity 2019.2 project whose README calls it "Pixel Sorting" but which is
explicitly not a sort. It is an agent based smear, one agent per row, marched left to right, one
dispatch per column. The last commit message, "added noise to the shift movement", is the best
description of the technique. **[read]**

**How it works** (`Assets/PixelSorter.compute`, 92 lines) **[read]**:

- `Init`, `[numthreads(16,1,1)]`, dispatched `height/16` times: one agent per row, holding a
  position `(0, row)` and the HSV of that row's leftmost pixel.
- `Sort`, same dispatch, once per column, driven from C# `Update()` which increments a
  `currentColumn` uniform and dispatches again:
  - the new position is `(currentColumn, agentRow + Noise[oldPos].x * 50)`, so each row is
    displaced vertically by a noise texture, giving a wavy, scanline-like shear;
  - if `abs(agentHue - newPixelHue) < hueSimilarityRange` **and** `newPixelValue < valueThreshold`,
    the agent writes its carried hue and saturation at the new position with
    `value -= decayAmount` (clamped) and alpha `= step(alphaCutOut, value)`, so long runs fade out
    and become transparent;
  - otherwise the agent adopts the sampled pixel's HSV and moves on.
- C# side: `_decayAmount` 0.01, `_valueThreshold` 0.9, `_alphaCutOut` 0.01,
  `_hueSimilarityRange` 0.1, an optional noise texture defaulting to a blank 2048x2048, a
  background `RawImage` behind the result, and a `ComputeBuffer` of agents.

**Interval selection modes:** one, hue similarity plus a value ceiling. Spans are implicit: the
run of pixels the agent manages to smear. **[read]**

**Sort keys:** none. Nothing is ordered; values only decay. **[read]**

**Direction / path:** left to right only, with a noise driven vertical offset per row. That offset
is the closest thing in this repo to scanline displacement. **[read]**

**Mask support:** none, but the alpha cutout (`step(alphaCutOut, value)`) composites the result
over a background image, which is a mask of sorts. **[read]**

**Technique worth copying:** it shows that a convincing pixel sort look does not require a sort.
Three cheap ideas are worth having as non-sort modes: carried colour with decay, hue similarity as
the continuation test, and noise-displaced rows. The progressive per-column dispatch is also the
cleanest "watch it happen" mechanism in the survey, since it needs no row indexing at all.
**[inferred]**

---

## 11. Merged catalogue

Shorthand used in the tables: **S** satyarth, **T** jeffThompson, **A** ASDFPixelSort, **G**
GarrettGunnell, **D** DavidMcLaughlin208, **J** julescarbon, **X** pxlsrt, **R** rkargon, **B**
ruccho, **N** DenizBicer.

### 11.1 Interval and span selection modes

| # | Mode | Description | Projects |
|---|---|---|---|
| 1 | Brightness band, two-sided | span continues while luma or a selected parameter stays inside `[low, high]` | S `threshold`, G mask, B thresholds, D THRESHOLD type | 
| 2 | Brightness threshold, light side only | sort runs at or above a threshold ("everything brighter than X") | A mode 2 bright and mode 0 white, J modes 1 and 0, X `kim` brightness and white | 
| 3 | Brightness threshold, dark side only | sort runs at or below a threshold | A mode 3 dark and mode 1 black, X `kim` black | 
| 4 | Packed-value threshold | threshold on the packed RGB integer rather than a perceptual brightness | A modes 0 and 1, J modes 0 and 2 | 
| 5 | Fixed-width bands | equal length chunks along the traversal | S `waves`, R `max_interval`, X `brute` (min == max) | 
| 6 | Random-width bands | chunk length drawn at random each time | S `random`, R `randomize`, X `brute` `randomSlices`, D RANDOM, G `maxRandomSpanOffset` | 
| 7 | Progressive or ramped width | span length grows as the traversal advances | R `--progressive-amount` | 
| 8 | Per-span skip probability | a found span is dropped unsorted with probability p | S `-r randomness`, D `Falloff` | 
| 9 | Edge-detected spans | Sobel or FIND_EDGES magnitude ends the span | S `edges`, X `smart` (`--threshold`, `--absolute`), R `--edge-threshold` | 
| 10 | Interval source image | a second image supplies the spans | S `file`, S `file-edges` | 
| 11 | Whole line, no breaks | one span per traversal line | S `none`, R `max_interval` omitted, X `brute` with infinite min and max | 
| 12 | Whole image as one span | the entire traversal is a single span | R `diagonal-single` | 
| 13 | 1D chunks with row wrap | image treated as a flat array, chunks cross row boundaries | T `SortImageByNpx` | 
| 14 | Rectangular tiles | grid of independent sub-images | R `--use-tiles`, T `SortImageByNpx_Block` | 
| 15 | Tile density and random tiles | only a fraction of tiles sorted, spread evenly or at random | R `--tile-density`, `--randomize-tiles` | 
| 16 | Seam or least-energy path | a dynamic programming path through the image is the span | T `SortThroughSeamCarving`, T `SortImageByLeastResistance` | 
| 17 | Seed growth | spans grow outward from seed pixels, 4 or 8 connected | T `SeedSorting`, X `seed` (spiral growth order) | 
| 18 | Spiral ring spans | concentric rings from outside in, each ring one span | T `SpiralSortPixels`, X `Pxlsrt::Spiral` | 
| 19 | Traversal-order spans | the path itself defines the spans | R `concentric`, `circles`, `fill-circles`, `random-walk` variants | 
| 20 | Span length cap | hard maximum span length, independent of content | G `maxSpanLength` (0 to 1080) | 
| 21 | Hue-similarity continuation | span continues while hue stays within a range | N (as a smear, not a sort) | 
| 22 | Alpha as a terminator | fully transparent pixels end the span | D (`color.a != 0` test) | 
| 23 | Incremental or progressive sort | span work spread across frames or columns | D (threads per row per frame), N (one column per frame) | 

### 11.2 Sort keys

| Key | Definition used | Projects |
|---|---|---|
| Packed RGB or ARGB integer | numeric compare of the packed colour, effectively R then G then B | A, J, T default, X `kim` | 
| Lightness (HSL L) | `(min + max) / 2` | S default, R `lightness`, G `Lightness` | 
| Hue | HSL or HSV hue angle | S, R, X, G, D | 
| Saturation | HSL or HSV saturation | S, R, X, G, D | 
| Brightness or value | Processing `brightness()`, HSV V, or `ofColor::getBrightness` | A, J, X `brightness`, R `value`, D | 
| Luminance or luma | Rec.601 or BT.709 weighted sum | G (mask and key), R `luma`, X `luma` | 
| Intensity | mean or sum of R, G, B | S `intensity` (sum), R `intensity` (mean), X `sum-rgb` | 
| Minimum channel | `min(r, g, b)` | S `minimum` | 
| Single channel | R, or G, or B alone | R, X, G | 
| Channel pair sums | `r+g` (yellow), `g+b` (cyan), `r+b` (magenta) | X only | 
| Chroma | `max - min` | R only | 
| Uniqueness | RGBA distance from the span's own average colour | X only | 
| Alpha | alpha channel, alone or summed | X (`alpha`, `sum-rgba`, `sum-hsba`) | 
| Random | shuffle, no order at all | X `random`, R `random` | 
| Binned or discretised key | key divided by N and floored before comparing | R `--discretize` | 
| No key, decay only | carried colour decays along the span | N | 
| Packed index plus f16 key | implementation trick: pixel index in the high 16 bits, f16 key in the low 16 bits, of one 32-bit word | B | 

### 11.3 Direction, angle and path options

| Option | Projects |
|---|---|
| Horizontal rows | all ten |
| Vertical columns | A, J, X `kim`, R, G, B, D (via angle 90), S (via angle) |
| Rows then columns in one pass (the ASDF look) | A, J, X `kim`; S documents it as two runs |
| Arbitrary angle by rotating the image | S `-a` (PIL, rotate and crop back), D `Angle` (OpenCV warpAffine into a padded square) |
| Arbitrary angle by drawing tilted lines | R `angled-line angle=D` |
| 45 degree diagonals as separate lines | R `diagonal`, X `--diagonal` and `--vertical --diagonal` (the other diagonal) |
| Diagonals as one continuous span | R `diagonal-single` |
| Concentric rectangles | R `concentric` |
| Concentric circles | R `circles` |
| Filled circles on a grid | R `fill-circles radius=R` |
| Spiral | T `SpiralSortPixels` (one continuous spiral), X seed (spiral growth order) |
| Random walks | R `random-walk`, `random-walk-horizontal`, `random-walk-vertical` |
| Portal path, jump to a similar colour | T `SortPixelPortal` |
| Seam or least-energy path | T, two variants |
| Custom user paths | R, documented generator-of-generators extension point |
| Tiles and blocks | R, T |
| Post-band reversal | X `--reverse`, R `-R`, G `reverseSorting`, B `ascending` |
| Per-band random reversal | X `--reverse either` |
| Band mirroring, alternating ends | R `--mirror` |
| Band splicing or rotation | R `--splice`, `--splice-random` |
| Band folding from the middle ("middlate") | X `--middle N` |
| Band smoothing, grouping equal keys | X `--smooth` |
| Channel-selective sorting | R `--channel red/green/blue` |
| Multi-pass rotate-and-iterate | T (90 degrees between passes), D (manual), S (manual) |

### 11.4 Mask options

| Option | Projects |
|---|---|
| External image as a per-pixel mask, untouched pixels preserved | S `-m` |
| External image as a per-pixel mask, white means do not sort | R `--image-mask` |
| External image as the span definition | S `file`, S `file-edges` |
| Threshold band doubling as a mask | G, B, D, S `threshold`, A, J, X `kim` |
| Hand painted brush mask, saved and reloaded | D (`Draw Mask Tool`, brush type, brush size, save, clear) |
| Mask opacity overlay for editing feedback | D |
| Invert mask | D, G |
| Mask or span visualisation | G (`debugMask`, `visualizeSpans`, `debugSpans`); D lists it as a TODO |
| Mask sampled in unrotated image space so it survives angle changes | D |
| Alpha channel as an implicit mask | D (skips `a == 0`), X (`alpha` key), N (`alphaCutOut`) |
| Tile density as a coarse spatial mask | R |
| Channel selection as a component mask | R |

### 11.5 Parameters worth exposing in a UI

Grouped by what the user is deciding, not by project.

| Decision | Parameter | Seen as |
|---|---|---|
| Where spans start and stop | lower threshold | S `-t` 0.25, D 0.25, G 0.2, B 0.4, X `--threshold` 20 |
| | upper threshold | S `-u` 0.8, D 0.80, G 0.8, B 0.6 |
| | break constant on packed value | A `whiteValue` and `blackValue`, J the same |
| | character length or band width | S `-c` 50, R `max_interval`, X `--min` and `--max` |
| | span length cap | G `maxSpanLength` 1080 |
| | progressive ramp | R `--progressive-amount` |
| | randomness or skip | S `-r` 0, D `Falloff` 100 |
| | edge threshold | R `--edge-threshold`, X `--threshold` plus `--absolute` |
| | image threshold | R `--image-threshold` |
| How much to protect | discretise | R `--discretize` |
| | smoothing | X `--smooth` |
| What order | sort key | 17 distinct keys, section 11.2 |
| | reverse | 5 projects |
| | direction | horizontal, vertical, angle, or path |
| | mirror, splice, middlate | R, X |
| Looks and animation | threshold animation toward a target | G `animateThresholds` with `animationSpeed` |
| | per-line random offset | G `maskRandomOffset` 0.1 |
| | gamma | G 0.1 to 10 |
| | parameter animation over N frames | R `--animate`, `--save-frames` |
| | iteration count | A `loops`, J `loops`, T `numIterations` |
| | thread count or chunk budget | D 1 to 50 |

---

## 12. Adjacent glitch effects

Effects that appear in these projects, or that the pixel sorting community pairs with it.
Everything here is **[inferred]** as a recommendation, with the project that demonstrates it named
where one exists. Items marked external are common practice and were not found in any of the ten
repositories I read.

1. **Channel separation and RGB shift.** Sort one channel only and keep the other two from the
   original, or offset one channel by a few pixels. Present as `--channel red/green/blue` in
   rkargon, and as per-channel sorting by dominant channel in jeffThompson's
   `SortByHighestRGBValue`. A one-pixel offset between R and G is the classic external companion.
2. **Channel rotation or swapping.** Cycle channels so r becomes g, g becomes b, b becomes r.
   Listed as an unimplemented idea in jeffThompson's `OtherSortingIdeas`. Cheap, and a natural
   pairing with sorting because it changes the palette without touching geometry.
3. **Per-channel sort with a different key each.** One channel by hue, one by lightness, one
   untouched. Not in any project, but the obvious next step given rkargon's channel support and
   satyarth's TODO ("Allow defining different intervals for different channels").
4. **Scanline displacement.** Shift whole rows sideways by a varying amount. ASDF and julescarbon
   already operate row by row, so displacement is a natural sibling; DenizBicer gets a similar look
   vertically via noise displacement. External in its pure form.
5. **Noise-driven row or column shear.** Offset each line by `noise * amplitude` before sorting.
   Exactly what DenizBicer does with `Noise[position].x * 50`, and what GarrettGunnell approximates
   with a per-line random UV offset (`maskRandomOffset`).
6. **Data bending, file-level corruption.** Reinterpreting or truncating compressed bytes and
   decoding the wreckage. Not in any project surveyed (external). Interesting for us because it is
   the only effect here that needs byte access, so it would be a separate pipeline stage; in a
   browser it is trivially available through `ArrayBuffer` on the uploaded file.
7. **Block and tile shuffle or repeat.** Sort tiles, then reorder or duplicate them. rkargon's tiles
   and jeffThompson's N-px block give the tiles; the reordering is external.
8. **Smear and decay trails.** Carry a colour along a span with a per-step decay and an alpha
   cutout, so the streak fades into the background. This is DenizBicer's whole effect
   (`decayAmount`, `alphaCutOut`, `valueThreshold`, `hueSimilarityRange`). Composes well with a real
   sort as a second pass.
9. **Iterated sort with rotation.** Apply the sort, rotate 90 degrees, apply again, N times.
   `SortThroughSeamCarving_RotateAndIterate` and `AutomaticVersions/SeedSorting_AutoIterate` in
   jeffThompson. Produces much denser texture than one pass for almost no extra code.
10. **Threshold animation.** Drift the lower and upper thresholds over time so the sorted region
    grows or breathes. GarrettGunnell `animateThresholds` with `animationSpeed`; rkargon generalises
    it to any numeric parameter with `--animate`.
11. **Interval preview and span visualisation.** Paint each span a flat random colour, or show the
    mask as an overlay. GarrettGunnell `visualizeSpans` and `debugSpans`. Not a glitch effect, but
    the highest value debugging tool in the survey, and nearly free in a web editor.
12. **Post-sort colour grading.** Gamma on sorted pixels only (GarrettGunnell `_Gamma`, 0.1 to 10).
    Any curve, contrast or levels stage after the sort cheaply changes the mood.
13. **Wave and ripple intervals.** Wider and narrower bands in a repeating pattern. satyarth
    `waves` (`char_length + randint(0, 10)`) is a mild version; a sine-modulated band width is the
    same idea with a visible rhythm (external).
14. **Seam warp and liquify.** Sorting along a least-energy seam produces local stretching
    (jeffThompson). A user-drawn path or a low-frequency displacement field before the sort gives
    the same family of look.
15. **Mirror, splice and fold.** rkargon's `mirror` and `splice`, pxlsrt's `middlate`. Not glitch
    effects in themselves, but they change the read of an otherwise generic sort more than any
    other knob at the same cost.

---

## 13. GPU feasibility in a browser, from what these three projects do

Two working GPU strategies exist in the survey, and they behave very differently.

**Strategy A, line-per-workgroup with a sorting network (ruccho).** One thread group owns one
line, span detection is two parallel scans, the sort is a bitonic network in workgroup shared
memory with comparators relative to each span start, and an adaptive phase count makes short spans
cheap. This is fast (the README reports about 340 microseconds at FHD) and the limit is structural:
shared memory per line, hence 2048 by default and 4096 with a bigger keyword. **[read]**

**Strategy B, span texture plus serial per-span sort (GarrettGunnell).** Span detection writes span
lengths to a texture, then one thread per span performs an O(n^2) selection-style sort while every
other thread idles. Correct, and the author says plainly that it is not performant. **[read]**

What this implies for a browser editor (all **[inferred]**):

- **WebGPU is a realistic match for strategy A.** Workgroup shared memory is guaranteed at 16 KiB
  minimum, which is exactly ruccho's `BPS_SIZE_4096` budget, and the algorithm maps onto
  `workgroupBarrier()` without redesign. The extra constraint is that sortable line length is
  bounded by that memory, not by image size, so wide images need tiling or a multi-pass fallback.
  ruccho has published a WebGPU demo of this effect, which is evidence the port works, though I did
  not read that port's source.
- **WebGL2 would need strategy B or a texture-based network.** There are no compute shaders and no
  workgroup memory, so a bitonic sort becomes `O(log^2 n)` full-screen passes on ping-pong textures
  (78 passes for a 4096-pixel line, 66 for a 2048-pixel one, fewer if spans are short and the phase
  count is adaptive). Workable for a preview at 1080p, painful at 4K, and the shared-memory limit
  disappears because keys live in textures rather than registers.
- **The path model is the real obstacle, not the sort.** Every GPU implementation here assumes spans
  are axis-aligned runs of a line. Diagonals, concentric rings, spirals, seam paths and random walks
  (rkargon, jeffThompson) do not fit that model: they would need a general traversal primitive,
  which on GPU means a texture of coordinates or a precomputed index map, plus a separate sort per
  arbitrary-length group.
- **Practical shape:** a CPU implementation over typed arrays in a worker, chunked per line with
  progress events, handles every path and every key in this survey and matches reference output
  exactly. A GPU path is worth having as an opt-in preview accelerator for the common axis-aligned
  brightness-threshold case only, which is the case strategy A solves.

---

## 14. Licence concerns

### 14.1 May port code from (permissive, attribution required)

| Repo | Licence | Notes |
|---|---|---|
| satyarth/pixelsort | MIT | Copyright (c) 2015 satyarth. Keep the notice. The README also credits `https://gist.github.com/prophetgoddess/667c5554e5d9d9a25ae6`, so provenance has a second hop. |
| czycha/pxlsrt | MIT | Copyright (c) 2014 czycha. `middlate`, `smooth`, the pair-sum keys and the array rotation are directly reusable. |
| GarrettGunnell/Pixel-Sorting | MIT | Copyright (c) 2023 Garrett Gunnell. Kernels, hash function, HSL conversions, threshold animation, span visualisation. |
| ruccho/BitonicPixelSorter | MIT | Copyright (c) 2020 ruccho. The compute shader is the most valuable single artefact in the survey for a GPU path; MIT permits porting it to WGSL with the notice kept. |

MIT obligations in practice: include the copyright line and permission notice for the parts we
take, in a `THIRD-PARTY-NOTICES` file or equivalent, and do not imply endorsement. If the editor is
a hosted web app, the notice also has to be reachable from the UI, since bundled JS is a
distributed copy. **[inferred]**

### 14.2 May only learn the idea from (copyleft, or no licence at all)

| Repo | Status | What that means |
|---|---|---|
| rkargon/pixelsorter | GPL-3.0 | Ideas are fine, code is not, unless the whole editor is GPL-3.0 with source offered to every user. A web app that ships the code as JS counts as distribution, so this is a real constraint, not a formality. The path catalogue, `discretize`, `mirror`, `splice` and tile density should be re-implemented from the documentation, not copied. |
| jeffThompson/PixelSorting | No licence file; README claims CC BY-NC-SA 3.0 | Both clauses hurt: NC forbids commercial use, SA forces share-alike on adaptations. Even the NC reading alone makes it unusable in a product. Learn from the sketches, do not copy them. |
| kimasendorf/ASDFPixelSort | No licence | All rights reserved by default. Re-implement the four modes from the documented threshold semantics. Do not copy the `.pde` file or its comments. |
| julescarbon/sortpixels.js | No licence | All rights reserved. The interesting content is the port itself, which has two divergences anyway (section 6). Nothing to port. |
| DavidMcLaughlin208/PixelSorting | No licence | All rights reserved. The GUI workflow, the incremental row-per-frame sort, the padded-square rotation and the mask-in-unrotated-space trick are learnable ideas; re-implement them. |
| DenizBicer/Pixel-Sorting | No licence | All rights reserved. The agent-and-decay smear and the noise displacement are ideas, not code to lift. It is 92 lines, and a clean re-implementation is quicker than reasoning about provenance. |

### 14.3 Practical guidance

- **A missing licence is not permission.** Five of the ten repos (kimasendorf, julescarbon,
  jeffThompson, DavidMcLaughlin208, DenizBicer) carry no OSI licence, and GitHub's own detector
  reports `none` for all five. Default copyright applies: we may read them for understanding and
  must re-implement independently.
- **Neither is a README claim a licence file.** jeffThompson's CC BY-NC-SA 3.0 statement is in
  prose in the README only. Treat it as at most that, and note that it blocks commercial use
  regardless of how we read it.
- **GPL is the one that constrains architecture, not just copying.** If any GPL-3.0 code ends up in
  the client bundle, the whole app must be GPL-3.0 and we must offer corresponding source to users.
  Deciding this before the first line of the sorting core is written is much cheaper than
  unwinding it later. **[inferred]**
- **Reimplementation is the safe default here.** Every algorithm in this survey is either simple
  enough to write from its description or documented well enough (ruccho's README is practically a
  design document for the shader) to rebuild without copying expression. Reserve direct porting for
  the four MIT projects, and even then restrict it to the parts with non-obvious implementation
  value: satyarth's interval functions, pxlsrt's `middlate` and `smooth`, GarrettGunnell's kernels,
  ruccho's scan and bitonic math. **[inferred]**
- **Attribution is separate from licensing.** ASDFPixelSort is the acknowledged origin for most of
  this ecosystem: satyarth's README ("To replicate Kim Asendorf's original processing script"),
  pxlsrt's `kim` subcommand ("Uses Kim Asendorf's pixel sorting algorithm"), DavidMcLaughlin208's
  README ("a generative art technique developed by Kim Asendorf") and the `ASDF` name itself all
  credit him. Crediting the lineage in the UI or docs is the community norm even where no licence
  requires it. **[inferred]**
