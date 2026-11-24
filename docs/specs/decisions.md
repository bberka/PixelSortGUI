Written by Gemini 4 Neon (Antigravity, thought level high), spec subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.

# PixelSortGUI decisions and open questions

Status: draft for owner review, 2026-11-24. Companion specs: [product.md](product.md), [engine.md](engine.md), [persistence.md](persistence.md), [../../DESIGN.md](../../DESIGN.md), [roadmap.md](roadmap.md).

**Answer to native versus web:** Start web-first, not native-first. A static web app backed by a TypeScript Web Worker sorting engine satisfies the offline, local-only, phone/tablet/desktop goals without depending on GPU availability, and keeping the image engine pure TypeScript lets the same codebase be packaged later with Tauri (desktop) or Capacitor (mobile). Revisit native-first only if Spike S2 proves that iOS Safari's verified 16.78 MP single-canvas limit and 384 MB canvas memory cap prevent reliable full-resolution mobile exports even with tiled decode and Wasm/JS encoders.

---

## Architecture and product decisions

### D1. Web-first versus native-first

- **Options considered:** (a) Static web app / PWA first, native packaging later if needed; (b) Native desktop/mobile app first (Rust/Swift/Kotlin or Tauri/Capacitor from day one).
- **Choice:** Web-first static PWA, with a DOM-free TypeScript engine (`src/engine/`) that can later sit inside Tauri or Capacitor.
- **Reason:** Matches the owner's primary request (static-hostable, offline, local-only, runs on phone/tablet/desktop with zero store friction) and avoids maintaining platform-specific UI and distribution pipelines before the core editor is proven.
- **Revisit if:** Spike S2 fails to deliver acceptable 24 MP mobile exports on iOS Safari and the owner rejects capping iOS export at ≤ 16.78 MP, or if deep OS file/background workflows become mandatory.

### D2. Compute path

- **Options considered:** (a) TypeScript typed-array kernels in a Web Worker; (b) Rust/Wasm SIMD + threads; (c) WebGPU compute shaders as primary engine; (d) WebGL2 fragment shader ping-pong passes.
- **Choice:** TypeScript typed-array kernels in a Web Worker as the baseline and reference implementation; optional WebGPU acceleration later (`src/engine/gpu/`), single-thread Wasm SIMD only if Spike S1 shows a CPU bottleneck.
- **Reason:** Pixel sorting constructs variable-length runs along arbitrary angles and paths, which fit CPU typed-array code cleanly and give exact cross-browser determinism. WebGPU now ships in modern Chrome, Android Chrome 121+, Safari 26+, and Windows/Apple Silicon Firefox 141+/145+, but Linux, Intel Mac Firefox, Firefox Android, older iOS (< 26), and older Android still require a CPU fallback. Avoiding Wasm threads avoids `SharedArrayBuffer` and cross-origin isolation (D6).
- **Revisit if:** Spike S1 misses interactive latency budgets on reference phones by a wide margin even with adaptive `drag` caps, in which case single-thread Wasm SIMD (no COOP/COEP required) is evaluated next.

### D3. UI framework, styling, and state library

- **Options considered:** (a) React 19 + TypeScript + Tailwind 4 + shadcn/ui + Zustand; (b) Solid/Svelte/Preact with custom UI components; (c) React Context + `useReducer` without an external store.
- **Choice:** React 19, TypeScript, Tailwind 4, shadcn/ui (`new-york`, Radix primitives, `lucide-react`), and Zustand for app state, with imperative canvas drawing outside React state.
- **Reason:** The owner requested Tailwind and shadcn components, and shadcn's canonical ecosystem is React. In a photo editor, pixel processing dominates runtime cost; keeping transient drag state and canvas redraws out of React prevents framework overhead. Zustand gives fine-grained subscriptions for sliders, stack items, and progress without provider nesting.
- **Revisit if:** Profiling shows React reconciliation during slider drags causes main-thread tasks > 50 ms (mitigate by isolating transient values into refs/Zustand transient subscribers before reconsidering the framework).

### D4. Persistence and storage architecture

- **Options considered:** (a) IndexedDB as primary catalog and blob store + `localStorage` theme mirror; (b) OPFS for blobs + IndexedDB for metadata; (c) File System Access API handles referencing files on disk.
- **Choice:** IndexedDB (`pixelsortgui`) for all source blobs, projects, thumbnails, history, presets, and app state, with SHA-256 source deduplication, parameter-snapshot history (up to 200 undoable commits), and a single `localStorage` key (`psg:theme`) for zero-flash theme boot.
- **Reason:** IndexedDB works uniformly across Chrome, Firefox, and Safari/iOS with atomic transactions and schema upgrades. File System Access pickers are Chromium-only and handles can be revoked. OPFS shares the exact same origin quota and eviction rules as IndexedDB, so adding a second persistence system for v1 adds recovery complexity without solving eviction.
- **Revisit if:** Future video/animation workflows or large painted mask layers require streaming random-access scratch files where worker-side OPFS `FileSystemSyncAccessHandle` measurably cuts peak RAM.

### D5. Clean-room own engine versus porting surveyed projects

- **Options considered:** (a) Port `notlauren/pxlsort` or `Krzysztofz01/pixel-sorter`; (b) Port parts of MIT surveyed repos (`satyarth/pixelsort`, `czycha/pxlsrt`, `GarrettGunnell/Pixel-Sorting`, `ruccho/BitonicPixelSorter`); (c) Write a clean-room TypeScript engine from our own spec formulas.
- **Choice:** Clean-room own implementation for the first release (`engine.md`). Direct code reuse is forbidden from unlicensed (`pxlsort`, `ASDFPixelSort`, `Pixel Sortium`, etc.), CC BY-NC-SA (`jeffThompson`), and GPL-3.0 (`pixel-sorter`, `rkargon/pixelsorter`) projects; MIT-attributed porting is reserved for non-obvious later additions (such as `ruccho/BitonicPixelSorter`'s WebGPU bitonic scan shader).
- **Reason:** Neither tool the owner originally named can be ported safely (`pxlsort` has no licence; `pixel-sorter` is GPL-3.0). Writing from exact formulas in `engine.md` guarantees licence clarity regardless of which project licence the owner selects (Q2) and avoids inheriting known defects from the reference CLIs.
- **Revisit if:** Never for unlicensed or GPL-3.0 code (unless the owner chooses GPL-3.0 for PixelSortGUI). For MIT repos, reuse is already permitted whenever it saves non-trivial work and its notice is added to `THIRD-PARTY-NOTICES.md`.

### D6. PWA offline support without cross-origin isolation (COOP/COEP)

- **Options considered:** (a) Standard static PWA with Workbox precaching and no COOP/COEP headers; (b) Require COOP/COEP (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`) for `SharedArrayBuffer` cancellation flags and Wasm threads, using Cloudflare headers or `coi-serviceworker` on GitHub Pages.
- **Choice:** Standard static PWA with **no** cross-origin isolation requirement. Preview worker cancellation uses cooperative 8 ms `MessageChannel` time slicing (`engine.md` section 8.4) and export cancellation uses `worker.terminate()`.
- **Reason:** GitHub Pages cannot natively serve custom HTTP response headers, and `coi-serviceworker` requires an extra reload on first visit and imposes strict CORP friction. Removing the COOP/COEP dependency keeps `dist/` portable to any static host, local `vp run gui`, and future Tauri/Capacitor shells.
- **Revisit if:** Multi-threaded Wasm proves necessary for video/high-MP exports and deployment settles on a host that sets COOP/COEP natively (such as Cloudflare Pages).

### D7. Export encoders and iOS canvas-limit strategy

- **Options considered:** (a) Single-canvas `convertToBlob` for all formats and sizes; (b) Native `convertToBlob` within platform canvas limits + custom streaming `fflate` PNG writer + on-demand Wasm JPEG (`@jsquash/jpeg`) above iOS's 16.78 MP limit; (c) Bundle Wasm encoders for PNG, JPEG, WebP, and AVIF on all platforms in v1.
- **Choice:** Option (b): native `convertToBlob` within canvas limits (with `blob.type` verification so silent PNG fallbacks are caught; WebP offered only where probed native); custom `fflate` streaming PNG writer (zero EXIF/ICC chunks) and lazy-loaded Wasm JPEG above iOS's 16.78 MP cap; no `ImageDecoder` (WebCodecs stable Safari version unverified), no Safari WebP or AVIF in v1.
- **Reason:** Verified research established that iOS Safari invalidates any single canvas > 16,777,216 px and caps cumulative canvas memory at 384 MB (224 MB older devices), Safari lacks native WebP encoding, and no major browser natively encodes AVIF. Option (b) keeps the initial bundle small while supporting 24 MP mobile export (pending Spike S2) and reusing `fflate` for ZIP backups.
- **Spec author's note:** `engine.md` section 13 also allows using our `fflate` PNG writer below the canvas limit if S2 measures it faster than `convertToBlob`. Even if native PNG is slightly faster, using our PNG writer unconditionally for PNG export guarantees zero ancillary metadata chunks across every browser; S2 should confirm whether `convertToBlob` on Safari/Chrome strips all metadata before choosing native PNG. Choice left as specified in `engine.md`.
- **Revisit if:** Spike S2 shows `@jsquash/jpeg` exceeds memory or bundle budgets on iOS, or if Safari ships native WebP/AVIF encoding or raises the 16.78 MP canvas cap.

### D8. Arbitrary-angle sorting via integer line partition (no image rotation)

- **Options considered:** (a) Rotate image into an expanded canvas, sort rows, rotate back and crop (used by `satyarth`, `pixel-sorter`, `Pixel Sortium`); (b) Partition pixels directly into 8-connected tilted lines using a checked-in integer direction table (`engine.md` section 5.2).
- **Choice:** Integer line partition with a checked-in 3,600-entry `DIRECTION_TABLE`.
- **Reason:** Rotating and rotating back resamples every pixel twice with bilinear/Lanczos interpolation, softening untouched regions and varying across floating-point `Math.sin`/`Math.cos` implementations. Direct line partition moves pixels without interpolation, preserves exact multisets when `fill = sort`, and gives bit-identical geometry across every JS engine.
- **Spec author's note:** Direct line partition produces subtle stair-stepping on diagonal streaks compared with anti-aliased rotation, which is authentic to pixel art and preserves sharp pixel colours. Leaving the choice as specified in `engine.md` is the right fit for determinism and memory (no rotated scratch copy).
- **Revisit if:** Users explicitly ask for a smooth anti-aliased rotated-sort mode as an optional flag in `pixelSort` v2.

### D9. Three-level preview and cooperative cancellation

- **Options considered:** (a) Always render full resolution in a worker; (b) Two-level preview (`drag` + `full`); (c) Three-level preview (`drag` adaptive 0.125–1 MP, `settle` 2 MP phone / 4 MP tablet & desktop, tiled `full` on zoom > 1.25×) with cooperative 8 ms `MessageChannel` yields in the preview worker and termination in the export worker.
- **Choice:** Option (c) (`engine.md` section 8).
- **Reason:** Full-res 12–48 MP renders cannot hit 50–80 ms drag latency on phones, while `drag`-only proxies look soft when tuning fine thresholds. Tiled `2,048 × 2,048` `ImageBitmap`s keep zoomed-in `full` views well below iOS's 16.78 MP single-canvas limit.
- **Revisit if:** WebGPU acceleration makes full-resolution real-time rendering fast enough to skip `drag` downscaling on capable GPUs.

### D10. Schema-driven effect interface and static build-time registry

- **Options considered:** (a) Hand-written React panel per effect + optional runtime plug-ins; (b) Declarative `ParamSpec` schema per effect + static `src/engine/effects/index.ts` registry (`engine.md` sections 3 and 4).
- **Choice:** Declarative `ParamSpec` schema and static registry; no runtime plug-in loading.
- **Reason:** Makes adding a custom effect a self-contained engine-only change (zero UI or persistence boilerplate), guarantees consistent validation/clamping/reset/keyboard accessibility across all effects, and avoids untrusted code execution or CSP issues.
- **Revisit if:** A future effect needs a bespoke canvas interaction (such as painting masks or dragging curve points) that cannot be expressed as a parameter control; add an optional UI extension slot without breaking schema-driven effects.

### D11. Counter-based seeded randomness keyed to source coordinates

- **Options considered:** (a) Sequential PRNG (e.g. `mulberry32`) stepped per pixel/interval; (b) Counter-based `lowbias32` hash (`hash32`) keyed to `(seed, purposeCode, sourceCoords)`.
- **Choice:** Counter-based `hash32` keyed to source-space coordinates (`engine.md` section 10).
- **Reason:** Sequential PRNGs change output whenever render resolution, tile order, or parallelism changes. Counter-based hashing guarantees that `settle` previews match `full` exports structurally (resolution independence) and remains deterministic if work is later split across multiple workers or GPU threads.
- **Revisit if:** Never unless a cryptographic guarantee is needed (not applicable to glitch art).

### D12. Tooling stack and repository structure

- **Options considered:** (a) Monorepo with `apps/` + `packages/` and oxlint; (b) Single app at repo root with Vite+ (`vp`), pnpm 12, XO + Prettier, `tsgo -b`, Vitest, `vp hooks`, and ZeroVer (`0.<minor>.<patch>`).
- **Choice:** Single app at the repository root using Vite+, pnpm 12, XO + Prettier, `tsgo -b`, Vitest, `vp hooks`, and ZeroVer (`docs/agents/tooling.md`).
- **Reason:** Directly matches the owner's stack request and avoids monorepo overhead while there is only one deployable app. (Note: `vite.config.ts` `run.tasks` for `dev` and `gui` is untested in research and will be verified in `T0.1`.)
- **Revisit if:** Packaging with Tauri/Capacitor or adding a companion site later warrants splitting into a pnpm workspace.

---

## Open questions for the owner

Every spec currently builds on the **Current default** below. Please confirm or change each before scaffolding (`M0`) or release (`M6`).

### Q1. Theme reading ("light black theme")

- **Question:** You asked for a "light black theme". Should the app ship **two themes** (Light and True Black `#000000`, with a toggle and System default), or a **single** soft dark / charcoal theme (for example `#141416`)?
- **Current default:** Two themes: **Light** (`#fafafa`) and **True Black** (`#000000`), defaulting to **System**, with a toggle in the toolbar and Settings (F14, `DESIGN.md` section 2).

### Q2. Project licence

- **Question:** Which licence should PixelSortGUI use? No `LICENSE` file or header will be added until you decide (`docs/agents/licensing.md`).
- **Options and implications** (given that all first-release code is our own clean-room implementation, all npm dependencies are permissive MIT/ISC/BSD/Apache-2.0, and four surveyed pixel-sorting projects are MIT):

| Option | Allows copying from the 4 MIT surveyed repos (with notice)? | Allows porting GPL-3.0 repos (`pixel-sorter`, `rkargon`)? | Allows closed/commercial derivatives? | Key obligation |
|---|---|---|---|---|
| **MIT** | Yes (keep copyright + notice) | No | Yes | Minimal; anyone may reuse with attribution. |
| **Apache-2.0** | Yes (keep notice) | No | Yes | Adds explicit patent grant and NOTICE file handling. |
| **MPL-2.0** | Yes (keep notice) | No | Yes (file-level copyleft) | Changes to MPL files stay open; compatible with larger apps. |
| **GPL-3.0** | Yes (keep notice) | Yes | Copyleft (must share source under GPL-3.0) | Hosted JS bundle is distribution, so source must be offered to users. |
| **All rights reserved / Proprietary** | Yes (MIT permits closed use with notice in app UI) | No | Owner-only | No public reuse rights; notices still shown in About. |

- **Current default:** Unchosen (no `LICENSE` file; clean-room engine + permissive deps keep every option above open).

### Q3. Deployment target

- **Question:** Deploy the static `dist/` build to **GitHub Pages** or **Cloudflare Pages**? (`docs/agents/tooling.md` #1.)
- **Trade-off:** Both host static PWAs over HTTPS with zero server cost. Cloudflare Pages supports custom HTTP response headers (`_headers`), which would unlock COOP/COEP if Wasm threads are ever wanted later; GitHub Pages needs no extra account or Cloudflare secrets.
- **Current default:** GitHub Pages (with `dist/` kept portable to any base path and host).

### Q4. Upper image size on phones for the first release

- **Question:** Should the first release guarantee **24 MP** on phones (requiring tiled decode + our PNG writer + on-demand Wasm JPEG on iOS to stay under Safari's 16.78 MP single-canvas limit), or cap phones at **16 MP** (≤ 16,777,216 px) to use native canvas encoders everywhere?
- **Current default:** **24 MP** guaranteed on phones and tablets (with an `"Import at 24 MP"` / `"Import anyway"` dialog for 24–64 MP images), pending Spike S2. If Spike S2 fails on an iPhone, fall back to **≤ 16.78 MP** (`product.md` section 4 & AC-F12.5).

### Q5. Reference devices for performance budgets and release acceptance

- **Question:** Are the reference devices in `product.md` section 8 the right bar for signing off `v0.1.0`?
- **Current default:**
  - Desktop: 2020+ laptop (Apple M1 or Intel i5 11th gen class), current Chrome, Firefox, Safari.
  - Tablet: iPad 9th gen or newer, Safari 17+.
  - Phone (iOS): iPhone 12 or newer, Safari 17+ (tab and Home Screen).
  - Phone (Android): Pixel 6a/7a or Galaxy A54 class, current Chrome (tab and installed).

### Q6. Browser version floor

- **Question:** Is the tested browser floor right, or do you need older Safari/iOS (e.g. iOS 16.4+) or older Chrome/Firefox?
- **Current default:** Chrome/Edge 120+, Firefox 128+, Safari/iOS/iPadOS 17+ (Safari 17+ gives `navigator.storage.persist()`, 60% origin quota, and `OffscreenCanvas`; `product.md` section 4).

### Q7. Proof screenshots in pull requests

- **Question:** Should subagents upload proof screenshots into pull requests (TabLodge style, via `scripts/publish-evidence.ts`) or keep them in a git-ignored local folder and embed them in chat only (mediastash style)? (`docs/agents/tooling.md` #2.)
- **Current default:** Upload via `vp run evidence` and embed in the final chat report (matches global rule in `tooling-reference.md`; until `T0.4` lands, list local paths and write `screenshots not uploaded`).

### Q8. Code comment ban and ratchet

- **Question:** Should `xo.config.ts` include TabLodge's `local/no-comments` lint rule and comment ratchet, or rely on code review only? (`docs/agents/tooling.md` #3.)
- **Current default:** No automated comment ban/ratchet yet; prose rule forbids comments that restate code and requires reasons inside lint/type directives.

### Q9. Meaning of `vp run gui`

- **Question:** Should `vp run gui` build the production bundle and serve it locally (so the PWA service worker and offline mode can be tested), or simply open the dev server, or wait for a future desktop shell? (`product.md` section 4, `tooling-reference.md` section 5.)
- **Current default:** Build production `dist/` and serve it locally via `vp preview` (default `http://localhost:4173`).

### Q10. Optional pre-commit guards and skills management

- **Question:** Should scaffolding add (a) mediastash's pre-commit em-dash rejection check, (b) mediastash's Claude Code Stop hook requiring proof screenshots before stopping on UI edits, and (c) `skills-lock.json` restored via `vp run skills:install` versus vendoring skills? (`docs/agents/tooling.md` #5, `tooling-reference.md` section 9.)
- **Current default:** No em-dash hook and no Stop hook unless requested; lock file (`skills-lock.json`) with `vp run skills:install` rather than vendoring.

---

## Inconsistencies resolved

Eleven conflicts found across the first drafts were ruled on by the owner and applied before the first commit. The rulings are in the files named below.

1. **Span, interval, run:** the engine.md terms (line, run, interval) rule; "span" is removed. Changed: CONTEXT.md, AGENTS.md, engine.md section 12, roadmap.md, docs/agents/workflow.md, docs/agents/roster.md.
2. **Effect stack and pipeline:** the user's ordered list is the "effect stack"; "pipeline" is the render pipeline only. Changed: CONTEXT.md, docs/agents/adding-an-effect.md, AGENTS.md.
3. **Library:** projects only; presets are a separate global list. Changed: CONTEXT.md.
4. **Export:** full, 1/2, 1/4, or a custom longest side. Changed: CONTEXT.md.
5. **Project contents:** source image, effect stack, history, view state, export settings; masks are later work. Changed: CONTEXT.md.
6. **12 MP PNG export on the laptop:** acceptance limit is 5 s (AC-F12.1); engine.md's 2 s is an unbenchmarked engineering target, as are the laptop `drag` (50 ms) and visible-update (100 ms) budgets against AC-F8.1. Changed: engine.md section 9.
7. **Tablet size limit:** tablets share the 24 MP mobile limit with phones. Changed: engine.md section 8.2.
8. **Effect id casing:** `type` is camelCase in code and saved data; kebab-case is for file names only. Changed: docs/agents/adding-an-effect.md.
9. **Controls for a new effect:** generated from the parameter schema; no hand-written control code, check them at the three proof viewports. Changed: docs/agents/adding-an-effect.md.
10. **Test fixtures:** no photographs committed; fixtures are generated in code. AC-F6.1 now names a synthetic fixture. Changed: product.md.
11. **Mix and blend:** acceptance criteria AC-F4.7 to AC-F4.10 added under F4. Changed: product.md, roadmap.md (task T5.4 tests).

Also changed at the owner's request: the Opus-class tier is Gemini 4 Neon, thought level medium, on Antigravity; Claude Opus is removed because Antigravity's quota for Claude models ran out mid-task during planning. Changed: docs/agents/roster.md, roadmap.md.
