Written by Gemini 4 Neon (Antigravity, thought level high), spec subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.
Updated for spike results by Gemini 4 Neon (Antigravity, thought level low), documentation subagent.
Updated with post-v0.1.0 decisions (D21 to D26) and open questions (Q11 to Q15) by Gemini 4 Neon (Antigravity, thought level medium), specification subagent.
Updated with project files (F25), full backup/restore (F17), and multi-image blending (F26) decisions (D27 to D30) and open questions (Q16 to Q19) by Gemini 4 Neon (Antigravity, thought level low), specification subagent.

# Drift decisions and open questions

Status: settled for first release (one optional tooling question remains open), 2026-11-24. Companion specs: [product.md](product.md), [engine.md](engine.md), [persistence.md](persistence.md), [../../DESIGN.md](../../DESIGN.md), [roadmap.md](roadmap.md).

**Answer to native versus web:** Start web-first, not native-first. A static web app hosted on GitHub Pages (`drift.bbay.dev`) and backed by a TypeScript Web Worker sorting engine satisfies the offline, local-only goals on desktop browsers without depending on GPU availability, and keeping the image engine pure TypeScript lets the same codebase be packaged later with Tauri (see D13 for the system-webview caveat).

---

## Architecture and product decisions

### D1. Web-first versus native-first (settled 2026-11-24)

- **Options considered:** (a) Static web app / PWA first, native packaging later; (b) Native desktop/mobile app first (Rust/Swift/Kotlin or Tauri from day one).
- **Choice:** Web-first static PWA targeting desktop browsers in the first release (with responsive layouts at phone, tablet, and desktop widths), and a DOM-free TypeScript engine (`src/engine/`) that can later be packaged with Tauri (D13).
- **Reason:** Matches the owner's primary request (static-hostable, offline, local-only, zero store friction) and avoids maintaining platform-specific UI and distribution pipelines before the core editor is proven.
- **Revisit if:** Deep OS file or background workflows become mandatory, or when moving to native packaging with Tauri (D13).

### D2. Compute path (confirmed by spike S1, 2026-11-24)

- **Options considered:** (a) TypeScript typed-array kernels in a Web Worker; (b) Rust/Wasm SIMD + threads; (c) WebGPU compute shaders as primary engine; (d) WebGL2 fragment shader ping-pong passes.
- **Choice:** Our own TypeScript typed-array kernels in Web Workers as the baseline and reference implementation; optional WebGPU acceleration later (`src/engine/gpu/`). Confirmed for the first release by [spike S1](../research/spike-s1-engine-throughput.md) (2026-11-24); WebAssembly is not needed.
- **Spike S1 result (2026-11-24):** 12 MP angle 0 ran at 83.3 / 85.9 MP/s in Chromium and 78.9 / 79.5 MP/s in Firefox (angle 30: 44–56.5 MP/s against the 25 MP/s floor), with `drag` p95 15.6–28.0 ms, `settle` p95 60.0–97.0 ms, and zero main-thread long tasks > 50 ms. Limits: measured on one Linux desktop laptop, headless, on a synthetic image with a single `pixelSort` effect; says nothing about phones, tablets, or multi-effect stacks.
- **Reason:** Pixel sorting constructs variable-length runs along arbitrary angles and paths, which fit CPU typed-array code cleanly and give exact cross-browser determinism. WebGPU still requires a CPU fallback across browsers and GPUs. Avoiding Wasm threads avoids `SharedArrayBuffer` and cross-origin isolation (D6).
- **Revisit if:** Real-world multi-effect stacks or later mobile targets miss interactive latency budgets even with adaptive `drag` caps, in which case single-thread Wasm SIMD (no COOP/COEP required) or WebGPU is evaluated next.

### D3. UI framework, styling, and state library (settled 2026-11-24)

- **Options considered:** (a) React 19 + TypeScript + Tailwind 4 + shadcn/ui + Zustand; (b) Solid/Svelte/Preact with custom UI components; (c) React Context + `useReducer` without an external store.
- **Choice:** React 19, TypeScript, Tailwind 4, shadcn/ui (`new-york`, Radix primitives, `lucide-react`), and Zustand for app state, with imperative canvas drawing outside React state.
- **Reason:** Matches the owner's settled stack. In a photo editor, pixel processing dominates runtime cost; keeping transient drag state and canvas redraws out of React prevents framework overhead. Zustand gives fine-grained subscriptions for sliders, stack items, and progress without provider nesting.
- **Revisit if:** Profiling shows React reconciliation during slider drags causes main-thread tasks > 50 ms (mitigate by isolating transient values into refs/Zustand transient subscribers before reconsidering the framework).

### D4. Persistence and storage architecture (confirmed by spike S3, 2026-11-24)

- **Options considered:** (a) IndexedDB as primary catalog and blob store + `localStorage` theme mirror; (b) OPFS for blobs + IndexedDB for metadata; (c) File System Access API handles referencing files on disk.
- **Choice:** IndexedDB (`drift`) for all source blobs, projects, thumbnails, history, presets, and app state, with SHA-256 source deduplication, parameter-snapshot history (up to 200 undoable commits), and a single `localStorage` key (`drift:theme`) for zero-flash theme boot.
- **Spike S3 result (2026-11-24):** Confirmed in headless Chromium `159.0.8154.6` and Firefox `159.0` on one Linux desktop machine ([spike-s3-persistence.md](../research/spike-s3-persistence.md)): `Blob` round-trips up to 50 MiB, transaction rollback/mid-write kill safety, v1→v2 migration/`VersionError`, offline reload, and Chromium `QuotaExceededError` rollback all passed. Caveats: `navigator.storage.persist()` does not settle in Firefox until the user answers the prompt (never awaited on import/startup), `estimate().usageDetails` is absent in Firefox, real Firefox Private Browsing and native `persist()`/`QuotaExceededError` need manual checks, and nothing was tested on phones.
- **Reason:** IndexedDB works uniformly across Chromium and Firefox (and best-effort Safari) with atomic transactions and schema upgrades. File System Access pickers are Chromium-only and handles can be revoked. OPFS shares the exact same origin quota and eviction rules as IndexedDB, so adding a second persistence system for v1 adds recovery complexity without solving eviction.
- **Revisit if:** Future video/animation workflows or large painted mask layers require streaming random-access scratch files where worker-side OPFS `FileSystemSyncAccessHandle` measurably cuts peak RAM.

### D5. Clean-room own engine versus porting surveyed projects (updated 2026-11-24)

- **Options considered:** (a) Port `notlauren/pxlsort` or `Krzysztofz01/pixel-sorter`; (b) Port parts of MIT surveyed repos (`satyarth/pixelsort`, `czycha/pxlsrt`, `GarrettGunnell/Pixel-Sorting`, `ruccho/BitonicPixelSorter`); (c) Write a clean-room TypeScript engine from our own spec formulas.
- **Choice:** Clean-room own implementation for the first release (`engine.md`). With the project licensed under MIT (D15), code may be copied from the four MIT-licensed surveyed projects with attribution (`THIRD-PARTY-NOTICES.md`); the clean-room rule forbidding copying from unlicensed (`pxlsort`, `ASDFPixelSort`, `Pixel Sortium`, etc.), CC BY-NC-SA (`jeffThompson`), and GPL-3.0 (`pixel-sorter`, `rkargon/pixelsorter`) projects stays.
- **Reason:** Neither tool originally named can be copied safely (`pxlsort` has no licence; `pixel-sorter` is GPL-3.0). Writing from exact formulas in `engine.md` keeps the codebase clean under MIT and avoids inheriting known defects from the reference CLIs.
- **Revisit if:** Never for unlicensed, CC BY-NC-SA, or GPL-3.0 code. For the four MIT repos, reuse with attribution is permitted whenever it saves non-trivial work (such as `ruccho/BitonicPixelSorter`'s WebGPU bitonic scan shader later).

### D6. PWA offline support without cross-origin isolation (COOP/COEP)

- **Options considered:** (a) Standard static PWA with Workbox precaching and no COOP/COEP headers; (b) Require COOP/COEP (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`) for `SharedArrayBuffer` cancellation flags and Wasm threads, using Cloudflare headers or `coi-serviceworker` on GitHub Pages.
- **Choice:** Standard static PWA with **no** cross-origin isolation requirement. Preview worker cancellation uses cooperative 8 ms `MessageChannel` time slicing (`engine.md` section 8.4) and export cancellation uses `worker.terminate()`.
- **Reason:** GitHub Pages (D16) cannot natively serve custom HTTP response headers, and `coi-serviceworker` requires an extra reload on first visit and imposes strict CORP friction. Removing the COOP/COEP dependency keeps `dist/` portable to GitHub Pages, local `vp run gui`, and future Tauri shells.
- **Revisit if:** Multi-threaded Wasm proves necessary for video/high-MP exports and hosting changes to a provider that sets COOP/COEP natively.

### D7. Export encoders (updated 2026-11-24)

- **Options considered:** (a) Native `OffscreenCanvas.convertToBlob` for all formats and sizes; (b) Native `convertToBlob` within platform canvas limits + custom streaming `fflate` PNG writer + on-demand Wasm JPEG (`@jsquash/jpeg`) above iOS's 16.78 MP limit; (c) Bundle Wasm encoders for PNG, JPEG, WebP, and AVIF on all platforms in v1.
- **Choice:** Option (a) for the first release: native `OffscreenCanvas.convertToBlob` for PNG, JPEG, and WebP (offered only where a startup probe confirms `blob.type === 'image/webp'`), with `blob.type` verification on every encode. No `ImageDecoder` and no AVIF in v1.
- **History / deferred path:** Because the first release targets desktop Chromium and Firefox only (D17) and cuts the iOS > 16.78 MP path and spike S2 (D18), the tiled decode, custom streaming `fflate` PNG writer, and on-demand `@jsquash/jpeg` Wasm encoder from option (b) are deferred to Later (`engine.md` section 16.2).
- **Revisit if:** Mobile/Safari acceptance is scheduled or Tauri native packaging targets iOS/macOS (D13), where WebKit's 16.78 MP single-canvas limit applies and the deferred path in `engine.md` section 16.2 is needed.

### D8. Arbitrary-angle sorting via integer line partition (no image rotation)

- **Options considered:** (a) Rotate image into an expanded canvas, sort rows, rotate back and crop (used by `satyarth`, `pixel-sorter`, `Pixel Sortium`); (b) Partition pixels directly into 8-connected tilted lines using a checked-in integer direction table (`engine.md` section 5.2).
- **Choice:** Integer line partition with a checked-in 3,600-entry `DIRECTION_TABLE`.
- **Reason:** Rotating and rotating back resamples every pixel twice with bilinear/Lanczos interpolation, softening untouched regions and varying across floating-point `Math.sin`/`Math.cos` implementations. Direct line partition moves pixels without interpolation, preserves exact multisets when `fill = sort`, and gives bit-identical geometry across every JS engine.
- **Spec author's note:** Direct line partition produces subtle stair-stepping on diagonal streaks compared with anti-aliased rotation, which is authentic to pixel art and preserves sharp pixel colours. Leaving the choice as specified in `engine.md` is the right fit for determinism and memory (no rotated scratch copy).
- **Revisit if:** Users explicitly ask for a smooth anti-aliased rotated-sort mode as an optional flag in `pixelSort` v2.

### D9. Three-level preview and cooperative cancellation (updated 2026-11-24)

- **Options considered:** (a) Always render full resolution in a worker; (b) Two-level preview (`drag` + `full`); (c) Three-level preview (`drag` adaptive 0.125–1 MP, `settle` 4 MP on desktop, tiled `full` on zoom > 1.25× up to 50 MP) with cooperative 8 ms `MessageChannel` yields in the preview worker and termination in the export worker.
- **Choice:** Option (c) (`engine.md` section 8).
- **Reason:** Full-res 12–50 MP renders cannot hit 50 ms drag latency, while `drag`-only proxies look soft when tuning fine thresholds. Tiled `2,048 × 2,048` `ImageBitmap`s draw only visible tiles when zoomed in and remain compatible with future mobile/WebKit builds.
- **Revisit if:** WebGPU acceleration makes full-resolution real-time rendering fast enough to skip `drag` downscaling on capable GPUs.

### D10. Schema-driven effect interface, static registry, and reserved on-canvas tool slot (updated 2026-11-24)

- **Options considered:** (a) Hand-written React panel per effect + optional runtime plug-ins; (b) Declarative `ParamSpec` schema per effect + static `src/engine/effects/index.ts` registry, plus a reserved optional slot for on-canvas tools (`engine.md` sections 3, 4.6, 4.7; `DESIGN.md` section 7.1).
- **Choice:** Declarative `ParamSpec` schema and static registry; no runtime plug-in loading. Reserve an optional UI-side on-canvas tool slot (for example painting a mask or drawing a sort path) so interactive canvas tools can be added later without changing `EffectDefinition` or breaking schema-driven effects. The slot is designed now, not built in the first release, and has no pre-v0.1.0 roadmap task.
- **Reason:** Makes adding a custom effect a self-contained engine-only change (zero UI or persistence boilerplate), guarantees consistent validation/clamping/reset/keyboard accessibility across all effects, and avoids untrusted code execution or CSP issues, while keeping a clean seam for future mask/path tools.

### D11. Counter-based seeded randomness keyed to source coordinates

- **Options considered:** (a) Sequential PRNG (e.g. `mulberry32`) stepped per pixel/interval; (b) Counter-based `lowbias32` hash (`hash32`) keyed to `(seed, purposeCode, sourceCoords)`.
- **Choice:** Counter-based `hash32` keyed to source-space coordinates (`engine.md` section 10).
- **Reason:** Sequential PRNGs change output whenever render resolution, tile order, or parallelism changes. Counter-based hashing guarantees that `settle` previews match `full` exports structurally (resolution independence) and remains deterministic if work is later split across multiple workers or GPU threads.
- **Revisit if:** Never unless a cryptographic guarantee is needed (not applicable to glitch art).

### D12. Tooling stack and settled defaults (updated 2026-11-24; formerly Q7, Q8, Q9)

- **Choice:** Single app at the repository root using Vite+ (`vp`), pnpm 12, XO + Prettier, `tsgo -b`, Vitest, `vp hooks`, and ZeroVer (`0.<minor>.<patch>`). Settled defaults (`docs/agents/tooling.md`):
  - `vp run dev` runs the dev server; `vp run gui` builds production `dist/` and serves it locally at `http://localhost:4173`.
  - Proof screenshots are uploaded into the pull request (`scripts/publish-evidence.ts`).
  - Code comments follow the prose rule (no comment that restates the code; put reasons inside lint/type directives), with no lint ban or comment ratchet.
- **Reason:** Directly matches the owner's stack and tooling decisions and avoids monorepo overhead while there is only one deployable app. (Note: `vite.config.ts` `run.tasks` for `dev` and `gui` is untested in research and will be verified in `T0.1`.)
- **Revisit if:** Packaging with Tauri or adding a companion site later warrants splitting into a pnpm workspace.

### D13. Tauri for later native packaging (2026-11-24)

- **Choice:** Packaging with **Tauri** is the intended later route to native desktop and mobile apps from the same web build (`dist/`).
- **Caveat:** Tauri uses the platform's system webview — WebKit on iOS and macOS, WebKitGTK on Linux, WebView2 on Windows. On iOS (and macOS WebKit where applicable), the iOS 16.78 MP single-canvas limit and 384 MB cumulative canvas memory cap will still apply inside Tauri, so the deferred iOS decode/export path (`engine.md` section 16.2: tiled decode, streaming `fflate` PNG writer, on-demand Wasm JPEG encoder) will be needed when shipping Apple native builds.

### D14. Themes (formerly Q1, settled 2026-11-24)

- **Choice:** Two themes — **Light** (`#fafafa`) and **True Black** (`#000000`) — defaulting to **System** (`prefers-color-scheme`), with the selector in Settings (`F14`, `DESIGN.md` section 2).

### D15. Project licence (formerly Q2, settled 2026-11-24)

- **Choice:** **MIT**. A `LICENSE` file exists at the repository root and `package.json` declares `"license": "MIT"`. Code may be copied from the four MIT-licensed surveyed projects with attribution; the clean-room rule for unlicensed, GPL-3.0, and non-commercial projects stays (`docs/agents/licensing.md`).

### D16. Hosting and custom domain (formerly Q3, settled 2026-11-24)

- **Choice:** **GitHub Pages** on the custom domain **`drift.bbay.dev`** (renamed from the initial subdomain in D31). The production build (`dist/`) must work when served from the domain root (`/`), and the deploy writes a `CNAME` file containing `drift.bbay.dev` into the published output (`docs/agents/tooling.md`, roadmap `T0.5`).

### D17. First-release platforms, browser floor, and reference device (formerly Q5 and Q6, settled 2026-11-24)

- **Choice:** Desktop only for first-release acceptance. Accepted browsers are Chromium-based browsers (Chrome and Edge 120 or later) and Firefox 128 or later on a 2020 or newer laptop (Apple M1 or Intel i5 11th gen class).
- **Best effort & deferred platforms:** Safari on any platform is best effort (nothing may be built that knowingly breaks it, but it is not tested and not an acceptance target). Phones and tablets are not acceptance targets in the first release.
- **Responsive layouts:** Layouts stay responsive at phone, tablet, and desktop widths so a later port needs no layout rework, and UI changes are checked in a desktop browser at `390 × 844`, `820 × 1180`, and `1440 × 900`. That checks layout only and does not reproduce mobile canvas, memory, or storage limits.

### D18. First-release scope cuts and 50 MP image limit (formerly Q4, settled 2026-11-24)

- **Image size:** **50 MP** (`50,000,000` px) is the guaranteed maximum on the accepted desktop browsers. Larger images (within 16,384 px longest side and 200 MB file size) are offered a downscaled import to 50 MP, replacing the 24 MP mobile limit and its dialog.
- **Deferred to Later:** ZIP backup and restore (`F17`); three glitch effects (`sliceShift`, `blockShuffle`, `channelSwap`, plus the `vhs-split` and `tile-scramble` presets — `channelShift` stays alongside `pixelSort`); the iOS canvas-limit path (tiled decode, custom streaming PNG writer, WebAssembly JPEG encoder, 24 MP mobile dialog, spike `S2`); Safari 7-day storage eviction warnings and Home Screen exemption; phone and tablet acceptance criteria and reference devices.
- **Kept in first release:** Offline PWA support and installability (`F15`), storage-full handling, and private-browsing handling (`F16`).

### D19. Merging policy (settled 2026-11-24)

- **Choice:** For now, the **lead agent merges**, using squash merge, one pull request per task. A pull request merges when CI is green and a review agent running a different model from the author has approved it (before CI exists during scaffolding, review approval alone is the gate). `main` is protected so nothing is pushed to it directly. The owner reviews at each milestone and can revert.

### D20. Model roster (settled 2026-11-24)

- **Choice:** Due to limited remaining Claude usage, Claude Sonnet and Claude Haiku are not used for now. The active roster (`docs/agents/roster.md`) is:
  - **Light tasks** (small edits, single-file changes, mechanical work, reviews of small diffs): **GPT Luna**.
  - **Standard and larger tasks:** **Gemini 4 Neon on Antigravity** (thought level low or medium).
  - **Big tasks** (cross-cutting design, the hardest engine work, anything a Gemini 4 Neon attempt failed at): **Claude Fable** (low or medium effort), used sparingly.
  - **Research and bulk reading:** **deepseek-flash**.
- The rule that a reviewer runs a different model from the author stays.

### D21. Non-destructive project-level geometry transforms (2026-11-25)

- **Options considered:** (a) Destructively rewrite the stored source `Blob` on crop/rotate/resize; (b) Add crop/rotate/resize as effect instances inside `EffectStack`; (c) Store a non-destructive `SourceTransform` record on `ProjectRecord` (and `HistoryEntryRecord`) applied before `renderStack`, bumping IndexedDB to `dbVersion = 2`.
- **Choice:** Option (c): non-destructive `SourceTransform` applied before the effect stack (`engine.md` §16.3, `persistence.md` §8.1).
- **Reason:** Keeps `sources` immutable for SHA-256 deduplication, keeps undo/history snapshots tiny JSON instead of multi-megabyte blobs, avoids generational loss when re-cropping, keeps `EffectDefinition` same-size-out-as-in (`engine.md` §1 rule 4), and ensures applying a preset never overwrites the user's crop or rotation.
- **Revisit if:** A user explicitly asks for an in-stack distortion/crop effect that operates between two glitch passes.

### D22. Resize resampling filters and pixel-parameter stability (2026-11-25)

- **Options considered:** (a) Browser `OffscreenCanvas` scaling only; (b) Deterministic CPU resamplers (`lanczos3` via checked-in LUT, `bilinear`/`boxDownscale`, `nearest`), keeping effect pixel parameters (`unit: 'px'`) unchanged in effective-image pixels and enforcing the 50 MP / 16,384 px ceiling.
- **Choice:** Option (b) (`engine.md` §16.3).
- **Reason:** Browser canvas scaling differs across engines and breaks golden determinism; a checked-in Lanczos-3 LUT avoids `Math.sin` at render time while delivering sharp photo scaling, and `nearest` serves pixel-art/glitch upscaling. Leaving stored `unit: 'px'` effect parameters untouched avoids silently mutating user values during crop or resize.
- **Revisit if:** Full-res 50 MP Lanczos-3 resize proves too slow on the reference laptop, in which case an integer bicubic or Wasm SIMD kernel can replace it with a version bump.

### D23. Extended format additions and refusals (2026-11-25)

- **Options considered:** (a) Native browser codecs only; (b) Add MIT/Apache-2.0 bundled codecs for high-value formats (`utif2` for TIFF, pure-TS BMP writer, main-thread SVG rasteriser, lazy `@jsquash/avif` Wasm for AVIF export) and refuse licence-incompatible or non-goal formats (HEIC/HEIF, camera RAW).
- **Choice:** Option (b) (`product.md` F21, `engine.md` §16.4).
- **Reason:** Chrome/Edge 120+ and Firefox 128+ already decode AVIF, BMP, and GIF first frame natively. `utif2` (MIT, ~25 to 30 KB gzipped) unlocks TIFF cleanly, a ~1 KB pure-TS BMP writer supports external databending workflows, and lazy-loaded `@jsquash/avif` (Apache-2.0, ~3.3 MB Wasm) enables offline AVIF export without slowing initial load. HEIC/HEIF decoders wrap LGPL `libheif` with HEVC patents, and RAW decoders (`dcraw` GPL, `LibRaw` LGPL/CDDL) conflict with `docs/agents/licensing.md` and `product.md` §8 (no RAW development).
- **Revisit if:** Chrome and Firefox ship native `OffscreenCanvas.convertToBlob({type: 'image/avif'})` (allowing `@jsquash/avif` to be removed) or an unencumbered MIT HEIC decoder becomes available.

### D24. Expanded glitch effect catalogue and v0.2.0 top-5 selection (2026-11-25)

- **Options considered:** (a) Implement all 11 effects at once; (b) Specify an 11-effect catalogue (the 3 deferred effects plus 8 new still-photo glitch effects) and ship the top 5 by value-to-effort in `v0.2.0` (`sliceShift`, `channelSwap`, `blockShuffle`, `scanlineWave`, `posterize`), keeping every effect pure `RgbaImage -> RgbaImage`.
- **Choice:** Option (b) (`product.md` F22, `engine.md` §16.1).
- **Reason:** One effect per PR (`docs/agents/adding-an-effect.md`) keeps diffs small and reviewable. The top 5 deliver the widest visual variety (band tearing, channel permutation, tile scramble, CRT wave distortion, bit-crush/posterisation) with low implementation effort and zero UI boilerplate. Simulating JPEG/data-bend artifacts in pixel space (`jpegCrush`) avoids cross-browser JPEG decoder divergence.
- **Revisit if:** The owner prefers a different top-5 mix (Q15).

### D25. Project change history panel backed by existing persisted history (2026-11-25)

- **Options considered:** (a) Keep a separate in-memory-only history list; (b) Expose the existing 201-entry persisted IndexedDB `history` store in a visible newest-first History tab with click-to-jump (`jumpToHistory`) and muted redo entries.
- **Choice:** Option (b) (`product.md` F23, `persistence.md` §8.2, `DESIGN.md` §7.2).
- **Reason:** The `history` store already persists up to 201 snapshots across reloads (`src/storage/repository.ts`), so reusing it gives reload-safe jump-to-state with under ~1 MB of JSON per project and no DB version bump.
- **Revisit if:** Per-entry thumbnail previews are requested later, which would need a bounded LRU thumbnail cache.

### D26. Interpretation of "cut" and "change history" (2026-11-25)

- **Choice:** "Cut" in the owner's request is specified as **crop** (`F20`). "Change history" is specified primarily as a **per-project edit history panel** (`F23`), with a brief companion spec for an offline **app version changelog** in Settings -> About (`F24`).
- **Reason:** Both interpretations match the owner's phrasing and fit naturally into the editor; alternative readings (region cutout; changelog-only) are listed in Q11 and Q12 for owner confirmation.

### D27. Neutral `.glproj` ZIP container for single-project files (2026-11-26)

- **Options considered:** (a) App-named extension (`.psg`) or custom binary format; (b) JSON-only file with base64-encoded image bytes; (c) Neutral `.glproj` standard ZIP archive (`fflate`, MIT) storing `manifest.json`, `project.json`, optional `history.json`, optional thumbnail, and untouched `sources/<sha256>.<ext>` at STORE level 0.
- **Choice:** Option (c) (`product.md` F25, `persistence.md` §8.3).
- **Reason:** An app-neutral extension and `kind: 'project'` manifest survive any future rename. Standard ZIP with STORE level 0 avoids recompressing JPEGs/PNGs/WebPs and streams inside `archive.worker.ts` without base64 bloat or decoding 50 MP pixels on the main thread. Single-project import always generates a fresh UUID and suffixes name clashes (`"<name> (imported)"`) so existing local projects are never overwritten.
- **Revisit if:** Streaming random-access archives (such as multi-gigabyte video projects) outgrow ZIP.

### D28. Unified `fflate` backup format, 4-phase atomic restore, and dropping the 30-day reminder (2026-11-26)

- **Options considered:** (a) Separate backup schema plus a 30-day Library backup reminder banner (`lastBackupAt`); (b) Reuse `.glproj`'s `ProjectFilePayload` and `archive.worker.ts` inside `glitch-backup-<timestamp>.zip` with a single deduplicated `sources/` directory, selective export/import, Merge/Replace modes, 4-phase quota-safe writes, and no 30-day reminder banner.
- **Choice:** Option (b) (`product.md` F17, `persistence.md` §8.4).
- **Reason:** Sharing the project payload and streaming worker gives one parser, one validator, and one migration pipeline while deduplicating shared sources across projects. Staging new source blobs before one atomic metadata transaction guarantees that a mid-import `QuotaExceededError` or cancel never leaves dangling references or half-deleted local data. Dropping the 30-day reminder avoids time-based nagging (`DESIGN.md` §1) on desktop browsers where `navigator.storage.persist()` is already requested.
- **Revisit if:** Mobile/Safari acceptance adds platforms with aggressive eviction (covered separately by the deferred Safari 7-day warning in `persistence.md` §8.4.5).

### D29. Multi-image blending as an `imageBlend` effect instead of a full layer model (2026-11-26)

- **Options considered:** (a) Full multi-layer document tree with per-layer effect stacks (`EffectStack` `schemaVersion: 2`); (b) An `imageBlend` effect inside the existing effect stack with a new `'image'` `ParamSpec` kind, 10 exact integer blend modes, W3C straight-alpha compositing, 5 fit modes, and `DIRECTION_TABLE` rotation.
- **Choice:** Option (b) (`product.md` F26, `engine.md` §16.5).
- **Reason:** Preserves the same-size-in, same-size-out `EffectDefinition` contract (`engine.md` §1 rule 4), lets users apply effects before and after a blend or stack 3+ images, reuses the existing stack UI, stage cache, undo history, and responsive layouts (including 390 px phone width), and stays consistent with `product.md` §8 (no general photo editor layer tree).
- **Revisit if:** Users specifically need independent per-layer effect stacks or non-linear node graphs.

### D30. Reference-counted extra sources in IndexedDB v3 and 8-image cap (2026-11-26)

- **Options considered:** (a) Store blend images in a separate `blendSources` store or inline inside `EffectStack`; (b) Reuse the existing `sources` store with SHA-256 deduplication, add `referencedSourceHashes` + `byReferencedSourceHash` (`multiEntry: true`) in IndexedDB v3 (`dbMigrations[2]`), cap each project at 8 distinct extra images, and strip `'image'` params when saving user presets.
- **Choice:** Option (b) (`persistence.md` §8.5, `engine.md` §16.5).
- **Reason:** Reusing `sources` lets users pick existing library images without duplicating bytes, keeps undo history lightweight while retaining blobs referenced only by undo entries, bounds preview worker proxy RAM to `<= 160 MiB` (8 extra sources at 4 MP settle + 1 MP drag), and prevents user presets from pinning blobs or carrying broken hashes across devices.
- **Revisit if:** Multi-image collages routinely need more than 8 distinct secondary sources and worker proxy LRU eviction is added.

### D31. Product rename to Drift and domain change to drift.bbay.dev (2026-11-26)

- **Choice:** Rename the product to **Drift**, move the custom domain to **`drift.bbay.dev`**, and rename package and unreleased browser storage identifiers (`drift` package name and IndexedDB database; `drift:theme`, `drift:tablet-panel-height`, and `drift:tablet-panel-collapsed` `localStorage` keys).
- **Reason:** The app covers many glitch and image effects rather than pixel sorting alone, so a broader product name fits better and `drift.bbay.dev` matches it. Because the app is unreleased, browser storage identifiers are renamed cleanly without a legacy migration. Pixel sorting remains the name of the technique.
- **Revisit if:** Never; once `v0.1.0` ships, storage identifiers are frozen and migrated rather than renamed.

---

## Open questions for the owner

Questions Q1 through Q9 are settled above (2026-11-24). Question Q10 remains open from scaffolding, and Q11 through Q19 arise from the post-v0.1.0 specifications:

### Q10. Optional pre-commit guards and skills management

- **Question:** Should scaffolding add (a) mediastash's pre-commit em-dash rejection check, (b) mediastash's Claude Code Stop hook requiring proof screenshots before stopping on UI edits, and (c) `skills-lock.json` restored via `vp run skills:install` versus vendoring skills? (`docs/agents/tooling.md`.)
- **Current default:** No em-dash hook and no Stop hook unless requested; lock file (`skills-lock.json`) with `vp run skills:install` rather than vendoring.

### Q11. Meaning of "cut"

- **Question:** Did "cut" mean **crop** (trim the image to a rectangle, specified in `F20`), or **cut out a selected region** (remove a rectangle or freehand area to transparency / fill colour)?
- **Recommended default:** Treat "cut" as crop in `F20`, and defer region cutout to the later Masks / on-canvas tools milestone.

### Q12. Meaning of "change history"

- **Question:** Did "change history" mean the **per-project edit history panel** (`F23`, click any past commit to jump), an **app version changelog** (`F24`, release notes in Settings -> About), or both?
- **Recommended default:** Build both, with `F23` prioritized first in `v0.2.0` and `F24` added as a small follow-up (`T7.3`).

### Q13. Release timing for F20 to F24

- **Question:** Should `v0.1.0` ship as currently scoped, or should any of `F20` to `F24` be pulled into `v0.1.0`? (Pulling all of them adds ~17 tasks; `F23` alone adds 2 tasks; see `roadmap.md` Milestone 7.)
- **Recommended default:** Ship `v0.1.0` first, then deliver `F23`, `F24`, `F22` (top 5), `F21`, and `F20` in `v0.2.0`.

### Q14. AVIF export WebAssembly bundle

- **Question:** Because Chrome and Firefox do not natively encode AVIF via `convertToBlob`, should `v0.2.0` bundle the lazy-loaded `@jsquash/avif` Wasm encoder (~3.3 MB uncompressed, Apache-2.0, loaded only when AVIF export is selected), or skip AVIF export and keep only native PNG/JPEG/WebP plus BMP and TIFF?
- **Recommended default:** Include lazy-loaded `@jsquash/avif` Wasm so AVIF export works offline without affecting initial load time.

### Q15. Top-5 glitch effects for v0.2.0

- **Question:** Does the ranked top-5 set (`sliceShift`, `channelSwap`, `blockShuffle`, `scanlineWave`, `posterize`) match what you want first, or would you swap in another from the 11-effect catalogue (such as `pixelSmear`, `bayerDither`, `rgbNoise`, `mirrorFold`, `thresholdInvert`, or `jpegCrush`)?
- **Recommended default:** Build the ranked top 5 first (`T7.4` to `T7.8`), then schedule the remaining 6 in a follow-up wave.

### Q16. Release timing for F25, F17, and F26

- **Question:** Should `F25` (project files), `F17` (full backup and restore), and `F26` (multi-image blending) ship in Milestone 8 (`v0.3.0`) after `v0.1.0` and `v0.2.0`, or should any of them be pulled into `v0.1.0` or `v0.2.0`? (Pulling `F25` adds +3 tasks, `F17` adds +3 more, `F26` adds +4; all three add +10 implementation tasks; see `roadmap.md` Milestone 8.)
- **Recommended default:** Ship `v0.1.0` and `v0.2.0` first, then run Milestone 8 (`v0.3.0`) so `SourceTransform` (`F20`) and DB v2 are already in place.

### Q17. Single-project file extension

- **Question:** Is `.glproj` the preferred app-neutral extension for single-project files (`F25`), or would you prefer another neutral extension (such as `.glitchproj` or `.pxproj`)?
- **Recommended default:** Keep `.glproj` (short, app-neutral, standard ZIP container).

### Q18. Dropping the 30-day backup reminder banner

- **Question:** Is it okay to drop the earlier 30-day Library backup reminder banner from `F17`, keeping manual `"Export backup"` and `"Import backup"` in Settings -> Storage and the Library overflow menu?
- **Recommended default:** Drop the 30-day reminder banner (`D28`).

### Q19. `imageBlend` effect versus full layers and 8-image cap

- **Question:** Does implementing multi-image blending as a stackable `imageBlend` effect (with up to 8 distinct extra images per project, `D29`/`D30`) match how you want to blend images, or do you want a separate layer tree?
- **Recommended default:** Keep the stackable `imageBlend` effect with the 8-extra-image cap.

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
