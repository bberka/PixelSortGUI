Written by Gemini 4 Neon (Antigravity, thought level medium), implementation subagent.

# Spike S1: Engine Throughput and Preview Latency

Status: completed, 2026-11-24. Tests decisions D1, D2, and D9 in [decisions.md](../specs/decisions.md) against the targets in [engine.md section 9](../specs/engine.md#9-performance-budgets) and [roadmap.md S1](../specs/roadmap.md#milestone-1-technical-spikes).

## Verdict and recommendation

**Recommendation: Proceed with plain TypeScript in Web Workers (no WebAssembly or native engine needed), with one algorithm recommendation for `T2.3` and one spec-budget note for Firefox at full resolution.**

Plain TypeScript typed-array kernels in a Web Worker exceed the 25 MP/s throughput budget by **2.9×–3.3×** in both Chromium (83.3 MP/s) and Firefox (78.9 MP/s), scale linearly to the 50 MP guaranteed maximum (581–624 ms at angle 0), keep `drag` p95 under 21 ms and `settle` p95 under 97 ms, produce zero main-thread long tasks over 50 ms, and cancel stale renders in **1.5–9.0 ms** via 8 ms `MessageChannel` time slicing.

Two concrete recommendations for the lead (no changes made to `docs/specs/engine.md` in this spike):

1. **Use 2-pass 8-bit LSD radix sort (`radix-16`, insertion cutoff `n ≤ 32`) instead of `Uint32Array.prototype.sort()` in `T2.3`:** It is 100% bit-exact with the spec's stable 16-bit key order and beats `Uint32Array.prototype.sort()` by **1.60×** at angle 0 (144.1 ms vs 231.2 ms) and **1.43×** at angle 30 (212.4 ms vs 304.1 ms) in Chromium, while remaining within ~10% in Firefox (168.0 ms vs 152.0 ms).
2. **Accept or refine the `angle 30 ≤ 1.5× angle 0` ratio for > 4 MP images in Firefox:** Chromium passed at **1.47×** (12 MP p50), and Firefox passed on 4 MP `settle` (**1.39×**, 99.0 ms / 71.0 ms), but Firefox measured **1.78×** on 12 MP (270.0 ms / 152.0 ms). This is not an absolute speed problem — Firefox angle 30 still runs at **44.4 MP/s** (1.78× above the 25 MP/s floor) and `settle` angle 30 p95 is **159.0 ms** (well under 300 ms). The ratio exceeds 1.5× because angle 0 is very fast (78.9 MP/s) while strided diagonal gather/scatter across a 48 MB buffer exceeds L3 cache. Either log this as an accepted gap for > 4 MP diagonal renders in Firefox, relax the full-res ratio target to `≤ 2.0×`, or explore cache-blocked diagonal gather in `T2.3`.

---

## Test environment

Measured directly on the host machine (not estimated):

| Component | Value |
| --- | --- |
| CPU | 13th Gen Intel(R) Core(TM) i7-13650HX (14 physical cores, 20 logical threads, 1 socket) |
| RAM | 62 GiB (`62.4 GiB` reported by Node `os.totalmem()`) |
| OS | CachyOS Linux (rolling, Arch-based), kernel `Linux 7.3.5-2-cachyos x86_64` |
| Runtime | Node.js `v26.13.1`, pnpm `12.15.0`, Playwright `1.65.1` |
| Chromium | `159.0.8154.6` (Playwright bundled) |
| Firefox | `159.0` (Playwright bundled) |

---

## Method

- **Prototype:** Isolated under `spikes/s1/` (`synthetic.ts`, `kernel.ts`, `protocol.ts`, `worker.ts`, `bench.ts`, `bench.html`, `report-types.ts`) with a one-command Playwright runner at `scripts/spike-s1-bench.ts` (`vp run bench:s1`). Not imported by `src/` and not bundled into `dist/`.
- **Kernel fidelity:** Implements `engine.md` section 5 `luma` `key16` integer arithmetic, `threshold = [0.25, 0.80]` (`lo16 = 16384`, `hi16 = 52428`, alpha 0 excluded), angle 0 row fast path, and angle 30 integer line partition (`DX = 3547`, `DY = -2048`, two-pointer exact bounds, zero resampling). A unit test (`tests/spike-s1-kernel.test.ts`) verifies exact `lumaKey16` values, exact single-visit pixel coverage for angle 30, multiset preservation, and bit-exact equality between `typed-array` and `radix-16`.
- **Worker & cancellation:** Runs in a module Web Worker with cooperative 8 ms `MessageChannel` yields (`checkpoint()` invoked between lines every ≥ 16,384 pixels). For preview benchmarks (`drag` and `settle`), the worker creates an `ImageBitmap` via `createImageBitmap(new ImageData(...))`, transfers it to the main thread, draws it onto a `<canvas>` via `ctx.drawImage`, closes the bitmap, and awaits `requestAnimationFrame` to measure end-to-end visible update latency.
- **Synthetic image:** `generateSyntheticPhoto(width, height)` synthesizes a deterministic photo-like scene using integer wave tables and `mix32` (`lowbias32`): a sky-to-horizon gradient with cloud modulation, darker foreground ridges, a bright highlight disc (`luma > 0.80`), a dark shadow disc (`luma < 0.25`), an architectural vertical pillar with dark edges and striped mid-tones, and deterministic ±16 per-pixel grain. At 12 MP (`4000 × 3000`, angle 0, default threshold `[0.25, 0.80]`):
  - Selected pixels: **66.6%** (`7,992,000` of `12,000,000` px)
  - Run count: **466,341**
  - Run lengths: **mean 17.1 px**, **p50 2 px**, **p95 14 px**, **max 4,000 px**
  - Why it is a fair stand-in: it exercises both the short-run insertion-sort path (noisy threshold edges) and long-run sorting (up to full-width 4,000 px sky/gradient runs) with a realistic ~2/3 selected fraction, without committing any photograph.
- **Sample sizes (headless primary run):**
  - 12 MP algorithm comparison: 2 warmup + 7 measured runs per case
  - 24 MP (`5656 × 4244`, 24.004 MP): 1 warmup + 5 measured runs per angle
  - 50 MP (`8166 × 6124`, 50.009 MP): 1 warmup + 3 measured runs per angle
  - `drag` (`1182 × 886`, 1.047 MP, 1 MP cap on 4:3): 3 warmup + 21 measured runs per angle
  - `settle` (`2364 × 1773`, 4.191 MP, 4 MP cap on 4:3): 2 warmup + 11 measured runs per angle
  - Cancellation latency: 15 trials per case (cancel sent 15 ms into 4 MP `settle`, 20 ms into 12 MP)
- **Main-thread measurement:** `PerformanceObserver({entryTypes: ['longtask']})` in Chromium (which reports any task > 50 ms), paired with a cross-browser 16 ms `setInterval` event-loop stall probe and per-frame `drawImage` timing in both Chromium and Firefox (because Firefox does not implement the Long Tasks API).
- **Memory measurement:** Worker `performance.memory.usedJSHeapSize` in Chromium (`--enable-precise-memory-info`), plus Linux `/proc/<pid>/status` `VmRSS` summed across newly launched browser processes every 500 ms in both Chromium and Firefox.

---

## Pass / fail criteria summary (headless)

Reproduced with `vp run bench:s1`:

| Criterion (from roadmap S1) | Target | Chromium 159 (headless) | Firefox 159 (headless) |
| --- | --- | --- | --- |
| `drag` worker p95 (1 MP cap, angle 0) | ≤ 50 ms | **PASS** — `19.2 ms` (angle 30: `28.9 ms`) | **PASS** — `21.0 ms` (angle 30: `46.0 ms`) |
| Visible update p95 (`drag`, angle 0) | ≤ 100 ms | **PASS** — `20.0 ms` (angle 30: `39.6 ms`) | **PASS** — `25.0 ms` (angle 30: `48.0 ms`) |
| `settle` worker p95 (4 MP cap, angle 0) | ≤ 300 ms | **PASS** — `60.0 ms` (angle 30: `93.2 ms`) | **PASS** — `97.0 ms` (angle 30: `159.0 ms`) |
| Angle 30 vs angle 0 ratio (12 MP p50) | ≤ 1.5× | **PASS** — `1.47×` (`212.4 / 144.1 ms`) | **FAIL** — `1.78×` (`270.0 / 152.0 ms`; 4 MP `settle` is `1.39×`) |
| Main-thread long task | none > 50 ms | **PASS** — `0` long tasks (`0.0 ms`; stall max `2.9 ms`) | **PASS** — stall probe max `12.0 ms`, max draw `17.0 ms` (Long Tasks API unsupported) |
| Throughput (12 MP, angle 0, p50) | ≥ 25 MP/s | **PASS** — `83.3 MP/s` (`radix-16`) | **PASS** — `78.9 MP/s` (`typed-array`; `radix-16`: `71.4 MP/s`) |

---

## Full results

### 1. Sorting algorithm comparison (12 MP, `4000 × 3000`, headless)

| Algorithm | Exact 16-bit? | Angle | Chromium p50 (ms) | Chromium p95 (ms) | Chromium MP/s (p50) | Firefox p50 (ms) | Firefox p95 (ms) | Firefox MP/s (p50) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `typed-array` (`Uint32Array.sort`, insertion ≤ 24) | Yes | 0° | 231.2 | 239.9 | 51.9 | **152.0** | **157.0** | **78.9** |
| `typed-array` | Yes | 30° | 304.1 | 311.5 | 39.5 | **270.0** | **276.0** | **44.4** |
| `radix-16` (2-pass 8-bit LSD, insertion ≤ 32) | Yes | 0° | **144.1** | **164.7** | **83.3** | 168.0 | 244.0 | 71.4 |
| `radix-16` | Yes | 30° | **212.4** | **216.4** | **56.5** | 277.0 | 294.0 | 43.3 |
| `counting-8` (1-pass 8-bit quantized key) | No (8-bit) | 0° | 118.2 | 119.8 | 101.5 | 112.0 | 114.0 | 107.1 |
| `counting-8` | No (8-bit) | 30° | 196.3 | 202.6 | 61.1 | 231.0 | 262.0 | 51.9 |

**Takeaway:**
- In Chromium (V8), `radix-16` beats `typed-array` by **1.60×** at angle 0 (37.7% less time) and **1.43×** at angle 30 (30.2% less time), with bit-exact identical output.
- In Firefox (SpiderMonkey), `Uint32Array.prototype.sort()` is backed by a fast native C++ sort, so `typed-array` slightly edges out JS `radix-16` by **1.11×** at angle 0 and **1.03×** at angle 30 — though both are already ~3× above the 25 MP/s floor.
- `counting-8` saves another 18–26% by skipping the second radix pass and index gather, at the cost of quantizing keys to 8 bits (not bit-exact with `engine.md §5.3`). Because exact 16-bit `radix-16` already runs at 71–83 MP/s, trading away 16-bit key precision is unnecessary.

### 2. Full-resolution throughput and memory scaling (headless)

Using each browser's winning exact algorithm (`radix-16` in Chromium, `typed-array` in Firefox):

| Size | Dimensions | Angle | Chromium p50 (ms) | Chromium p95 (ms) | Chromium MP/s (p50) | Chromium yields | Firefox p50 (ms) | Firefox p95 (ms) | Firefox MP/s (p50) | Firefox yields |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12 MP | `4000 × 3000` | 0° | 144.1 | 164.7 | 83.3 | 17.7 | 152.0 | 157.0 | 78.9 | 18.6 |
| 12 MP | `4000 × 3000` | 30° | 212.4 | 216.4 | 56.5 | 25.6 | 270.0 | 276.0 | 44.4 | 33.1 |
| 24 MP | `5656 × 4244` | 0° | 288.9 | 301.8 | 83.1 | 35.6 | 306.0 | 360.0 | 78.4 | 39.4 |
| 24 MP | `5656 × 4244` | 30° | 426.3 | 443.3 | 56.3 | 51.8 | 520.0 | 587.0 | 46.2 | 65.0 |
| 50 MP | `8166 × 6124` | 0° | 581.0 | 592.8 | 86.1 | 71.3 | 624.0 | 678.0 | 80.1 | 79.3 |
| 50 MP | `8166 × 6124` | 30° | 884.4 | 912.1 | 56.5 | 108.3 | 1042.0 | 1072.0 | 48.0 | 129.3 |

**Observed peak memory (including 50 MP ~200 MB source + ~200 MB output buffers):**
- Chromium (headless): Worker JS heap `3.1 MiB` (`ArrayBuffer` backing stores live outside V8's GC heap); observed peak browser process-tree `VmRSS` **889.8 MiB**.
- Firefox (headless): `performance.memory` unavailable; observed peak browser process-tree `VmRSS` **1,333.2 MiB**.
- Throughput scales almost perfectly linearly from 12 MP to 50 MP (`83.3 → 83.1 → 86.1 MP/s` in Chromium; `78.9 → 78.4 → 80.1 MP/s` in Firefox), with zero GC stalls.

### 3. Preview latency (`drag` and `settle`, headless)

Proxy sizes from a 12 MP (`4000 × 3000`) source per `engine.md §8.1–§8.2`:
- `drag` (1 MP cap): `1182 × 886` (`1.047 MP`)
- `settle` (4 MP cap): `2364 × 1773` (`4.191 MP`)

| Browser | Level | Angle | Kernel p50 (ms) | `createImageBitmap` p50 (ms) | Worker total p50 / p95 (ms) | Main `drawImage` p50 (ms) | Visible update p50 / p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chromium | `drag` | 0° | 13.3 | 1.7 | 14.9 / **19.2** | 0.0 | 16.0 / **20.0** |
| Chromium | `drag` | 30° | 19.3 | 1.7 | 21.0 / **28.9** | 0.0 | 22.0 / **39.6** |
| Chromium | `settle` | 0° | 51.0 | 5.0 | 55.9 / **60.0** | 0.0 | 58.9 / **62.0** |
| Chromium | `settle` | 30° | 75.4 | 5.2 | 80.6 / **93.2** | 0.0 | 83.2 / **95.8** |
| Firefox | `drag` | 0° | 17.0 | 3.0 | 19.0 / **21.0** | 2.0 | 21.0 / **25.0** |
| Firefox | `drag` | 30° | 26.0 | 3.0 | 29.0 / **46.0** | 3.0 | 32.0 / **48.0** |
| Firefox | `settle` | 0° | 60.0 | 8.0 | 71.0 / **97.0** | 10.0 | 78.0 / **107.0** |
| Firefox | `settle` | 30° | 91.0 | 9.0 | 99.0 / **159.0** | 6.0 | 107.0 / **167.0** |

### 4. Where time goes: phase breakdown (12 MP, headless)

| Browser | Algorithm | Angle | Gather | Key + select | Sort | Scatter |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium | `typed-array` | 0° | 3.4 ms (1.6%) | 62.3 ms (28.6%) | **148.6 ms (68.2%)** | 3.5 ms (1.6%) |
| Chromium | `typed-array` | 30° | 58.1 ms (20.1%) | 64.6 ms (22.3%) | **146.3 ms (50.6%)** | 20.3 ms (7.0%) |
| Chromium | `radix-16` | 0° | 2.9 ms (2.0%) | 63.0 ms (43.5%) | **75.1 ms (51.9%)** | 3.8 ms (2.6%) |
| Chromium | `radix-16` | 30° | 63.1 ms (27.0%) | 66.2 ms (28.4%) | **84.2 ms (36.1%)** | 19.8 ms (8.5%) |
| Firefox | `typed-array` | 0° | 1.3 ms (0.9%) | 56.0 ms (36.0%) | **96.0 ms (61.7%)** | 2.3 ms (1.5%) |
| Firefox | `typed-array` | 30° | 92.3 ms (32.4%) | 50.0 ms (17.5%) | **104.3 ms (36.6%)** | 38.3 ms (13.5%) |
| Firefox | `radix-16` | 0° | 3.7 ms (2.4%) | 48.0 ms (31.1%) | **100.3 ms (65.0%)** | 2.3 ms (1.5%) |
| Firefox | `radix-16` | 30° | 89.0 ms (31.8%) | 49.3 ms (17.6%) | **116.3 ms (41.6%)** | 25.0 ms (8.9%) |

**What dominates:**
- At **angle 0**, sorting dominates (`52–68%`), followed by `lumaKey16` + threshold selection (`29–44%`). Row copy (`gather` + `scatter`) is negligible (`< 5%`).
- At **angle 30**, **strided memory gather + scatter** jumps from ~6 ms to **83 ms (35.5%)** in Chromium and **131 ms (45.9%)** in Firefox, because stepping diagonally across a 48 MB RGBA buffer causes L3 cache misses. Reading `R, G, B, A` from the contiguous L1-cached `linePixels` buffer during `key + select` (rather than re-reading strided `input`) was critical — without that, `key + select` doubled from 65 ms to 143 ms and pushed Chromium to 1.70×.
- Transfer and drawing overhead (`createImageBitmap` + `drawImage`) is tiny in Chromium (~1.7 ms at `drag`, ~5.0 ms at `settle`, `0.0 ms` draw) and modest in Firefox (~5 ms at `drag`, ~18 ms at `settle`).

### 5. Cooperative cancellation latency (8 ms `MessageChannel` slicing, headless)

| Workload | Chromium p50 / p95 / max (ms) | Firefox p50 / p95 / max (ms) |
| --- | --- | --- |
| `settle` (4 MP), angle 0° (15 trials) | 1.3 / 1.5 / 1.5 | 1.0 / 2.0 / 2.0 |
| `settle` (4 MP), angle 30° (15 trials) | 1.4 / 1.8 / 1.8 | 1.0 / 2.0 / 2.0 |
| Full 12 MP, angle 0° (15 trials) | 4.4 / 4.6 / 4.6 | 4.0 / 5.0 / 5.0 |

Cancellation completes in well under one 8 ms time slice (typically 1–5 ms, worst case 9 ms in Firefox), with zero `SharedArrayBuffer` or COOP/COEP headers required.

---

## Headless vs headed comparison

Checked on the same machine under Wayland (`DISPLAY=:1`, `WAYLAND_DISPLAY=wayland-1`) using `TMPDIR=/tmp node scripts/spike-s1-bench.ts --headed --quick` (`TMPDIR=/tmp` was required because the sandbox's default `TMPDIR` exceeded Linux's 108-byte `SingletonSocket` path limit for headed Chromium):

| Measure | Chromium headless | Chromium headed (`--quick`) | Firefox headless | Firefox headed (`--quick`) |
| --- | --- | --- | --- | --- |
| 12 MP angle 0° p50 | 144.1 ms (83.3 MP/s) | 152.9 ms (78.5 MP/s) | 152.0 ms (78.9 MP/s) | 151.0 ms (79.5 MP/s) |
| 12 MP angle 30° / 0° ratio | 1.47× | 1.48× | 1.78× | 2.01× |
| `drag` worker p50 / p95 (0°) | 14.9 / 19.2 ms | 16.9 / 21.0 ms | 19.0 / 21.0 ms | 26.0 / 37.0 ms |
| `drag` visible p50 / p95 (0°) | 16.0 / 20.0 ms | 18.2 / 22.4 ms | 21.0 / 25.0 ms | 29.0 / 104.0 ms* |
| `settle` worker p50 / p95 (0°) | 55.9 / 60.0 ms | 62.8 / 67.5 ms | 71.0 / 97.0 ms | 83.0 / 86.0 ms |
| Main-thread `drawImage` max | 2.5 ms | 0.5 ms | 17.0 ms | 20.0 ms |
| Observed peak RSS | 889.8 MiB | 1,643.9 MiB | 1,333.2 MiB | 1,667.0 MiB |

\*In headed Firefox `--quick` (5 measured runs), `drag` visible update p50 was `29.0 ms` with a single compositor/vsync outlier at `104.0 ms` (`drag` angle 30° p95 was `65.0 ms`).

**Differences observed:**
- Chromium headed and headless results are closely aligned (~5–6% difference in kernel throughput, ~2 ms difference in preview latency). Peak RSS is higher in headed mode due to compositor/GPU window surfaces.
- Firefox headed shows slightly higher `drawImage` + compositor latency (4 ms on `drag`, 11–13 ms on `settle`) and higher frame-to-frame jitter than headless Firefox, though median interactive latency (`29 ms` drag, `94 ms` settle) remains well inside budgets.

---

## What this benchmark does not tell us

1. **Single high-end desktop laptop:** The test machine is a 13th Gen Intel Core i7-13650HX with 62 GiB RAM on Linux. It says nothing about phones, tablets, older/low-power laptops (e.g., fanless i5/M1 under thermal throttling), or macOS/Windows compositor behavior.
2. **No Safari / WebKit:** Only Chromium and Firefox were tested (matching first-release targets in D17).
3. **Single effect, simplest mode:** Only one `pixelSort` instance with `luma` key and `threshold` selection was measured. Multi-instance stacks, `edges` mode (Sobel + box blur), or `hue`/`saturation` keys will take longer; the spec's `StageCache` and adaptive `drag` cap (down to 0.125 MP) are untested here.
4. **No image decode/encode:** Full project-open and PNG/JPEG export budgets (`engine.md §9`) include `createImageBitmap` decode and `OffscreenCanvas.convertToBlob` encode, which were outside S1's scope.
5. **Synthetic run distribution:** The synthetic image's per-pixel grain produces many short runs (p50 = 2 px, p95 = 14 px, max = 4,000 px). Cleaner, heavily denoised photos with mostly 500–2,000 px runs will spend a higher share of time in the sort phase (where `radix-16` widens its lead over `Uint32Array.prototype.sort()`).

## Lead agent rerun

Rerun by Claude Fable 5.2 (thinking medium), lead agent, on the same machine with `vp run bench:s1` (headless, 65 s wall time), 2026-11-24.

| Criterion | Chromium 159 | Firefox 159 |
| --- | --- | --- |
| `drag` p95 ≤ 50 ms | pass, 15.6 ms | pass, 28.0 ms |
| Visible update p95 ≤ 100 ms | pass, 17.1 ms | pass, 31.0 ms |
| `settle` p95 ≤ 300 ms | pass, 61.8 ms | pass, 82.0 ms |
| Angle 30 ≤ 1.5× angle 0 (12 MP p50) | **fail, 1.57×** (220.0 / 139.7 ms) | fail, 1.77× (267.0 / 151.0 ms) |
| No main-thread task > 50 ms | pass, 0 long tasks | pass, stall max 14.0 ms |
| Throughput ≥ 25 MP/s (12 MP, angle 0) | pass, 85.9 MP/s | pass, 79.5 MP/s |

The angle ratio in Chromium was 1.47× in the author's run and 1.57× in this one, so that result sits on the threshold and varies between runs. The ratio fails in Firefox in both runs. Every absolute budget passes with a margin of about three times or more, and angle 30 at 12 MP still runs at 44 to 55 MP/s against a 25 MP/s floor.

Ruling: proceed with TypeScript in Web Workers. The ratio criterion is replaced in `engine.md` section 9 by an absolute one (angled sorting must meet the same throughput floor), because the ratio penalises a fast axis-aligned path and says nothing about whether angled sorting is fast enough.
