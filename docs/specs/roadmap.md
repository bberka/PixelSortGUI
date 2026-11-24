Written by Gemini 4 Neon (Antigravity, thought level high), spec subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.

# PixelSortGUI roadmap

Status: draft for owner review, 2026-11-24. Companion specs: [product.md](product.md), [engine.md](engine.md), [persistence.md](persistence.md), [../../DESIGN.md](../../DESIGN.md), [decisions.md](decisions.md). Workflow rules: [workflow.md](../agents/workflow.md), [roster.md](../agents/roster.md), [tooling.md](../agents/tooling.md).

## Conventions

- **One task, one worktree, one pull request.** Every task below is sized so one subagent can implement, test, and open a PR in a single session.
- **Model tiers** follow [roster.md](../agents/roster.md). Opus-class (`Gemini 4 Neon, thought level medium, on Antigravity`) is assigned only where `roster.md` justifies it (engine core, worker concurrency/memory, persistence/migrations, cross-cutting interfaces), and the reason is stated on the task.
- **Parallelism:** Tasks that share the same dependency prerequisite and touch disjoint areas are marked **Parallel with** so the lead agent can fan them out across separate worktrees.
- **Verification:** Every task runs `vp run check` and `vp run build` once M0 lands, plus the task-specific verification listed below. UI tasks require screenshots at `390 × 844`, `820 × 1180`, and `1440 × 900` in both Light and True Black themes.

---

## Milestone 0: Scaffolding, tooling, and CI

**Goal:** Turn the empty repository into a working Vite+, pnpm, TypeScript (`tsgo -b`), React 19, Tailwind 4, shadcn, XO, Vitest, Playwright, and GitHub Actions project per [tooling.md](../agents/tooling.md).

**Prerequisite:** Owner review of blocking open questions Q3, Q7, Q8, Q9, Q10 in [decisions.md](decisions.md#open-questions-for-the-owner) (or approval to proceed with defaults). Do not add a `LICENSE` file until Q2 is decided.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T0.1` | Core project scaffold: `package.json` (`prepare`, scripts), `pnpm-workspace.yaml` (Vite+ catalog & overrides), `vite.config.ts` (verify `run.tasks` for `dev` and `gui`, note untested in research), `tsconfig.json` + `tsconfig/{base,app,node,test}.json`, `xo.config.ts`, `components.json`, `index.html`, minimal `src/main.tsx`, `.gitignore`, `VERSION` (`0`), remove "planned" markers in `tooling.md` as files land. | `docs/agents/tooling.md` | none | none | Claude Sonnet (medium) | `pnpm install`, `vp run dev` starts, `vp run gui` builds & serves `dist/`, `vp run check` and `vp run build` pass. |
| `T0.2` | Git hooks and agent-context budget: `scripts/git-hooks/protected-branch.sh`, `.hooks/pre-commit`, `.hooks/pre-push`, verify `.hooks/commit-msg` works under `vp hooks` `.hooks/_` dispatcher, `scripts/agent-context.ts` + `scripts/agent-context-budget.json` + unit test. | `docs/agents/tooling.md` | `T0.1` | `T0.3`, `T0.4` | Claude Sonnet (medium) | `sh .hooks/test-commit-msg.sh`, `vp run check:agent-context`, `vp test run` passes, test commit on `main` blocked. |
| `T0.3` | CI and release workflows: `.github/workflows/test.yml` (jobs `lint`, `typecheck`, `unit`, `hooks`, `build`, gate `test`), `agent-context.yml`, `release.yml`, static deploy workflow (`pages.yml` or Cloudflare per Q3), `scripts/release-version.ts` + test, `.github/dependabot.yml`. | `docs/agents/tooling.md` | `T0.1` | `T0.2`, `T0.4` | Claude Sonnet (medium) | `vp run version:next`, `vp test run`, GitHub Actions green on PR. |
| `T0.4` | Playwright, axe-core, and proof tooling: `playwright.config.ts`, `@axe-core/playwright`, `scripts/proof-sheet.ts`, optional `scripts/publish-evidence.ts` (per Q7), `tests/e2e/smoke.spec.ts` verifying all 3 proof viewports render cleanly with zero console errors. | `docs/agents/tooling.md`, `DESIGN.md §10` | `T0.1` | `T0.2`, `T0.3` | Claude Sonnet (medium) | Playwright smoke test passes at `390×844`, `820×1180`, `1440×900`; `vp run check` passes. |

---

## Milestone 1: Technical spikes

**Goal:** Measure and de-risk the three largest unknowns identified in [engine-architecture.md](../research/engine-architecture.md) before full implementation. Each spike produces a short report (numbers, device, browser version) in a PR or `docs/research/` note and passes or triggers its documented fallback.

| ID | Spike | Spec sections | Depends on | Parallel with | Model tier | Pass / Fail criterion |
|---|---|---|---|---|---|---|
| `S1` | **Engine throughput & preview latency:** Prototype `pixelSort` (angle 0 and 30) with cooperative 8 ms `MessageChannel` time slicing in a Web Worker and a dev-only `/bench.html` harness. Measure p50/p95 on a 12 MP 4:3 JPEG on reference laptop and phone. | `engine.md §5, §8.4, §9, §14.4` | `T0.1` | `S2`, `S3` | Gemini 4 Neon, thought level medium, on Antigravity *(justified: engine performance & worker cancellation)* | **Pass:** `drag` p95 ≤ 50 ms laptop / ≤ 80 ms phone; visible update ≤ 100 ms / ≤ 150 ms; `settle` ≤ 300 ms / ≤ 400 ms; angle 30 ≤ 1.5× angle 0; no main-thread long task > 50 ms; throughput ≥ 25 MP/s laptop / ≥ 8 MP/s phone. **Fail:** Tune default caps, evaluate single-thread Wasm SIMD, or log owner-accepted gap. |
| `S2` | **Mobile memory, decode, and iOS > 16.78 MP export:** Test EXIF-rotated (orientation 6) and ICC-tagged 12/24/48 MP JPEGs on iOS Safari and Android Chrome. Verify tiled `createImageBitmap` decode, explicit `1×1` canvas release, `fflate` PNG writer vs `convertToBlob` speed, and `@jsquash/jpeg` licence/bundle size/speed for iOS > 16.78 MP JPEG export. | `product.md §4, F12`, `engine.md §13` | `T0.1` | `S1`, `S3` | Gemini 4 Neon, thought level medium, on Antigravity *(justified: worker memory & mobile codec limits)* | **Pass:** 12 MP decodes upright in sRGB and exports PNG & JPEG within budget without tab reload; 24 MP exports PNG & JPEG on iPhone without exceeding iOS's 384 MB canvas cap or reloading tab; `@jsquash/jpeg` licence confirmed permissive. **Fail:** Enforce ≤ 16.78 MP mobile export cap (Q4 fallback) and update `product.md`/`engine.md`. |
| `S3` | **Persistence, quota, private mode, and PWA recovery:** Test IndexedDB blob write/restore across reloads and installed PWA launches on iOS Safari (Home Screen + tab) and Android Chrome; verify `navigator.storage.persisted()`, simulated `QuotaExceededError` rollback, private browsing behavior, and offline reload. | `persistence.md §5, §7, §9`, `product.md F3, F15, F16` | `T0.1` | `S1`, `S2` | Claude Sonnet (medium) | **Pass:** Restart restores source/stack/history in normal & installed modes; quota error leaves previous committed state intact; iOS standalone detection accurately distinguishes Safari tab from Home Screen app; offline reload succeeds; private mode degrades cleanly. **Fail:** Adjust error/banner logic in `persistence.md`. |

---

## Milestone 2: Core engine, effects, codecs, and golden tests

**Goal:** Build the deterministic, DOM-free image engine (`src/engine/`), built-in presets (`src/presets/`), and worker-side codecs (`src/codec/`), backed by unit, property, and golden-image suites.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T2.1` | Engine foundation: `src/engine/{types,random,params,registry,composite,resample,pipeline}.ts` (`RgbaImage`, `EffectStack`, `canonicalStackJson`, `mix32`/`hash32`/`unit`/`intIn`, `validateParams`, migration runner, `createRegistry`, `mix`/`blend`, box downscaler, `renderStack`, `StageCache`). | `engine.md §1–§4, §8.5, §10` | `T0.1` | `T4.1` | Gemini 4 Neon, thought level medium, on Antigravity *(justified: cross-cutting effect interface & pipeline model)* | Unit tests for `random.ts` fixed vectors, `params.ts` validation/clamping, `pipeline.ts` skipping/warnings/mix/blend/debug stop, and `StageCache` LRU eviction. |
| `T2.2` | Direction table, line partition, and 8 sort keys: `scripts/gen-direction-table.ts`, checked-in `src/engine/direction-table.ts`, `src/engine/lines.ts` (including 0/90/180/270 fast paths), `src/engine/keys.ts` (all 8 exact integer `key16` formulas). | `engine.md §5.2, §5.3, §14.1, §14.3` | `T2.1` | `T2.4`, `T2.5`, `T2.6` | Gemini 4 Neon, thought level medium, on Antigravity *(justified: exact cross-engine arithmetic & line partition invariants)* | Unit tests against 12+ hand-computed colours per key, direction-table accuracy test (±1 vs cos/sin), `fast-check` 200-run line partition property tests. |
| `T2.3` | `pixelSort` effect: `src/engine/effects/pixel-sort/{index,select,edges,fill}.ts` implementing all 15 parameters, threshold/Sobel-edge/whole selection, runs/intervals/maxLength/jitter/skip, ascending/descending/shuffle/random, discretize, sort/average/gradient fill, and `'selection'` debug view. | `engine.md §5`, `product.md F6` | `T2.2`, `S1` | `T2.4`, `T2.6`, `T3.2` | Gemini 4 Neon, thought level medium, on Antigravity *(justified: sorting core & selection/interval semantics)* | `fast-check` 200-run property tests (multiset preservation, unselected invariance, monotonicity, θ vs θ+180 symmetry) + selection debug view test. |
| `T2.4` | Glitch effects & registry export: `src/engine/effects/{channel-shift,slice-shift,block-shuffle,channel-swap,index}.ts`. | `engine.md §4.2, §6`, `product.md F7` | `T2.1` | `T2.2`, `T2.5`, `T2.6` | Claude Sonnet (medium) | Unit + `fast-check` property tests (identity params, determinism, input immutability, resolution independence for `sliceShift` and `blockShuffle`). |
| `T2.5` | Built-in presets and synthetic test fixtures: `src/presets/builtin.ts` (all 8 presets with exact ids/seeds) and `tests/fixtures/synthetic.ts` (`gradient-64x48`, `noise-97x61`, `bands-80x80`, `alpha-32x32`). | `engine.md §7, §14.2`, `product.md F10` | `T2.1` | `T2.2`, `T2.4`, `T2.6` | Claude Sonnet (low) | Unit tests verify all 8 presets pass `validateParams` and fixtures generate deterministically. |
| `T2.6` | Codecs and streaming PNG writer: `src/codec/{png-writer,decode,encode}.ts` (`fflate` streaming PNG writer without metadata, EXIF-normalized tiled `createImageBitmap` decode, native `convertToBlob` with `blob.type` verification, WebP probe, on-demand Wasm JPEG per S2). | `engine.md §13, §14.1`, `product.md F1, F12` | `T2.1`, `S2` | `T2.2`, `T2.4`, `T2.5` | Claude Sonnet (medium) | `png-writer.ts` round-trip tests via `fast-png` (RGB & RGBA: `1×1`, `3×2`, `300×200`), zero-ancillary-chunk check, `renderSize` tests (`4001×3001` at 0.5 -> `2000×1500`). |
| `T2.7` | Golden images, effect contract suite, and benchmarks: `scripts/golden-update.ts`, `tests/golden/**` (all minimum cases in `engine.md §14.2`), `tests/engine/effect-contract.test.ts`, `scripts/bench.ts` (`vp run bench`), `/bench.html`. | `engine.md §4.6, §14.2–§14.4` | `T2.3`, `T2.4`, `T2.5`, `T2.6` | `T3.1`, `T3.2` | Claude Sonnet (medium) | `vp test run` passes all golden & contract tests; `vp run bench` prints MP/s cleanly; visual inspection of generated golden PNGs. |

---

## Milestone 3: Workers, render coordinator, and persistence

**Goal:** Move all image processing off the main thread with cooperative cancellation and progressive refinement, and implement durable IndexedDB storage, backup archives, and startup state restoration.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T3.1` | Preview & export workers and render coordinator: `src/worker/{protocol,preview.worker,export.worker}.ts`, `src/render/coordinator.ts` (generations, coalescing, 8 ms `MessageChannel` slicing, adaptive `drag` cap, `settle`, tiled `2,048×2,048` `full` render, worker termination cancel, 30 s timeout & crash restart). | `engine.md §8, §11`, `product.md F8, F12` | `T2.1`, `T2.6`, `S1` | `T3.2`, `T2.7` | Gemini 4 Neon, thought level medium, on Antigravity *(justified: worker concurrency, cancellation, crash & memory handling)* | Unit tests for generation ordering, stale drop, adaptive cap step-down/up, 2-crash error state, and cancellation. |
| `T3.2` | IndexedDB repository, memory fallback, migrations, and quota helpers: `src/storage/{types,db,repository,memory-adapter,quota}.ts` (all 6 stores, SHA-256 dedup, ref-counted delete, 201-entry history cap, `VersionError` handling, `QuotaExceededError` rollback, Safari tab detection). | `persistence.md §1–§7`, `product.md F1–F3, F9, F16` | `T2.1`, `S3` | `T3.1`, `T2.7` | Gemini 4 Neon, thought level medium, on Antigravity *(justified: persistence design & migrations)* | `fake-indexeddb` unit tests covering CRUD, dedup, ref-counted delete, 205-commit -> 200-undo boundary, unknown effect preservation, quota rollback, and memory fallback. |
| `T3.3` | Backup ZIP export and import: `src/storage/backup.ts` (`fflate` archive writer with `STORE` for sources, strict two-phase validator, SHA-256 verification, version rejection, unchanged-project deduplication). | `persistence.md §8`, `product.md F17` | `T3.2` | `T3.4`, `T4.1` | Claude Sonnet (medium) | Unit tests: full round-trip, double-import no-duplicate check, corrupt ZIP rejection, newer `backupVersion` rejection, modified-project conflict copy. |
| `T3.4` | Zustand app store and startup restore sequence: `src/state/`, `src/storage/restore.ts` (hash router `#/` & `#/p/<id>`, deleted-project notice, debounced 200 ms view-state saves + `pagehide` flush, lazy history migration, thumbnail generation hook). | `persistence.md §4, §9`, `product.md F3, F9, F10` | `T3.1`, `T3.2` | `T3.3` | Claude Sonnet (medium) | Unit tests for startup restore steps 1–7, hash routing, reload-on-library vs reload-on-project, undo/redo preserving view state. |

---

## Milestone 4: Design system, shell, library, import, and settings

**Goal:** Build the visual foundation (Light and True Black themes), application shell, image import workflow, Library screen, and Settings / Backup / About dialogs.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T4.1` | Design tokens, zero-FOUC theme boot, and shadcn UI primitives: `src/styles/app.css`, `index.html` inline theme script, `src/components/ui/*` (`button`, `card`, `dialog`, `alert-dialog`, `dropdown-menu`, `input`, `label`, `popover`, `progress`, `scroll-area`, `select`, `separator`, `sheet`, `slider`, `sonner`, `switch`, `tabs`, `toggle-group`, `tooltip`, `badge`), theme toggle component. | `DESIGN.md §1–§5`, `product.md F14` | `T0.1`, `T0.4` | M2, M3 | Claude Sonnet (medium) | Playwright check: Light, True Black (`#000000`), and System themes switch cleanly; zero dark-frame flash on light reload; axe passes. |
| `T4.2` | App shell, secure-context gate, startup integration, banners, and polite live region: `src/App.tsx`, route host, secure-context error screen, `Storage unavailable` banner, Safari 7-day banner, 30-day backup reminder, `role="status"` live region. | `persistence.md §7, §9`, `DESIGN.md §9, §10`, `product.md §4, F3, F16, F19` | `T3.4`, `T4.1` | none | Claude Sonnet (medium) | Unit + Playwright tests for secure-context error, banners, live region announcements, and deleted-project hash recovery; 3-viewport screenshots. |
| `T4.3` | Image import flow and validation dialogs: `src/features/import/` (multi-file picker, desktop drag-and-drop overlay, EXIF-normalized dimension probe, 16,384 px / 64 MP / 200 MB rejection messages, mobile 24–64 MP `"Import at 24 MP"` / `"Import anyway"` dialog, `"Storage is full"` dialog). | `product.md §4, F1, F16`, `DESIGN.md §9` | `T3.2`, `T4.2` | `T4.4`, `T4.5` | Claude Sonnet (medium) | Playwright tests for AC-F1.1–AC-F1.7 and AC-F16.2 (multi-select, drop, invalid file, oversized, EXIF orientation 6, dedup); 3-viewport screenshots. |
| `T4.4` | Library screen: `src/features/library/` (responsive 2/3/auto-fill card grid, empty state, `IntersectionObserver` lazy thumbnail decoding, card menu with Open/Rename/Duplicate/Export backup/Delete + confirmation dialog, full keyboard navigation). | `product.md F2`, `DESIGN.md §6.1, §9` | `T4.2`, `T4.3` | `T4.5` | Claude Sonnet (medium) | Playwright tests for AC-F2.1–AC-F2.7 (including 100-project lazy scroll and keyboard-only card actions); 3-viewport × 2-theme screenshots. |
| `T4.5` | Settings, storage status, backup UI, and About/Notices: `src/features/settings/` (Theme selector, `"Using <used> of <quota>"`, persistence status/request, Backup export/import dialogs with history toggle & error handling, ASDFPixelSort credit, Third-party notices viewer). | `product.md F14, F16, F17`, `persistence.md §7, §8`, `DESIGN.md §7` | `T3.3`, `T4.2` | `T4.4` | Claude Sonnet (medium) | Playwright tests for AC-F16.1, AC-F17.1–AC-F17.4, and About notices; 3-viewport × 2-theme screenshots. |

---

## Milestone 5: Editor workspace, controls, presets, and export

**Goal:** Build the interactive photo canvas, compare/split view, effect stack, schema-driven parameter panel, presets, export flow, and responsive phone/tablet/desktop editor layouts.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T5.1` | Interactive canvas stage, zoom/pan/pinch, and render overlays: `src/features/canvas/` (hi-DPI drawing, tiled `full` rendering, > 200% nearest-neighbour, pointer/touch/keyboard zoom & pan, 64 px pan clamp, zoom dropdown Fit/50/100/200/400%, > 300 ms progress bar, `"Rendering full resolution"` pill, 2-crash error card). | `product.md F8, F13`, `engine.md §8.6`, `DESIGN.md §7–§9` | `T3.4`, `T4.2` | `T5.3`, `T5.4`, `T5.6` | Claude Sonnet (medium) | Playwright tests for AC-F8.3–AC-F8.5, AC-F13.1–AC-F13.3 (zoom presets, pan clamp, keyboard pan/zoom, pixelated zoom); 3-viewport screenshots. |
| `T5.2` | Compare toggle/hold and split view: `src/features/canvas/compare.tsx` (Compare button & `\` 300 ms hold-vs-toggle, `"Original"` pill, `S` split view, pointer/touch/keyboard divider with 1%/10% steps, aligned under zoom & pan). | `product.md F11`, `DESIGN.md §7, §8.2` | `T5.1` | `T5.5`, `T5.6` | Claude Sonnet (low) | Playwright tests for AC-F11.1–AC-F11.4 (toggle, 1 s hold, split drag + Arrow/Shift+Arrow, persistence across reload); screenshots. |
| `T5.3` | Effect stack UI: `src/features/stack/` (Add effect picker with labels & descriptions, stack rows with enable/disable + `"Off"` icon & text, pointer/touch drag reorder + `Alt+Up/Down` + Move up/down menu, Duplicate, Remove, `"Unsupported effect"` row, 32-instance cap). | `product.md F4`, `DESIGN.md §5.3, §7` | `T3.4`, `T4.1` | `T5.1`, `T5.4`, `T5.6` | Claude Sonnet (medium) | Playwright tests for AC-F4.1–AC-F4.6 (add, toggle Off, drag & keyboard reorder, duplicate, remove + undo, unknown type); 3-viewport screenshots. |
| `T5.4` | Schema-driven parameter panel & custom controls: `src/features/params/` (all 7 `ParamSpec` kinds including `AngleDial` with 45° snaps and two-thumb `RangeSlider`, `visibleWhen`, per-param reset, `"Reset all"`, universal `mix` & `blend`, `pixelSort` `"Show selection"` switch, slider release commit & 500 ms keyboard burst commit). | `product.md F5, F6`, `engine.md §3, §4.5, §5.7`, `DESIGN.md §5.1, §5.2` | `T2.1`, `T3.4`, `T4.1` | `T5.1`, `T5.3`, `T5.6` | Claude Sonnet (medium) | Playwright tests for AC-F4.7–AC-F4.10, AC-F5.1–AC-F5.6 and AC-F6.6 (mix/blend, exact entry, clamping, single commit on 3 s drag, 500 ms key burst, `edges` visibility toggle, Show selection). |
| `T5.5` | Undo/redo toolbar & shortcuts and Presets UI: `src/features/presets/` (Undo/Redo buttons with commit-labeled `aria-label`/tooltips, `Ctrl/Cmd+Z` & `Ctrl/Cmd+Shift+Z`/`Ctrl+Y`, Presets tab listing 8 built-in + user presets, Apply, Add to stack, Save as preset, Rename/Delete user presets only). | `product.md F9, F10`, `DESIGN.md §5.3, §8.3` | `T5.3`, `T5.4` | `T5.2`, `T5.6` | Claude Sonnet (medium) | Playwright tests for AC-F9.1–AC-F9.5 and AC-F10.1–AC-F10.4 (ASDF classic -> 2 instances, save/apply across projects, built-ins read-only). |
| `T5.6` | Export dialog: `src/features/export/` (PNG/JPEG/probed WebP, quality 50–100 default 92, Full/1/2/1/4/Custom longest side with live output dimensions, default timestamped filename, worker progress + Cancel, Download + `navigator.canShare` Share, remembered per-project settings, OOM guidance). | `product.md F12`, `engine.md §11, §13`, `DESIGN.md §7, §9` | `T3.1`, `T3.4`, `T4.1` | `T5.1`, `T5.2`, `T5.3`, `T5.4`, `T5.5` | Claude Sonnet (medium) | Playwright tests for AC-F12.1–AC-F12.7 (PNG dimensions, 1/2 rounding, cancel within 1 s, EXIF-free output bytes, remembered settings). |
| `T5.7` | Responsive editor chrome assembly: wire phone bottom sheet (3 detents + landscape right drawer) + horizontal stack strip, tablet resizable/collapsible docked bottom panel, desktop 340 px right sidebar; verify orientation/resize state retention and zero horizontal scroll. | `product.md F18`, `DESIGN.md §6.2–§6.4` | `T5.1`–`T5.6` | none | Claude Sonnet (medium) | Playwright tests for AC-F18.1–AC-F18.4 (no horizontal scroll, 44×44 touch targets, 16 px touch inputs, orientation retention); screenshots at `390×844`, `820×1180`, `1440×900` in both themes. |

---

## Milestone 6: PWA offline, accessibility, E2E verification, and first release

**Goal:** Ship full offline PWA support, verify WCAG 2.2 AA and every acceptance criterion F1–F19, and complete real-device sign-off for `v0.1.0`.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T6.1` | PWA manifest, service worker, and install UI: configure `vite-plugin-pwa` (Workbox precache of app shell, workers, icons; `registerType: 'prompt'` so updates never auto-reload), `"Reload to update"` toast, `beforeinstallprompt` `"Install app"` menu item, zero third-party network check. | `product.md F15`, `DESIGN.md §7, §9` | `T4.2`, `S3` | `T6.2` | Claude Sonnet (medium) | Playwright offline test (AC-F15.1), zero external-origin network assertions (AC-F15.2), simulated SW update toast (AC-F15.3). |
| `T6.2` | Accessibility test suite and fixes: Playwright + `@axe-core/playwright` suite covering Library, Editor, Export, and Settings × 2 themes × 3 viewports, full keyboard-only core loop test, live-region assertion test, and `prefers-reduced-motion: reduce` test. | `product.md F19`, `DESIGN.md §10` | `T5.7` | `T6.1` | Claude Sonnet (medium) | AC-F14.3 and AC-F19.1–AC-F19.4 green in CI (`vp run check:a11y`). |
| `T6.3` | Full E2E acceptance test suite & independent review: automated Playwright coverage for F1–F19 (including session reload, cross-reload undo, deterministic double-export pixel equality, backup round-trip, and synthetic E2E fixture generated in code); independent diff review by GPT Luna. | `product.md §5` | `T6.1`, `T6.2` | none | Claude Sonnet (medium) + GPT Luna (review) | Full CI green; every `AC-F1.1` through `AC-F19.4` mapped to automated test or manual device checklist item. |
| `T6.4` | Real-device acceptance & `v0.1.0` release: execute release checklist on the device matrix (product.md section 8: laptop Chrome/Firefox/Safari, iPad Safari 17+, iPhone Safari tab & Home Screen, Android Chrome tab & installed), record p50/p95 timings, run manual `release.yml`. | `product.md §8`, `docs/agents/tooling.md` | `T6.3` | none | Owner + Lead agent | Signed checklist recorded; `v0.1.0` deployed and GitHub release published. |

---

## Feature-to-task coverage table (F1 to F19)

| Feature | Summary | Implementing tasks | Verification tasks |
|---|---|---|---|
| `F1` | Import images (picker, drop, limits, EXIF, SHA-256 dedup) | `T2.6`, `T3.2`, `T4.3` | `S2`, `T4.3`, `T6.3` |
| `F2` | Library (cards, result thumbnails, rename, duplicate, delete, lazy 100-item scroll) | `T3.2`, `T3.4`, `T4.4` | `T3.2`, `T4.4`, `T6.3` |
| `F3` | Session restore (library, open project, stack, history, zoom/pan, split, `#/p/<id>`) | `T3.2`, `T3.4`, `T4.2` | `S3`, `T3.4`, `T6.3` |
| `F4` | Effect stack (add, select, enable/off, reorder drag+keyboard, duplicate, remove, unknown types) | `T2.1`, `T5.3` | `T2.1`, `T5.3`, `T6.3` |
| `F5` | Parameter controls (schema-driven controls, clamping, commits, `visibleWhen`, resets) | `T2.1`, `T5.4` | `T2.1`, `T5.4`, `T6.3` |
| `F6` | Pixel sort effect (15 params, exact angles/keys, selection debug view, deterministic export) | `T2.2`, `T2.3`, `T5.4` | `S1`, `T2.2`, `T2.3`, `T2.7`, `T6.3` |
| `F7` | Glitch effects (`channelShift`, `sliceShift`, `blockShuffle`, `channelSwap`) | `T2.4` | `T2.4`, `T2.7`, `T6.3` |
| `F8` | Live preview & full-res view (`drag`, `settle`, tiled `full`, cancellation, progress bar) | `T2.1`, `T3.1`, `T5.1` | `S1`, `T3.1`, `T5.1`, `T6.3` |
| `F9` | Undo and redo (labeled commits, 200-step persisted history, shortcuts) | `T3.2`, `T3.4`, `T5.5` | `T3.2`, `T5.5`, `T6.3` |
| `F10` | Presets (8 built-in + user presets, Apply / Add / Save / Rename / Delete) | `T2.5`, `T3.2`, `T5.5` | `T2.5`, `T5.5`, `T6.3` |
| `F11` | Compare (toggle/hold `\` & button, split view `S` & draggable/keyboard divider) | `T3.4`, `T5.2` | `T5.2`, `T6.3` |
| `F12` | Export (PNG/JPEG/probed WebP, quality, sizes, progress/cancel, Share, EXIF-free, iOS 24 MP) | `T2.6`, `T3.1`, `T5.6` | `S2`, `T2.6`, `T5.6`, `T6.3`, `T6.4` |
| `F13` | Zoom and pan (fit, 100%, 10%–3200%, 60 fps pinch, keyboard, 64 px clamp, >200% crisp) | `T5.1` | `T5.1`, `T6.3`, `T6.4` |
| `F14` | Themes (Light, True Black `#000000`, System, zero-flash reload, contrast) | `T3.4`, `T4.1`, `T4.5` | `T4.1`, `T6.2`, `T6.3` |
| `F15` | Offline and install (PWA precache, offline editing/export, update toast, install prompt) | `T6.1` | `S3`, `T6.1`, `T6.3`, `T6.4` |
| `F16` | Storage status and warnings (usage/quota, full dialog, Safari 7-day banner, unavailable banner) | `T3.2`, `T4.2`, `T4.5` | `S3`, `T3.2`, `T4.2`, `T4.5`, `T6.4` |
| `F17` | Backup and restore (ZIP export/import, dedup, corruption/version errors, 30-day reminder) | `T3.3`, `T4.2`, `T4.5` | `T3.3`, `T4.5`, `T6.3`, `T6.4` |
| `F18` | Phone, tablet, and desktop layouts (390/820/1440, 44 px touch targets, 16 px inputs, rotate) | `T4.4`, `T5.7` | `T5.7`, `T6.2`, `T6.4` |
| `F19` | Accessibility baseline (WCAG 2.2 AA, keyboard loop, axe clean, live region, reduced motion) | `T4.1`, `T4.2`, `T5.1`–`T5.7`, `T6.2` | `T6.2`, `T6.3` |

---

## Later work (post-v0.1.0)

Each item below requires its own spec in `docs/specs/` (or `docs/specs/effects/`) before implementation starts. Ordered roughly by user value and architectural sequence:

1. **Masks (`EffectStack` `schemaVersion: 2`):** Per-instance 8-bit brush/luminance/imported masks following the semantics already reserved in [engine.md section 5.6](engine.md#56-masks-later-semantics-fixed-now). Adds a `masks` IndexedDB store and brush canvas tools.
2. **More effects & `pixelSort` v2:** `smear`, `waveShift`, `posterize`, `dither`, `grain`, source-stage `dataBend`, per-channel pixel sort, plus `pixelSort` v2 interval transforms (mirror, splice, fold/`middlate`, smooth grouping) and non-linear paths (concentric rectangles, circles, spirals, random walks, tiles).
3. **Editing comfort & extended formats:** History list panel, compare against any history entry, clipboard paste, source crop/rotate, batch export, AVIF export and Safari WebP export via lazy-loaded Wasm encoders (`@jsquash/avif`, `@jsquash/webp`), > 24 MP mobile support, 16-bit / Display P3 pipelines.
4. **WebGPU acceleration:** Plug into `src/engine/gpu/` per [engine.md section 12](engine.md#12-where-webgpu-plugs-in-later). First target: axis-aligned `pixelSort` for lines ≤ 4,096 px using per-line workgroups, parallel prefix/suffix scan selection and interval splitting, and bitonic sorting network in 16 KiB workgroup memory (clean-room or MIT-attributed port of `ruccho/BitonicPixelSorter` with notice in `THIRD-PARTY-NOTICES.md`). Must pass bit-exact golden tests before enabling for `settle`/`full`; startup smoke test and CPU fallback on device loss remain mandatory.
5. **Motion (GIF and video):** Introduce a frame-source and keyframe-interpolation layer above the pure `renderStack` pipeline (parameter animation over N frames, GIF/video frame-by-frame input, WebCodecs `VideoEncoder` + client-side muxer or Wasm GIF encoder). Zero changes to still-image effect kernels.
6. **Native packaging (desktop and mobile):** Wrap the existing static `dist/` build in **Tauri** (macOS, Windows, Linux) and **Capacitor** (iOS, Android) behind optional storage/file/codec adapters, reusing the pure TypeScript engine and UI unchanged.
