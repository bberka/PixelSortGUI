Written by Claude Haiku 5.5 (thinking medium), research subagent.

# Primary references: pxlsort and pixel-sorter

Research for the Drift engine and product specs. Date of research: 2026-11-24.

## 0. Method and tags

- Sources cloned to `/tmp/research/pxlsort` (Codeberg, `notlauren/pxlsort`, HEAD `d7fcc05`, 2026-09-12) and `/tmp/research/pixel-sorter` (GitHub, `Krzysztofz01/pixel-sorter`, HEAD `d29755a`, 2025-07-19). Both were `--depth 1` clones, so history was not inspected. Paths below are relative to each clone root. The clones are temporary and will not survive a reboot of `/tmp`.
- The `imaging` fork (`Krzysztofz01/imaging`, cloned to `/tmp/research/imaging`) was read because pixel-sorter depends on it for rotation, scaling, blur and convolution.
- Tags used in this file:
  - **(read)**: stated in the source at the cited lines.
  - **(run)**: confirmed by building and running the tool on this machine. Binaries and outputs are in `/tmp/research/`.
  - **(inferred)**: deduced from control flow or naming. Not run.
- Build and run environment: Linux, 12 cores, 64 GB RAM. Test image: `pxlsort/images/grass.jpg` (3359 x 1790 JPEG, RGB), which is in the pxlsort repo.
- I did not write any code in the project. No files were created in the project except this one.

## 1. Summary

- **pxlsort** (C, no licence) is a single-file horizontal-only sorter. It sorts runs of pixels whose average grey lies in a band, using a bottom-up merge sort, one job per run, on a thread pool. It has four flags. It has known crash and output-format bugs (run).
- **pixel-sorter** (Go, GPL-3.0) is a full parametric engine with a CLI (cobra). It supports 7 sort keys, 4 directions, 4 painting modes, 6 interval determinants, masks, Canny-style edge intervals, arbitrary-angle sorting, downscaling, cycles, lighten/darken blending. There is no GUI. Its only known failure I could run is `-s < 1` with `-b lighten|darken` (run).
- **Licence risk:** pxlsort has no licence, so its code cannot be copied or ported. pixel-sorter is GPL-3.0, so porting its code would make our project GPL-3.0. The safe path for both is a clean-room reimplementation from the behaviour described here.
- **Speed (run, one shot each):** pxlsort 0.96 s wall for the default run on the 6 Mpx test image. pixel-sorter 1.2 s for the default run (horizontal-vertical). Its `-i edge` run took 2.6 s.
- **Input and output:** pxlsort reads JPEG and PNG and always writes PNG bytes, even to a `.jpg` name (run). pixel-sorter reads what Go's image decoders register (JPEG and PNG directly, GIF/BMP/TIFF through imaging's imports (inferred)) and writes JPEG (quality 100) or PNG chosen by extension.

## 2. pxlsort (Codeberg, notlauren/pxlsort)

### 2.1 Metadata, language, licence, activity, run mode

- **Language:** C (C99-style, POSIX threads). Built with `make` (`Makefile:1-3`: `clang -Werror -Wall -Wextra src/main.c -o target/pxlsort -lm`).
- **Licence:** none. There is no LICENSE file for the project (`git ls-files` shows only `src/vendor/easy-args/LICENSE`). Codeberg API reports `licence: null` (queried 2026-11-24). Under default copyright, no reuse or porting of its code is permitted. Reimplementing the described algorithm clean-room is the only safe route. (This is not legal advice.)
- **Vendored dependencies:**
  - `src/vendor/easy-args`, MIT License, Copyright (c) 2025 Xander Gouws (`src/vendor/easy-args/LICENSE:1-3`). Used only for CLI argument parsing.
  - stb_image and stb_image_write: NOT vendored. `src/common.h:3-14` includes `<stb/stb_image.h>` and `<stb/stb_image_write.h>`. A clean clone does not build until stb is on the include path (run: `fatal error: 'stb/stb_image.h' file not found`). I fetched stb from `nothings/stb` master to test. Its header says public domain (read in the fetched file).
  - `.gitmodules:1-3` declares a submodule at `src/easy-args`. The actual vendored copy is at `src/vendor/easy-args`, so the submodule entry is stale (read and run).
- **Activity (Codeberg API, 2026-11-24):** created 2025-11-06, last updated 2026-09-13, 2 stars, 0 forks, 0 open issues, default branch `main`, 22.9 MB size.
- **How it is run:** CLI only. Usage: `pxlsort <input> <output> [OPTIONS]` (`README.md`, usage block; `src/main.c:13-40`). There is no library API.
- **`extra/main-nopool.c`:** an older variant with no thread pool. It includes `range_list_t.c`, which is not in the repo (inferred, from the file list). Treat it as dead code.

### 2.2 User-facing parameters (src/main.c:13-40)

| Name | Kind | Default | Range / values | Visible effect |
|---|---|---|---|---|
| `<input>` | positional, required | none | path to JPEG or PNG | Loaded with `stbi_load(..., 0)`, so native channel count is kept (`src/main.c:109`). |
| `<output>` | positional, required | none | any path; bytes are always PNG (`src/main.c:137`) | Output is always PNG-encoded, even with `.jpg` (run). |
| `-t <threads>` | uint | 20 | >= 0 (0 is untested) | Worker thread count. Does not change the image, only speed (`src/main.c:18-22`). |
| `-lb <lower bound>` | uint | 50 | 0..255 | Lower edge of the grey band. Runs of pixels with grey below this are not sorted (`src/main.c:23-27`). |
| `-ub <upper bound>` | uint | 160 | 0..255 | Upper edge of the grey band (`src/main.c:28-32`). |
| `-n <sorting noise>` | uint | 3 | >= 0 | Tolerance in the merge comparator. See 2.3.4. Visible effect: small differences keep their original order, which gives a clumpier look (inferred from code). |
| `-h` | flag | off | | Prints help (`src/main.c:40`). |

Not exposed: direction (always ascending), axis (always horizontal), angle, mask, cycles, blending, scale, seed, interval length, sort key (always grey).

The README says `-n` means "grayscale values that differ within noise will not be sorted" (`README.md`). The code does not exclude them. It changes the merge comparator (see 2.3.4). The README wording is misleading.

### 2.3 Algorithm (exact)

#### 2.3.1 Grey value

`pixel_ref_t_grayscl(p) = (R + G + B) / 3`, integer division, on 8-bit channels (`src/pixel_ref_t.c:21`). This is an unweighted average, not luma. Alpha is ignored.

#### 2.3.2 Run (interval) detection: `queue_contrast_ranges` (src/main.c:60-100)

Scan the whole buffer pixel by pixel in memory order (`src/main.c:66-68`). Each pixel has `in = (gray >= lb && gray <= ub)` (`src/main.c:72`).

- A run starts at the first `in` pixel after an out-of-band pixel or a row start (`src/main.c:74-76`).
- A run ends (exclusive `offset_end`) at the first out-of-band pixel, or at the start of the next row (`src/main.c:77-79`, test `(ptr - img.ptr) % bytewidth == 0`).
- Each run is pushed as a job (`struct sortinfo`, holding the range, the image struct, and noise) onto a linked list (`src/main.c:81-92`).

So runs never cross rows. Detection is one-dimensional and horizontal only.

Quirks found by reading (inferred, not run):
1. At a row start, if a run was open and the first pixel of the new row is in-band, that pixel is not started as a new run. The `else if` consumes it as the row-end event. Result: one pixel is skipped at the start of such rows.
2. The loop ends at `bytesize` without a final flush. A run that reaches the last pixel of the last row is never queued, so it is not sorted.

#### 2.3.3 Scheduling: thread pool (src/pthreadpool_t.c)

- `args_listnode_t_push` prepends to a singly linked list (`src/pthreadpool_t.c:21-31`). Pops take the head (`:37-47`). The result is LIFO job order (inferred).
- `pthreadpool_t_start` creates `nthread` POSIX threads (`:82-106`). Each thread loops: lock mutex, pop one job, unlock, sort it, until the list is empty (`:60-80`, mutex at `:69-70`).
- `pthread_setschedprio(thread, 15)` is called on each thread (`:101`). Without a real-time scheduling policy this is expected to fail silently (inferred; the return value is ignored).
- No cap on threads relative to the number of runs. Thread creation is always `nthread` (inferred).

#### 2.3.4 Sort: `thread_mergesort` (src/sorting.c:13-70)

- Each run is copied to a fresh `calloc(len)` temp buffer (`src/sorting.c:18`), where `len` is the run length in bytes.
- The sort is bottom-up merge sort at pixel granularity: starts at `sublen = channels` (one pixel) and doubles while `sublen < len` (`src/sorting.c:25`). Each pass merges adjacent sublists of length `sublen` into `tmparr`, then copies back to the run (`:59-63`).
- Comparator, pixel-level (`src/sorting.c:45-50`): take the left element if `ptrl < idxr && (ptrr >= idxe || grayscl(left) - grayscl(right) <= noise)`, else take the right element. Result: ascending by grey, with a tolerance of `noise`. Ties and near-ties keep left-first order.
- Only R, G, B are copied (`pixel_ref_t_copy`, `src/pixel_ref_t.c:22-27`). For 4-channel input, alpha is never moved, so it stays positional (inferred).
- Complexity: O(n log n) per run, with a temp buffer of run length.
- The comparator uses the integer average grey. Two pixels with equal average but different hue sort as equal.

#### 2.3.5 Output

After the pool drains, the whole buffer is written as PNG with `stbi_write_png` (`src/main.c:137-140`). No cropping, scaling or blending.

### 2.4 Performance

- Parallelism: POSIX threads, default 20, one job per run, mutex-protected pop. No SIMD (none in the source, `grep` for simd/avx/omp finds nothing). Sort is hand-written merge sort, not `qsort`.
- Memory: one full image buffer (stb). One `calloc` temp per run, freed inside the job.
- Measured (run, grass.jpg 3359x1790): `./pxlsort in out.png` took 0.96 s wall for the full process including JPEG decode and PNG encode. The tool itself reports integer seconds, so this is a shell measurement.
- Size limits: none declared. Run and row lengths are `int` (`src/sorting.c:19`), so a single row of more than about 2^31 bytes would overflow (inferred, not tested).

### 2.5 Supported I/O

- Input: JPEG and PNG only (`src/common.h:8-9`: `STB_ONLY_JPEG`, `STB_ONLY_PNG`). No GIF, BMP or WebP.
- Output: always PNG bytes (`src/main.c:137`). Output filename extension is ignored. Writing `test-out.jpg` produced a file that `file(1)` reports as PNG (run). The README says "PNG/JPEG".
- **Confirmed crash (run):** a grayscale PNG (`L`) and a grey+alpha PNG (`LA`) both abort with SIGABRT (exit 134). The pixel helpers read `ptr+1` and `ptr+2` regardless of channel count (`src/pixel_ref_t.c:9-19`), so they read into adjacent pixels or past the buffer. RGB and RGBA inputs ran fine (RGBA gave an RGBA PNG).

### 2.6 What pxlsort does that pixel-sorter does not

- A noise tolerance in the merge comparator (`-n`).
- A per-run job queue with a thread pool and mutex-guarded LIFO pop.
- Grey band uses plain RGB average, not perceived brightness.
- Very small, dependency-light, fast default.

### 2.7 Known defects summary (pxlsort)

| # | Defect | Evidence |
|---|---|---|
| 1 | Crashes on L and LA PNG input | run |
| 2 | Writes PNG bytes into any output name | run |
| 3 | Clean clone does not build; stb not vendored | run |
| 4 | `.gitmodules` path is wrong | read + run |
| 5 | README says `-n` prevents sorting; code only changes comparator | read |
| 6 | Row-start skip and unflushed final run | inferred |
| 7 | `pthread_setschedprio` likely no-op | inferred |

## 3. pixel-sorter (GitHub, Krzysztofz01/pixel-sorter)

### 3.1 Metadata, language, licence, activity, run mode

- **Language:** Go. `go.mod:3` says `go 1.23`. README says "go 1.19+" (`README.md`, Requirements). The declared version wins.
- **Licence:** GPL-3.0. `LICENSE` is the GPLv3 text. GitHub API reports `spdx_id: "GPL-3.0"` (queried 2026-11-24). No per-file SPDX or copyright headers in the `.go` files (grep). The `-only` versus `-or-later` distinction is not stated. Porting any code would make the result GPL-3.0 (copyleft). Copying code into a non-GPL project is not allowed. Reimplementing the algorithm from the behaviour described here (clean-room) is the normal route. (This is not legal advice.)
- **Bundled notices:** `NOTICES` lists MIT for `Krzysztofz01/imaging` (a fork of `disintegration/imaging`, MIT), logrus (MIT) and nested-logrus-formatter (MIT). `pimit` (`Krzysztofz01/pimit`) is MIT per GitHub API.
- **Activity (GitHub API, 2026-11-24):** 6 stars, 0 forks, 3 open issues, `pushed_at` 2025-07-19, `updated_at` 2026-11-24 (metadata only), not archived, no releases found.
- **How it is run:** CLI (`cobra`, `cmd/root.go`, `cmd/image.go`), built with `task build` (`Taskfile.yml`). There is also a Go library under `pkg/` (`pkg/sorter`, `pkg/img`, `pkg/utils`, `pkg/cache`). `pkg/cache` is not used by the CLI or sorter (grep). There is no GUI.
- Tests: 131 test functions in `pkg/sorter/*_test.go`.

### 3.2 User-facing parameters (CLI, `cmd/root.go`)

Flag registration is at `cmd/root.go:59-99`. Option parsing and validation is at `cmd/root.go:103-233`. Validation of thresholds, cycles, scale, length is at `pkg/sorter/sorter.go:91-121`.

| Flag | Type | Default | Range / values | Visible effect |
|---|---|---|---|---|
| `--input-media-path` | string | required | path. Decoders registered by import (see 3.7) | Source image. |
| `--output-media-path` | string | required | must end in `.jpg`, `.jpeg` or `.png` (`cmd/image.go`, `pkg/utils/file.go:66-100`) | Output. JPEG is written at quality 100 (`pkg/utils/file.go:88`). |
| `--mask-image-path` | string | empty | same size as input; grey only (R=G=B) or error (`pkg/sorter/mask.go:32-50`, `pkg/sorter/defaultSorter.go:39`) | External mask. Used by `-i mask` and `-m`. |
| `-e, --sort-determinant` | enum | `brightness` | `brightness, hue, saturation, absolute, red, green, blue` | Key used to order pixels within an interval. |
| `-d, --direction` | enum | `ascending` | `ascending, descending, shuffle, random` | Order of sorted interval. |
| `-o, --order` | enum | `horizontal-vertical` | `horizontal, vertical, horizontal-vertical, vertical-horizontal` | Which passes run, in what order. |
| `-i, --interval-determinant` | enum | `brightness` | `brightness, hue, saturation, mask, absolute, edge` | How intervals are split. |
| `-p, --interval-painting` | enum | `fill` | `fill, gradient, repeat, average` | What is painted into the interval. |
| `-l, --interval-lower-threshold` | float | 0.1 | 0.0..1.0 | Lower bound for threshold-based interval splitting. Ignored by `mask` and `edge`. |
| `-u, --interval-upper-threshold` | float | 0.9 | 0.0..1.0, must be >= lower | Upper bound. Ignored by `mask` and `edge`. |
| `-k, --interval-max-length` | int | 0 | >= 0; 0 means no cap | Maximum interval length in pixels. |
| `-r, --interval-max-length-random-factor` | int | 0 | >= 0 | Randomises each interval's cap. See 3.3.4. |
| `-a, --angle` | int | 0 | any integer degrees (normalised) | Sort along a rotated axis. See 3.3.8. |
| `-m, --mask` | bool | false | | Masked pixels are excluded from sorting. |
| `-c, --cycles` | int | 1 | >= 1 | Repeats the whole order pipeline on its own output. |
| `-s, --scale` | float | 1 | (0.0, 1.0] | Downscales input (and mask) before sorting. Output is smaller. |
| `-b, --blending-mode` | enum | `none` | `none, lighten, darken` | Per-channel max or min of original and sorted output. Breaks when scale < 1 (see 3.7, run). |
| `-v, --verbose` | bool | false | | Debug logs. |

Notes:
- `-l 0.1 -u 0.9` are global defaults, not per-determinant. With `-i hue`, the same 0.1..0.9 window applies to normalised hue (0..1). So default hue sorting skips hues below 36 degrees and above 324 degrees (inferred from `pkg/sorter/common.go:164-199`).
- Thresholds are 0..1 on different scales per determinant. See 3.3.3.

### 3.3 Algorithm (exact)

#### 3.3.1 Pipeline (`pkg/sorter/defaultSorter.go:81-215`)

For `CreateSorter` and `Sort` (the non-buffered path, used by the CLI):

1. **Scale** (if `Scale != 1`): Lanczos resize of the input and mask to `floor(W*s) x floor(H*s)` (`defaultSorter.go:98-115`, `pkg/utils/image.go:170-185`, `imaging.Lanczos`). The sort happens at this smaller size.
2. **Rotate** (if `Angle != 0`): `RotateImageWithRevertNrgba` (`defaultSorter.go:117-123`, `pkg/utils/image.go:103-146`). Mask rotated with `RotateImageNrgba`.
3. **Edge detection** (if `-i edge`): mask replaced by the edge map (`defaultSorter.go:125-135`, see 3.3.6).
4. **Mask** built (`defaultSorter.go:137-143`). If no mask image, an empty mask is used. Empty mask returns 0xff, which means nothing is masked (`pkg/sorter/mask.go:106-109`).
5. Convert to RGBA with alpha premultiplication (`pkg/utils/image.go:210-230`).
6. **Cycles loop** (`defaultSorter.go:149-192`): for each cycle run passes per `-o`. Each pass is a parallel strip sort (3.3.2). For `horizontal-vertical`: row pass into `dst`, copy `dst` to `src`, column pass into `dst`. Between cycles, copy `dst` to `src`.
7. **Revert rotation** (`defaultSorter.go:195-197`): rotate back by `-angle` with bilinear interpolation, then trim the transparent workspace to the original bounds (`pkg/utils/image.go:103-168`).
8. **Blend** (`defaultSorter.go:198-215`): lighten or darken, against the *unscaled* original (`sorter.image`). This is a bug when scale < 1 (see 3.7).
9. Return NRGBA image. The CLI encodes it (`cmd/image.go`).

#### 3.3.2 Strip sort (`pkg/sorter/common.go:14-161`)

- One goroutine per row (for row passes, `common.go:14-40`) or per column (column passes, `common.go:43-66`). No worker pool: Go's scheduler runs up to `GOMAXPROCS` at a time.
- Each strip is walked with `start, step, count`. Row: `start = 4*y*width`, `step = 4`, `count = width`. Column: `start = 4*x`, `step = 4*width`, `count = height` (`common.go:20, 50`). Indices are RGBA byte offsets.
- Per pixel (`common.go:75-150`), in order:
  1. Cancellation check via `ctx.Done()` (`:94-98`).
  2. If `A < 255` (any transparency, including the rotation workspace): end the current interval (`:105`).
  3. If max length is set and the interval has reached it: end the interval (`:110`).
  4. Mask lookup at `index/4` (`:112-115`, `mask.go:118-129`). If `-m` and masked: end the interval (`:120`).
  5. If the determinant test fails (3.3.3): end the interval (`:125`).
  6. Otherwise append the pixel to the interval (`:131-133`).
- **Ending an interval** (`:135-148`): if non-empty, sort into a buffer, then write the buffer into `dst` ending at the breaker pixel's index, walking backwards with `step` (`drawBufferIntoImage`, `:218-231`). The breaker is appended to the buffer and written as-is at its own position, so the breaker keeps its original colour. The sorted interval therefore occupies the `count` pixels immediately before the breaker, in ascending order left-to-right (or top-to-bottom). If empty, the breaker is written as-is.
- Strip end (`:151-157`): non-empty final interval is flushed with no breaker.
- Max length (3.3.4) is recomputed after each interval flush (`:139`).

Because intervals are drawn from `dst` and read from `src`, passes are data-race free.

#### 3.3.3 Interval determinant (`pkg/sorter/common.go:164-199`)

Each pixel is tested against `lower <= value <= upper` (inclusive), except `absolute` which is `lower <= value < upper`.

| `-i` value | Test value `v` | Formula (exact) | Source |
|---|---|---|---|
| `brightness` | perceived brightness | CIE L*/100, see 3.3.5 | `pkg/utils/brightness.go:9-17`, `common.go:166-170` |
| `hue` | hue normalised | `h/360`, where `h` is integer degrees from HSL | `common.go:172-177`, `pkg/utils/color.go:35-76` |
| `saturation` | HSL saturation | `S` from HSL, see 3.3.5 | `common.go:179-183` |
| `absolute` | product | `(R*G*B) / 16581375` (= 255^3) | `common.go:189-191` |
| `mask` | mask | pixel is in-interval iff not masked (mask >= 127) | `common.go:185-187` |
| `edge` | edge map | same as `mask`, mask is the edge map | `common.go:185-187`, 3.3.6 |

Mask semantics: a mask value below 127 means masked (`mask.go:118-129`). Masked pixels are excluded from intervals for `-i mask`, and from sorting altogether if `-m` is set.

#### 3.3.4 Max interval length with random factor (`common.go:201-213`)

- `L = -k`, `F = -r`. If `L == 0` or `F == 0`, the cap is `L` (0 means unlimited).
- Otherwise the cap is `max(1, L + (CIntn(2F) - F))`. `CIntn` is a non-seedable random int in `[0, 2F)` (`pkg/utils/random.go:9-20`, `maphash`). So the cap is uniform in `[L-F, L+F-1]`, minimum 1 (inferred from `CIntn(2F) - F` range).

#### 3.3.5 Sort keys (`pkg/sorter/interval.go:73-115`)

Weights are kept per pixel in the interval. Two kinds: normalised floats for `brightness` and `saturation`, integers for the others.

| `-e` value | Weight | Exact formula | Source |
|---|---|---|---|
| `brightness` | float | CIE L*/100 of the colour (see below) | `interval.go:74-78`, `brightness.go:9-17` |
| `hue` | int | `round(hueNorm*360)`, 0..360 | `interval.go:80-86`, `color.go:35-76` |
| `saturation` | float | HSL S, see below | `interval.go:87-93` |
| `absolute` | int | `R*G*B`, 0..16581375 | `interval.go:94-99` |
| `red` / `green` / `blue` | int | channel value 0..255 | `interval.go:100-115` |

**Brightness (CIE L*, sRGB linearised, `brightness.go`):**
- Per-channel linearisation via a 256-entry table (`brightness.go:20-24`, table at `:89`). The table matches the sRGB EOTF (index 1 = (1/255)/12.92 = 0.0003035), so it is sRGB linear (checked).
- `Y = 0.2126*Rlin + 0.7152*Glin + 0.0722*Blin` (`brightness.go:20-24`). Rec.709 luma weights.
- `L* = 116 * cbrt(Y) - 16` if `Y > 216/24389`, else `Y * 24389/27`. Result is `L*/100` (`:9-17`).
- Cube root is approximated by a quadratic initial estimate plus three Newton iterations (`:69-79`). Accuracy vs `math.Cbrt` not measured.

**HSL (`color.go:35-76`):** with `max`, `min`, `delta = max - min` over normalised channels:
- `L = (max + min) / 2`.
- `S = 0` if `delta = 0`. Else `S = delta / (max + min)` if `L <= 0.5`, else `S = delta / (2 - max - min)`.
- Hue (degrees) from the max channel, with `hueNorm` in `[0,1)`, then `round(hueNorm*360)`. Grey gives hue 0.

Note: `hue` as a sort key is integer, so 360 can occur (`round` of values near 1.0).

#### 3.3.6 Edge detection (`pkg/img/edgeDetection.go:52-86, 204-268`; `pkg/utils/image.go:244-249`)

Used for `-i edge` only (`defaultSorter.go:125-135`). Canny-style, but **non-maximum suppression is disabled** (`PerformEdgeDetection(src, false, true)`) and the direction map is not used:
1. Grey: `Y = 0.299R + 0.587G + 0.114B`, rounded down to uint8 (`image.go:244-249`).
2. Gaussian blur sigma 1.3 (`blurSigmaParam`, `edgeDetection.go:21, 55`), via `imaging.Blur`.
3. Sobel 3x3, vertical and horizontal (`edgeDetection.go:30-41, 56-57`), via `imaging.Convolve3x3`.
4. Magnitude `hypot(Gv, Gh)` (`edgeDetection.go:88-123`), where each component is converted with `NrgbaToGrayscaleComponent` (clamped 0..255, `color.go:18-21`). Then the magnitude map clamps to 0..255 (`:125-143`).
5. Hysteresis (`:204-268`):
   - `max` = maximum grey of the magnitude map. `upper = max * 0.09`, `lower = upper * 0.05`.
   - `>= upper`: strong (255). `< lower`: zero (0). Otherwise weak (75).
   - Border pixels set to zero.
   - A weak pixel becomes strong if any of its 8 neighbours is strong. Single in-place pass, so chains only partly propagate (inferred from the in-place update).
6. Invert (`invertColors = true`): strong becomes 0 (masked), zero becomes 255 (unmasked), weak becomes 180 (unmasked). So edge pixels break intervals.

Consequence (inferred): because the magnitude map is clamped to 255 before `max` is taken, `max` is 255 for almost any photo with a strong edge. That makes thresholds about 23 (strong) and about 1 (weak). If `max` is 0 (a flat image), `upper` is 0 and every pixel is strong, so nothing sorts.

#### 3.3.7 Painting (`pkg/sorter/interval.go:149-300`)

Let `n` be the interval length. If `n <= 1`, the single colour is written as-is for any painting (`interval.go:155-161`).

- **fill** (`:194-233`): permutation of the interval's own colours, ordered by the weight. `ascending` uses `sort.Slice` ascending, `descending` descending (both unstable pdqsort, deterministic for a given input). `shuffle` uses `math/rand` seeded with `time.Now().UnixNano()`, so it is not reproducible. `random` picks ascending or descending by a coin flip per interval (`:199-204`, `CIntn(2)`), so it is not reproducible either.
- **repeat** (`:164-169`): every pixel becomes `items[0].color`, the first colour in scan order. `direction` is ignored.
- **average** (`:171-192`): every pixel becomes the integer mean of R, G, B and A over the interval (`sum / n`, truncated). `direction` is ignored.
- **gradient** (`:235-300`):
  - Ascending or descending (or `random`, resolved to one of them): `a` = min-weight item (for ascending; max for descending), `c` = the opposite, `b` = the item whose weight is closest to `Lerp(a.w, c.w, 0.5)`. For `i = 0..n-1`, `t = i/(n-1)`: output = `lerp(lerp(a,b,t), lerp(b,c,t), t)`. This is a quadratic Bezier with control `b`, so the output colours are interpolated and are not a permutation of the input.
  - `shuffle`: random shuffle, then `a = items[0]`, `b = items[(n-1)/2]`, `c = items[n-1]`, same Bezier.
  - Interpolation is in RGBA, truncated to `uint8` (`pkg/utils/color.go`, `InterpolateRgba`).

#### 3.3.8 Angle (`pkg/utils/image.go:88-146`, `defaultSorter.go:117-124, 195-197`)

- `angleNorm = angle + ceil(-angle/360)*360`, so the result is in `[0, 360)` (`image.go:93, 110`). Any integer degrees is accepted. `0` skips rotation.
- Rotation: `imaging.Rotate(img, angleNorm, color.Transparent)`. Canvas grows to fit (`rotatedSize`). For 90, 180, 270 imaging uses exact transposes (`transform.go:Rotate90/180/270`, switch at `Rotate`). Other angles use bilinear sampling with alpha weighting (`transform.go:211-260`, `interpolatePoint`).
- Sign: positive angle is counter-clockwise on screen (inferred from the imaging source and its doc comment: "rotates an image by the given angle counter-clockwise").
- Sorting happens on the rotated image, so intervals run along the rotated axes. The transparent workspace breaks intervals (rule 2 in 3.3.2).
- Revert: `imaging.Rotate(..., -angleNorm)` then trim to the original bounds by centred crop (`image.go:103-168`). Non-right angles resample twice, with bilinear interpolation. This softens the output (inferred; not measured).

#### 3.3.9 Mask (`pkg/sorter/mask.go`)

- Built from a grey image. A non-grey pixel (R != G or G != B) is an error (`mask.go:32-50`).
- Value is R. Masked iff value < 127 (`mask.go:118-129`).
- Must match the input bounds exactly (`defaultSorter.go:39`). Scaled and rotated along with the image.
- `-m` (exclude) and `-i mask` (interval split) use the same mask and the same polarity. `-m` excludes masked pixels from every mode. `-i mask` makes unmasked runs into intervals.

#### 3.3.10 Cycles, order, scale, blending

- **Order** (`defaultSorter.go:149-190`): `horizontal` = row pass; `vertical` = column pass; `horizontal-vertical` = row then column; `vertical-horizontal` = column then row.
- **Cycles** (`defaultSorter.go:149, 188-190`): the whole order pipeline is repeated on the previous output.
- **Scale** (`defaultSorter.go:98-115`): applied before everything else. Output is at the scaled size. Verified: `-s 0.25` gives 839 x 447 from 3359 x 1790 (run). Scale does not upscale (`(0, 1]`).
- **Blend** (`defaultSorter.go:198-215`, `pkg/utils/image.go:187-208`): per channel `max` (lighten) or `min` (darken) of original and sorted, alpha forced to 255 (`pkg/utils/color.go:80-96`). The buffered sorter blends against the scaled source (`bufferedSorter.go:224-230`). The non-buffered sorter does not. See 3.7.

### 3.4 Performance

- Concurrency: one goroutine per row or column, no pool (`common.go:14-66`). Scheduling is left to the Go runtime.
- Per-pixel work is kept in `[]uint8` slices. `color.RGBA` values are passed by value (`common.go:76-150`).
- Sort: `sort.Slice` (pdqsort) per interval (`interval.go:207, 213`). Interval buffers are reused per strip (`common.go:76, 139`).
- Brightness: a 256-entry sRGB lookup table and an approximated cube root (`brightness.go:20-79`). The source comments claim the LUT halves run time on 6000x4000 images (not measured here).
- Pixel-wide helpers (`pimit.Parallel*`) run mask parsing, colour conversion and blending on multiple goroutines (`pkg/utils/image.go`, `pkg/utils/image.go:210-230`).
- Cancellation: `CancelSort` cancels the context, checked per pixel (`common.go:94-98`, `defaultSorter.go:68-79`).
- No SIMD. No assembly.
- Measured (run; internal timer = decode + sort + encode; 12 cores):
  - default (`-o horizontal-vertical`): 1.24 s
  - `-o horizontal`: 1.17 s
  - `-o horizontal -i edge`: 2.57 s
  - `-a 30 -o horizontal`: 1.37 s
  - `-p gradient -o horizontal -l 0 -u 1`: 0.57 s
  - `-s 0.25 -o horizontal`: 0.27 s
  - `-b lighten -o horizontal`: 1.07 s
- Memory (inferred): at least four full-size copies (decoded NRGBA, RGBA source, RGBA destination, result NRGBA), plus the mask and any rotated copies. Roughly 100+ MB for a 6 Mpx image.

### 3.5 Supported I/O

- **Input:** whatever `image.Decode` knows. JPEG and PNG are imported directly (`pkg/utils/file.go:7-8`). `Krzysztofz01/imaging` imports GIF, BMP (`golang.org/x/image/bmp`) and TIFF (`golang.org/x/image/tiff`), which register decoders on import. So GIF, BMP and TIFF should decode (inferred, not tested). Grey PNG input works (run: `L` PNG gave an RGB output).
- **Output:** `.jpg` or `.jpeg` (quality 100), or `.png`. Other extensions error out (`cmd/image.go`, `pkg/utils/file.go:66-100`).
- Alpha: PNG output keeps alpha (run: rotated output is RGBA). JPEG drops it (inferred, Go's encoder ignores alpha).
- **Size limits:** none declared. Image dimensions are `int`. The sorter holds several full-size copies (see 3.4).

### 3.6 What pixel-sorter does that pxlsort does not

- Keys: hue, saturation, absolute product, channels, and perceived brightness (pxlsort has grey average only).
- Interval determinants: hue, saturation, absolute, mask, edge.
- Painting: repeat, average, gradient (pxlsort: fill only).
- Directions: descending, shuffle, random.
- Masks, including `-m` exclusion, and edge-detected intervals.
- Arbitrary angles, scaling, cycles, lighten/darken blending.
- Max interval length with random jitter.
- Library API (`pkg/sorter`) with cancellation and a buffered variant with state caching (experimental, see 3.7).

### 3.7 Known defects summary (pixel-sorter)

| # | Defect | Evidence |
|---|---|---|
| 1 | `-s < 1` with `-b lighten` or `-b darken` fails with "the provided images have different width" (blend against unscaled original). Output is nothing. | run (`defaultSorter.go:202, 208`) |
| 2 | `bufferedSorter` (library only, not in CLI): rotated mask is built by rotating the **image**, not the mask: `srcMaskImageNrgba = utils.RotateImageNrgba(srcImageNrgba, options.Angle)` | read (`bufferedSorter.go:133`) |
| 3 | `bufferedSorter`: edge-detection result is assigned to a shadowed variable (`srcMaskImageNrgba, err := ...`), so the first call does not use it | read (`bufferedSorter.go:146`) |
| 4 | `ctx.Done()` is called as an expression in error paths and does nothing | read (`defaultSorter.go:32, 61`, `common.go` error paths) |
| 5 | Shuffle and random directions are not reproducible: time-seeded RNG, and no seed flag | read (`interval.go:220, 295`; `random.go`) |
| 6 | Threshold defaults (0.1, 0.9) are shared by all determinants, so default hue sorting skips extremes | read (`cmd/root.go:83, 85`) |
| 7 | README says Go 1.19+; go.mod says 1.23 | read (`README.md`, `go.mod:3`) |

## 4. Comparison

| Aspect | pxlsort | pixel-sorter |
|---|---|---|
| Language | C | Go |
| Licence | none (all rights reserved) | GPL-3.0 (GitHub SPDX `GPL-3.0`) |
| Activity (2026-11-24) | created 2025-11-06, updated 2026-09-13, 2 stars, 0 open issues | last push 2025-07-19, 6 stars, 3 open issues, no releases |
| Interface | CLI only, 4 flags + 1 help | CLI (cobra) plus Go library; 18 flags + help |
| Axis | horizontal only | horizontal, vertical, both orders, any angle |
| Interval splitting | grey band [lb, ub] on RGB average | brightness, hue, saturation, absolute, mask, edge; threshold window |
| Max interval length | no | yes, with random jitter |
| Sort keys | grey (R+G+B)/3 | brightness (CIE L*), hue, saturation, absolute, R, G, B |
| Direction | ascending only | ascending, descending, shuffle, random |
| Tolerance | `-n noise` in merge comparator | none |
| Painting | fill only (sorted permutation) | fill, repeat, average, gradient (Bezier) |
| Masks | none | external grey mask; exclude with `-m`; mask as interval determinant |
| Edge detection | none | Canny-style, NMS off, hysteresis, inverted polarity |
| Angle | none | any integer degrees; rotated workspace skipped |
| Scale | none | Lanczos downscale before sorting |
| Cycles | none | yes |
| Blending | none | lighten, darken (broken when scale < 1) |
| Parallelism | POSIX thread pool (default 20), one job per run | goroutine per row or column; sort.Slice per interval |
| Sort algorithm | bottom-up merge sort per run | pdqsort (`sort.Slice`) per interval |
| SIMD | none | none |
| Cancellation | none | yes (context per pixel) |
| Seeding | rand not used | time-seeded for shuffle/random; not reproducible |
| Input formats | JPEG, PNG | JPEG, PNG; GIF, BMP, TIFF by import (inferred) |
| Output formats | PNG bytes regardless of name | JPEG (q100) or PNG by extension |
| Grey and grey+alpha input | crashes (run) | works (run) |
| RGBA handling | alpha not moved, kept positional | alpha premultiplied, carried through |
| Build deps | stb (not vendored) | Go modules (imaging fork, pimit, cobra, logrus) |
| Speed, 6 Mpx, default run (run) | 0.96 s wall, full process | 1.24 s internal, full process |

## 5. Features for the GUI editor

Take from pixel-sorter, with reasons:

1. **Interval determinant plus a threshold window** (brightness, hue, saturation, absolute, with a two-handle range slider). This is the core control of the effect. The determinant set is the main creative vocabulary.
2. **Sort-key list** (brightness, hue, saturation, absolute, R, G, B) with direction (ascending, descending) and the shuffle and random options. Cheap to expose; very visible.
3. **Painting modes** (fill, repeat, average, gradient). Gives the user distinctly different looks from the same intervals. Gradient needs care (it is not a permutation).
4. **Painting-mask workflow.** pixel-sorter only takes an external file. A GUI can let the user brush the mask directly, with a live overlay. The mask semantics (below 127 is masked; `-m` excludes; `-i mask` splits) should be kept as documented.
5. **Edge-based intervals** (Canny-style). Good creative value. Expose the thresholds that are now hard-coded (sigma 1.3, 0.09, 0.05).
6. **Arbitrary angle** with a clean canvas expansion and transparent-workspace skipping. Expose a dial, and snap to 0, 90, 180, 270 to avoid resampling.
7. **Maximum interval length with random jitter.** Cheap glitch variety; one slider, one jitter slider.
8. **Scale for preview.** Run the sort on a downscaled copy while the user drags sliders, then re-run at full size. Needs the blend fix (3.7 item 1) so that lighten/darken works at any scale.
9. **Cycles** and **order** (horizontal, vertical, both orders). Multi-pass composition is where the most interesting results come from.
10. **Lighten and darken blending** against the original. Cheap and useful for mixing back detail. Implement it against the source at the working resolution.
11. **Cancellation per pixel.** Required for interactive sliders.

Take from pxlsort, with reasons:

1. **Noise as a comparator tolerance** (`-n`). Expose it as a "clumpiness" slider. It is the only parameter that changes the merge comparator, and it produces a different texture from threshold splitting. Implement it in our own terms, not via pxlsort's code.
2. **A per-strip job queue with bounded workers.** Simple and effective for row or column work. Use a bounded pool sized to the device, not 20 threads.
3. **Grey-band preset** (`-lb 50 -ub 160`, `-n 3`). Useful as a one-click starting look. Fast default (under 1 s on a 6 Mpx image here).
4. **Minimalism.** A single-purpose path with few parameters is easier to learn. Keep one "quick" mode in the UI alongside the full controls.

Do not take from either:
- pxlsort's PNG-regardless output behaviour, or its grey-only sort key without a choice.
- pixel-sorter's time-seeded random without a seed control (make it seedable).
- pixel-sorter's unscaled blend, and its bufferedSorter rotation bug.

## 6. Open questions and sources not accessed

- Not accessed: nothing in the requested scope. Both repos were cloned in full (shallow). Git history was not inspected beyond HEAD.
- Not verified by running: row-start skip and final unflushed run in pxlsort (inferred); pxlsort `-n` effect on output (inferred); pixel-sorter `-i edge` output polarity and thresholds (inferred from code, timing only); pixel-sorter GIF, BMP and TIFF decoding; pixel-sorter mask polarity (inferred from code); bilinear softening at non-right angles (inferred); pixel-sorter bufferedSorter bugs (code read only, the CLI does not use it).
- Licence decision for us (port vs clean-room) is for the lead. Recommendation: clean-room, written from this document.
- If the engine spec is written by a model that also reads the Go or C source, that undercuts a clean-room claim. Keep the engine author on this document.
