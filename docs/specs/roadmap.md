Written by Gemini 4 Neon (Antigravity, thought level high), spec subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.

# PixelSortGUI roadmap

Status: settled for first release, 2026-11-24. Companion specs: [product.md](product.md), [engine.md](engine.md), [persistence.md](persistence.md), [../../DESIGN.md](../../DESIGN.md), [decisions.md](decisions.md). Workflow rules: [workflow.md](../agents/workflow.md), [roster.md](../agents/roster.md), [tooling.md](../agents/tooling.md).

## Conventions

- **One task, one worktree, one pull request.** Every task below is sized so one subagent can implement, test, and open a PR in a single session.
- **Model tiers** follow [roster.md](../agents/roster.md): **GPT Luna** for light tasks and small-diff reviews; **Gemini 4 Neon (Antigravity, low or medium)** for standard and larger tasks; **Claude Fable (low or medium)** used sparingly only where `roster.md` justifies it (cross-cutting design, hardest engine work, or escalation after a Neon attempt fails), with the reason stated on the task; **deepseek-flash** for research and bulk reading. Every PR is reviewed by a different model from its author.
- **Parallelism:** Tasks that share the same dependency prerequisite and touch disjoint areas are marked **Parallel with** so the lead agent can fan them out across separate worktrees.
- **Verification:** Every task runs `vp run check` and `vp run build` once M0 lands, plus the task-specific verification listed below. UI tasks require screenshots in a desktop browser at `390 × 844`, `820 × 1180`, and `1440 × 900` (layout check only) in both Light and True Black themes, uploaded to the pull request.

---

## Milestone 0: Scaffolding, tooling, and CI

**Goal:** Turn the empty repository into a working Vite+, pnpm, TypeScript (`tsgo -b`), React 19, Tailwind 4, shadcn, Zustand, XO, Vitest, Playwright, and GitHub Actions project per [tooling.md](../agents/tooling.md), with GitHub Pages deployment to `glitch.bbay.dev`.

**Prerequisite:** Owner confirmation of optional guards (Q10 in [decisions.md](decisions.md#open-questions-for-the-owner)), or proceed with its documented default.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T0.1` | Core project scaffold: `package.json` (`license: "MIT"`, `prepare`, scripts), `pnpm-workspace.yaml` (Vite+ catalog & overrides), `vite.config.ts` (verify `run.tasks` for `dev` and `gui` at `http://localhost:4173`, note untested in research), `tsconfig.json` + `tsconfig/{base,app,node,test}.json`, `xo.config.ts`, `components.json`, `index.html`, minimal `src/main.tsx`, `.gitignore`, `VERSION` (`0`), remove "planned" markers in `tooling.md` as files land. | `docs/agents/tooling.md` | none | none | Gemini 4 Neon (Antigravity, medium) | `pnpm install`, `vp run dev` starts, `vp run gui` builds & serves `dist/` at `http://localhost:4173`, `vp run check` and `vp run build` pass. |
| `T0.2` | Git hooks and agent-context budget: `scripts/git-hooks/protected-branch.sh`, `.hooks/pre-commit`, `.hooks/pre-push`, verify `.hooks/commit-msg` works under `vp hooks` `.hooks/_` dispatcher, `scripts/agent-context.ts` + `scripts/agent-context-budget.json` + unit test. | `docs/agents/tooling.md` | `T0.1` | `T0.3`, `T0.4`, `T0.5` | Gemini 4 Neon (Antigravity, low) | `sh .hooks/test-commit-msg.sh`, `vp run check:agent-context`, `vp test run` passes, test commit on `main` blocked. |
| `T0.3` | CI and release workflows: `.github/workflows/test.yml` (jobs `lint`, `typecheck`, `unit`, `hooks`, `build`, gate `test`), `agent-context.yml`, `release.yml`, `scripts/release-version.ts` + test, `.github/dependabot.yml`. | `docs/agents/tooling.md` | `T0.1` | `T0.2`, `T0.4`, `T0.5` | Gemini 4 Neon (Antigravity, low) | `vp run version:next`, `vp test run`, GitHub Actions green on PR. |
| `T0.4` | Playwright, axe-core, and proof tooling: `playwright.config.ts`, `@axe-core/playwright`, `scripts/proof-sheet.ts`, `scripts/publish-evidence.ts` (`vp run evidence`), `tests/e2e/smoke.spec.ts` verifying all 3 proof viewports render cleanly with zero console errors. | `docs/agents/tooling.md`, `DESIGN.md §10` | `T0.1` | `T0.2`, `T0.3`, `T0.5` | Gemini 4 Neon (Antigravity, medium) | Playwright smoke test passes at `390×844`, `820×1180`, `1440×900`; `vp run check` passes. |
| `T0.5` | GitHub Pages deploy workflow: `.github/workflows/pages.yml` deploying `dist/` to GitHub Pages on custom domain `glitch.bbay.dev`, writing `CNAME` (`glitch.bbay.dev`) into the published output and verifying root-path (`base: '/'`) asset loading. | `docs/agents/tooling.md`, `product.md §4` | `T0.1` | `T0.2`, `T0.3`, `T0.4` | GPT Luna | Workflow validates cleanly, `dist/CNAME` contains `glitch.bbay.dev`, production build serves from `/` without broken paths. |

---

## Milestone 1: Technical spikes

**Goal:** Measure and de-risk the two remaining unknowns identified in [engine-architecture.md](../research/engine-architecture.md) on desktop browsers before full implementation. Each spike produces a short report (numbers, device, browser version) in a PR or `docs/research/` note and passes or triggers its documented fallback.

| ID | Spike | Spec sections | Depends on | Parallel with | Model tier | Pass / Fail criterion |
|---|---|---|---|---|---|---|
| `S1` | **Engine throughput & preview latency:** Prototype `pixelSort` (angle 0 and 30) with cooperative 8 ms `MessageChannel` time slicing in a Web Worker and a dev-only `/bench.html` harness. Measure p50/p95 on a 12 MP 4:3 JPEG on a reference laptop (Chromium and Firefox). | `engine.md §5, §8.4, §9, §14.4` | `T0.1` | `S3` | Gemini 4 Neon (Antigravity, medium) | **Pass:** `drag` p95 ≤ 50 ms; visible update ≤ 100 ms; `settle` ≤ 300 ms; angle 30 ≤ 1.5× angle 0; no main-thread long task > 50 ms; throughput ≥ 25 MP/s. **Fail:** Tune default caps, evaluate WebAssembly, or log owner-accepted gap. |
| `S2` | *Deferred to Later (iOS > 16.78 MP canvas-limit decode/export path moved to post-v0.1.0; ID retained so numbering does not shift).* | — | — | — | — | — |
| `S3` | **Persistence, quota, private mode, and PWA recovery:** Test IndexedDB blob write/restore across reloads and installed desktop PWA launches on Chromium and Firefox; verify `navigator.storage.persisted()`, simulated `QuotaExceededError` rollback, private browsing behavior, and offline reload. | `persistence.md §5, §7, §9`, `product.md F3, F15, F16` | `T0.1` | `S1` | Gemini 4 Neon (Antigravity, low) | **Pass:** Restart restores source/stack/history in normal & installed modes; quota error leaves previous committed state intact; offline reload succeeds; private mode degrades cleanly. **Fail:** Adjust error/banner logic in `persistence.md`. |

---

## Milestone 2: Core engine, effects, codecs, and golden tests

**Goal:** Build the deterministic, DOM-free image engine (`src/engine/`), built-in presets (`src/presets/`), and worker-side native codecs (`src/codec/`), backed by unit, property, and golden-image suites.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T2.1` | Engine foundation: `src/engine/{types,random,params,registry,composite,resample,pipeline}.ts` (`RgbaImage`, `EffectStack`, `canonicalStackJson`, `mix32`/`hash32`/`unit`/`intIn`, `validateParams`, migration runner, `createRegistry`, `mix`/`blend`, box downscaler, `renderStack`, `StageCache`). | `engine.md §1–§4, §8.5, §10` | `T0.1` | `T4.1` | Claude Fable (medium) *(justified: cross-cutting effect interface & pipeline model)* | Unit tests for `random.ts` fixed vectors, `params.ts` validation/clamping, `pipeline.ts` skipping/warnings/mix/blend/debug stop, and `StageCache` LRU eviction. |
| `T2.2` | Direction table, line partition, and 8 sort keys: `scripts/gen-direction-table.ts`, checked-in `src/engine/direction-table.ts`, `src/engine/lines.ts` (including 0/90/180/270 fast paths), `src/engine/keys.ts` (all 8 exact integer `key16` formulas). | `engine.md §5.2, §5.3, §14.1, §14.3` | `T2.1` | `T2.4`, `T2.5`, `T2.6` | Gemini 4 Neon (Antigravity, medium) | Unit tests against 12+ hand-computed colours per key, direction-table accuracy test (±1 vs cos/sin), `fast-check` 200-run line partition property tests. |
| `T2.3` | `pixelSort` effect: `src/engine/effects/pixel-sort/{index,select,edges,fill}.ts` implementing all 15 parameters, threshold/Sobel-edge/whole selection, runs/intervals/maxLength/jitter/skip, ascending/descending/shuffle/random, discretize, sort/average/gradient fill, and `'selection'` debug view. | `engine.md §5`, `product.md F6` | `T2.2`, `S1` | `T2.4`, `T2.6`, `T3.2` | Claude Fable (medium) *(justified: hardest engine work — sorting core & selection/interval semantics)* | `fast-check` 200-run property tests (multiset preservation, unselected invariance, monotonicity, θ vs θ+180 symmetry) + selection debug view test. |
| `T2.4` | Glitch effect & registry export: `src/engine/effects/{channel-shift,index}.ts` (`channelShift` and registry exporting `pixelSort` and `channelShift`). | `engine.md §4.2, §6`, `product.md F7` | `T2.1` | `T2.2`, `T2.5`, `T2.6` | GPT Luna | Unit + `fast-check` property tests (zero-offset identity, clamp/wrap edges, determinism, input immutability). |
| `T2.5` | Built-in presets and synthetic test fixtures: `src/presets/builtin.ts` (all 6 first-release presets with exact ids/seeds) and `tests/fixtures/synthetic.ts` (`gradient-64x48`, `noise-97x61`, `bands-80x80`, `alpha-32x32`). | `engine.md §7, §14.2`, `product.md F10` | `T2.1` | `T2.2`, `T2.4`, `T2.6` | GPT Luna | Unit tests verify all 6 presets pass `validateParams` and fixtures generate deterministically. |
| `T2.6` | Native worker codecs: `src/codec/{decode,encode}.ts` (EXIF-normalized `createImageBitmap` decode onto reused `OffscreenCanvas`, native `convertToBlob` for PNG/JPEG/probed WebP with `blob.type` verification, `renderSize` scaling). | `engine.md §13, §14.1`, `product.md F1, F12` | `T2.1` | `T2.2`, `T2.4`, `T2.5` | Gemini 4 Neon (Antigravity, low) | Unit tests for `renderSize` (`4001×3001` at 0.5 -> `2000×1500`), `blob.type` mismatch detection, and WebP probe logic. |
| `T2.7` | Golden images, effect contract suite, and benchmarks: `scripts/golden-update.ts` (using `fast-png`), `tests/golden/**` (all minimum cases in `engine.md §14.2`), `tests/engine/effect-contract.test.ts`, `scripts/bench.ts` (`vp run bench`), `/bench.html`. | `engine.md §4.6, §14.2–§14.4` | `T2.3`, `T2.4`, `T2.5`, `T2.6` | `T3.1`, `T3.2` | Gemini 4 Neon (Antigravity, medium) | `vp test run` passes all golden & contract tests; `vp run bench` prints MP/s cleanly; visual inspection of generated golden PNGs. |

---

## Milestone 3: Workers, render coordinator, and persistence

**Goal:** Move all image processing off the main thread with cooperative cancellation and progressive refinement, and implement durable IndexedDB storage and startup state restoration.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T3.1` | Preview & export workers and render coordinator: `src/worker/{protocol,preview.worker,export.worker}.ts`, `src/render/coordinator.ts` (generations, coalescing, 8 ms `MessageChannel` slicing, adaptive `drag` cap, `settle`, tiled `2,048×2,048` `full` render, worker termination cancel, 30 s timeout & crash restart). | `engine.md §8, §11`, `product.md F8, F12` | `T2.1`, `T2.6`, `S1` | `T3.2`, `T2.7` | Claude Fable (medium) *(justified: worker concurrency, cancellation, crash & memory handling)* | Unit tests for generation ordering, stale drop, adaptive cap step-down/up, 2-crash error state, and cancellation. |
| `T3.2` | IndexedDB repository, memory fallback, migrations, and quota helpers: `src/storage/{types,db,repository,memory-adapter,quota}.ts` (all 6 stores, SHA-256 dedup, ref-counted delete, 201-entry history cap, `VersionError` handling, `QuotaExceededError` rollback, pre-flight quota check). | `persistence.md §1–§7`, `product.md F1–F3, F9, F16` | `T2.1`, `S3` | `T3.1`, `T2.7` | Gemini 4 Neon (Antigravity, medium) | `fake-indexeddb` unit tests covering CRUD, dedup, ref-counted delete, 205-commit -> 200-undo boundary, unknown effect preservation, quota rollback, and memory fallback. |
| `T3.3` | *Deferred to Later (`F17` ZIP backup and restore moved to post-v0.1.0; ID retained so numbering does not shift).* | — | — | — | — | — |
| `T3.4` | Zustand app store and startup restore sequence: `src/state/`, `src/storage/restore.ts` (hash router `#/` & `#/p/<id>`, deleted-project notice, debounced 200 ms view-state saves + `pagehide` flush, lazy history migration, thumbnail generation hook). | `persistence.md §4, §9`, `product.md F3, F9, F10` | `T3.1`, `T3.2` | none | Gemini 4 Neon (Antigravity, medium) | Unit tests for startup restore steps 1–7, hash routing, reload-on-library vs reload-on-project, undo/redo preserving view state. |

---

## Milestone 4: Design system, shell, library, import, and settings

**Goal:** Build the visual foundation (Light and True Black themes), application shell, image import workflow, Library screen, and Settings / About dialogs.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T4.1` | Design tokens, zero-FOUC theme boot, and shadcn UI primitives: `src/styles/app.css`, `index.html` inline theme script, `src/components/ui/*` (`button`, `card`, `dialog`, `alert-dialog`, `dropdown-menu`, `input`, `label`, `popover`, `progress`, `scroll-area`, `select`, `separator`, `sheet`, `slider`, `sonner`, `switch`, `tabs`, `toggle-group`, `tooltip`, `badge`), theme toggle component. | `DESIGN.md §1–§5`, `product.md F14` | `T0.1`, `T0.4` | M2, M3 | Gemini 4 Neon (Antigravity, medium) | Playwright check: Light, True Black (`#000000`), and System themes switch cleanly; zero dark-frame flash on light reload; axe passes. |
| `T4.2` | App shell, secure-context gate, startup integration, storage banner, and polite live region: `src/App.tsx`, route host, secure-context error screen, `Storage unavailable` banner, `role="status"` live region. | `persistence.md §7, §9`, `DESIGN.md §9, §10`, `product.md §4, F3, F16, F19` | `T3.4`, `T4.1` | none | Gemini 4 Neon (Antigravity, low) | Unit + Playwright tests for secure-context error, storage-unavailable banner, live region announcements, and deleted-project hash recovery; 3-viewport screenshots. |
| `T4.3` | Image import flow and validation dialogs: `src/features/import/` (multi-file picker, desktop drag-and-drop overlay, EXIF-normalized dimension probe, 16,384 px / 200 MB rejection messages, > 50 MP `"Import at 50 MP"` / `"Import anyway"` dialog, `"Storage is full"` dialog). | `product.md §4, F1, F16`, `DESIGN.md §9` | `T3.2`, `T4.2` | `T4.4`, `T4.5` | Gemini 4 Neon (Antigravity, medium) | Playwright tests for AC-F1.1–AC-F1.7 and AC-F16.2 (multi-select, drop, invalid file, oversized, > 50 MP downscale, EXIF orientation 6, dedup); 3-viewport screenshots. |
| `T4.4` | Library screen: `src/features/library/` (responsive 2/3/auto-fill card grid, empty state, `IntersectionObserver` lazy thumbnail decoding, card menu with Open/Rename/Duplicate/Delete + confirmation dialog, full keyboard navigation). | `product.md F2`, `DESIGN.md §6.1, §9` | `T4.2`, `T4.3` | `T4.5` | Gemini 4 Neon (Antigravity, medium) | Playwright tests for AC-F2.1–AC-F2.7 (including 100-project lazy scroll and keyboard-only card actions); 3-viewport × 2-theme screenshots. |
| `T4.5` | Settings, storage status, and About/Notices: `src/features/settings/` (Theme selector, `"Using <used> of <quota>"`, persistence status/request, private-browsing note, ASDFPixelSort credit, Third-party notices viewer). | `product.md F14, F16`, `persistence.md §5, §7`, `DESIGN.md §7` | `T4.2` | `T4.4` | Gemini 4 Neon (Antigravity, low) | Playwright tests for AC-F16.1 and About notices; 3-viewport × 2-theme screenshots. |

---

## Milestone 5: Editor workspace, controls, presets, and export

**Goal:** Build the interactive photo canvas, compare/split view, effect stack, schema-driven parameter panel, presets, export flow, and responsive phone/tablet/desktop editor layouts.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T5.1` | Interactive canvas stage, zoom/pan, and render overlays: `src/features/canvas/` (hi-DPI drawing, tiled `full` rendering, > 200% nearest-neighbour, pointer/touch/keyboard zoom & pan, 64 px pan clamp, zoom dropdown Fit/50/100/200/400%, > 300 ms progress bar, `"Rendering full resolution"` pill, 2-crash error card). | `product.md F8, F13`, `engine.md §8.6`, `DESIGN.md §7–§9` | `T3.4`, `T4.2` | `T5.3`, `T5.4`, `T5.6` | Gemini 4 Neon (Antigravity, medium) | Playwright tests for AC-F8.3–AC-F8.5, AC-F13.1–AC-F13.3 (zoom presets, pan clamp, keyboard pan/zoom, pixelated zoom); 3-viewport screenshots. |
| `T5.2` | Compare toggle/hold and split view: `src/features/canvas/compare.tsx` (Compare button & `\` 300 ms hold-vs-toggle, `"Original"` pill, `S` split view, pointer/keyboard divider with 1%/10% steps, aligned under zoom & pan). | `product.md F11`, `DESIGN.md §7, §8.2` | `T5.1` | `T5.5`, `T5.6` | GPT Luna | Playwright tests for AC-F11.1–AC-F11.4 (toggle, 1 s hold, split drag + Arrow/Shift+Arrow, persistence across reload); screenshots. |
| `T5.3` | Effect stack UI: `src/features/stack/` (Add effect picker with labels & descriptions, stack rows with enable/disable + `"Off"` icon & text, pointer drag reorder + `Alt+Up/Down` + Move up/down menu, Duplicate, Remove, `"Unsupported effect"` row, 32-instance cap). | `product.md F4`, `DESIGN.md §5.3, §7` | `T3.4`, `T4.1` | `T5.1`, `T5.4`, `T5.6` | Gemini 4 Neon (Antigravity, medium) | Playwright tests for AC-F4.1–AC-F4.6 (add, toggle Off, drag & keyboard reorder, duplicate, remove + undo, unknown type); 3-viewport screenshots. |
| `T5.4` | Schema-driven parameter panel & custom controls: `src/features/params/` (all 7 `ParamSpec` kinds including `AngleDial` with 45° snaps and two-thumb `RangeSlider`, `visibleWhen`, per-param reset, `"Reset all"`, universal `mix` & `blend`, `pixelSort` `"Show selection"` switch, slider release commit & 500 ms keyboard burst commit). | `product.md F5, F6`, `engine.md §3, §4.5, §5.7`, `DESIGN.md §5.1, §5.2` | `T2.1`, `T3.4`, `T4.1` | `T5.1`, `T5.3`, `T5.6` | Gemini 4 Neon (Antigravity, medium) | Playwright tests for AC-F4.7–AC-F4.10, AC-F5.1–AC-F5.6 and AC-F6.6 (mix/blend, exact entry, clamping, single commit on 3 s drag, 500 ms key burst, `edges` visibility toggle, Show selection). |
| `T5.5` | Undo/redo toolbar & shortcuts and Presets UI: `src/features/presets/` (Undo/Redo buttons with commit-labeled `aria-label`/tooltips, `Ctrl/Cmd+Z` & `Ctrl/Cmd+Shift+Z`/`Ctrl+Y`, Presets tab listing 6 built-in + user presets, Apply, Add to stack, Save as preset, Rename/Delete user presets only). | `product.md F9, F10`, `DESIGN.md §5.3, §8.3` | `T5.3`, `T5.4` | `T5.2`, `T5.6` | Gemini 4 Neon (Antigravity, medium) | Playwright tests for AC-F9.1–AC-F9.5 and AC-F10.1–AC-F10.4 (ASDF classic -> 2 instances, save/apply across projects, built-ins read-only). |
| `T5.6` | Export dialog: `src/features/export/` (PNG/JPEG/probed WebP, quality 50–100 default 92, Full/1/2/1/4/Custom longest side with live output dimensions, default timestamped filename, worker progress + Cancel, Download + `navigator.canShare` Share, remembered per-project settings, OOM guidance). | `product.md F12`, `engine.md §11, §13`, `DESIGN.md §7, §9` | `T3.1`, `T3.4`, `T4.1` | `T5.1`, `T5.2`, `T5.3`, `T5.4`, `T5.5` | Gemini 4 Neon (Antigravity, medium) | Playwright tests for AC-F12.1–AC-F12.7 (PNG dimensions, 1/2 rounding, cancel within 1 s, EXIF-free output bytes, remembered settings). |
| `T5.7` | Responsive editor chrome assembly: wire phone bottom sheet (3 detents + landscape right drawer) + horizontal stack strip, tablet resizable/collapsible docked bottom panel, desktop 340 px right sidebar; verify viewport-resize state retention and zero horizontal scroll. | `product.md F18`, `DESIGN.md §6.2–§6.4` | `T5.1`–`T5.6` | none | Gemini 4 Neon (Antigravity, medium) | Playwright tests for AC-F18.1–AC-F18.3 (no horizontal scroll, target sizes, viewport-resize retention); desktop browser screenshots at `390×844`, `820×1180`, `1440×900` in both themes (layout check only). |

---

## Milestone 6: PWA offline, accessibility, E2E verification, and first release

**Goal:** Ship full offline PWA support, verify WCAG 2.2 AA and every first-release acceptance criterion (`F1`–`F16`, `F18`–`F19`), and complete desktop browser sign-off and deploy to `glitch.bbay.dev` for `v0.1.0`.

| ID | Task | Spec sections | Depends on | Parallel with | Model tier | Verification |
|---|---|---|---|---|---|---|
| `T6.1` | PWA manifest, service worker, and install UI: configure `vite-plugin-pwa` (Workbox precache of app shell, workers, icons; `registerType: 'prompt'` so updates never auto-reload), `"Reload to update"` toast, `beforeinstallprompt` `"Install app"` menu item, zero third-party network check. | `product.md F15`, `DESIGN.md §7, §9` | `T4.2`, `S3` | `T6.2` | Gemini 4 Neon (Antigravity, medium) | Playwright offline test (AC-F15.1), zero external-origin network assertions (AC-F15.2), simulated SW update toast (AC-F15.3). |
| `T6.2` | Accessibility test suite and fixes: Playwright + `@axe-core/playwright` suite covering Library, Editor, Export, and Settings × 2 themes × 3 viewports, full keyboard-only core loop test, live-region assertion test, and `prefers-reduced-motion: reduce` test. | `product.md F19`, `DESIGN.md §10` | `T5.7` | `T6.1` | Gemini 4 Neon (Antigravity, medium) | AC-F14.3 and AC-F19.1–AC-F19.4 green in CI (`vp run check:a11y`). |
| `T6.3` | Full E2E acceptance test suite & independent review: automated Playwright coverage for `F1`–`F16`, `F18`–`F19` (including session reload, cross-reload undo, deterministic double-export pixel equality, and synthetic E2E fixture generated in code); independent diff review by GPT Luna. | `product.md §5` | `T6.1`, `T6.2` | none | Gemini 4 Neon (Antigravity, medium) + GPT Luna (review) | Full CI green; every first-release acceptance criterion mapped to an automated test or manual desktop checklist item. |
| `T6.4` | Desktop acceptance & `v0.1.0` release: execute release checklist on the desktop browser matrix (product.md section 8: laptop Chromium 120+ and Firefox 128+), record p50/p95 timings, verify `https://glitch.bbay.dev` deploy (`CNAME`, root path), run manual `release.yml`. | `product.md §8`, `docs/agents/tooling.md` | `T0.5`, `T6.3` | none | Owner + Lead agent | Signed checklist recorded; `v0.1.0` deployed to `glitch.bbay.dev` and GitHub release published. |

---

## Feature-to-task coverage table (first release: F1–F16, F18–F19; F17 moved to Later)

| Feature | Summary | Implementing tasks | Verification tasks |
|---|---|---|---|
| `F1` | Import images (picker, drop, 50 MP limit, EXIF, SHA-256 dedup) | `T2.6`, `T3.2`, `T4.3` | `T4.3`, `T6.3` |
| `F2` | Library (cards, result thumbnails, rename, duplicate, delete, lazy 100-item scroll) | `T3.2`, `T3.4`, `T4.4` | `T3.2`, `T4.4`, `T6.3` |
| `F3` | Session restore (library, open project, stack, history, zoom/pan, split, `#/p/<id>`) | `T3.2`, `T3.4`, `T4.2` | `S3`, `T3.4`, `T6.3` |
| `F4` | Effect stack (add, select, enable/off, reorder drag+keyboard, duplicate, remove, unknown types, mix/blend) | `T2.1`, `T5.3`, `T5.4` | `T2.1`, `T5.3`, `T5.4`, `T6.3` |
| `F5` | Parameter controls (schema-driven controls, clamping, commits, `visibleWhen`, resets) | `T2.1`, `T5.4` | `T2.1`, `T5.4`, `T6.3` |
| `F6` | Pixel sort effect (15 params, exact angles/keys, selection debug view, deterministic export) | `T2.2`, `T2.3`, `T5.4` | `S1`, `T2.2`, `T2.3`, `T2.7`, `T6.3` |
| `F7` | Glitch effects (`channelShift`) | `T2.4` | `T2.4`, `T2.7`, `T6.3` |
| `F8` | Live preview & full-res view (`drag`, `settle`, tiled `full`, cancellation, progress bar) | `T2.1`, `T3.1`, `T5.1` | `S1`, `T3.1`, `T5.1`, `T6.3` |
| `F9` | Undo and redo (labeled commits, 200-step persisted history, shortcuts) | `T3.2`, `T3.4`, `T5.5` | `T3.2`, `T5.5`, `T6.3` |
| `F10` | Presets (6 built-in + user presets, Apply / Add / Save / Rename / Delete) | `T2.5`, `T3.2`, `T5.5` | `T2.5`, `T5.5`, `T6.3` |
| `F11` | Compare (toggle/hold `\` & button, split view `S` & draggable/keyboard divider) | `T3.4`, `T5.2` | `T5.2`, `T6.3` |
| `F12` | Export (native PNG/JPEG/probed WebP, quality, sizes, progress/cancel, Share, EXIF-free) | `T2.6`, `T3.1`, `T5.6` | `T2.6`, `T5.6`, `T6.3`, `T6.4` |
| `F13` | Zoom and pan (fit, 100%, 10%–3200%, 60 fps zoom/pan, keyboard, 64 px clamp, >200% crisp) | `T5.1` | `T5.1`, `T6.3`, `T6.4` |
| `F14` | Themes (Light, True Black `#000000`, System, zero-flash reload, contrast) | `T3.4`, `T4.1`, `T4.5` | `T4.1`, `T6.2`, `T6.3` |
| `F15` | Offline and install (PWA precache, offline editing/export, update toast, install prompt) | `T6.1` | `S3`, `T6.1`, `T6.3`, `T6.4` |
| `F16` | Storage status and warnings (usage/quota, full dialog, private browsing note, unavailable banner) | `T3.2`, `T4.2`, `T4.5` | `S3`, `T3.2`, `T4.2`, `T4.5`, `T6.4` |
| `F18` | Responsive layouts (390/820/1440 layout check in desktop browser, target sizing, resize retention) | `T4.4`, `T5.7` | `T5.7`, `T6.2`, `T6.4` |
| `F19` | Accessibility baseline (WCAG 2.2 AA, keyboard loop, axe clean, live region, reduced motion) | `T4.1`, `T4.2`, `T5.1`–`T5.7`, `T6.2` | `T6.2`, `T6.3` |

---

## Later work (post-v0.1.0)

Each item below requires its own spec in `docs/specs/` (or `docs/specs/effects/`) before implementation starts (moved items retain their existing spec sections under "Later"). Ordered roughly by user value and architectural sequence:

1. **Backup and restore (`F17`, formerly `T3.3`):** `fflate` ZIP export/import of projects and presets, double-import deduplication, corruption/version validation, and 30-day reminder ([persistence.md section 8](persistence.md#8-later-backup-export-and-import-f17-and-eviction-warnings)).
2. **Deferred glitch effects (from `F7`):** `sliceShift`, `blockShuffle`, `channelSwap`, and the `vhs-split` and `tile-scramble` presets ([engine.md section 16.1](engine.md#161-deferred-glitch-effects)).
3. **Mobile, tablet, and Safari acceptance (formerly `S2`):** Real-device acceptance on phones, tablets, and Safari; the iOS > 16.78 MP decode/export path (tiled decode, `fflate` streaming PNG writer, on-demand Wasm JPEG encoder, 24 MP mobile limit, [engine.md section 16.2](engine.md#162-ios-canvas-limit-decode-and-export-path)); and Safari 7-day storage eviction / Home Screen warnings ([persistence.md section 8.0](persistence.md#80-safari-7-day-eviction-warning-later)).
4. **Masks and on-canvas tools (`EffectStack` `schemaVersion: 2`):** Per-instance 8-bit brush/luminance/imported masks following [engine.md section 5.6](engine.md#56-masks-later-semantics-fixed-now), using the reserved on-canvas tool slot ([engine.md section 4.7](engine.md#47-on-canvas-tool-slot-reserved-for-later), [DESIGN.md section 7.1](../../DESIGN.md#71-on-canvas-tool-slot-reserved-for-later)). Adds a `masks` IndexedDB store.
5. **More effects & `pixelSort` v2:** `smear`, `waveShift`, `posterize`, `dither`, `grain`, source-stage `dataBend`, per-channel pixel sort, plus `pixelSort` v2 interval transforms (mirror, splice, fold/`middlate`, smooth grouping) and non-linear paths (concentric rectangles, circles, spirals, random walks, tiles).
6. **Editing comfort & extended formats:** History list panel, compare against any history entry, clipboard paste, source crop/rotate, batch export, AVIF export and Safari WebP export via lazy-loaded Wasm encoders (`@jsquash/avif`, `@jsquash/webp`), 16-bit / Display P3 pipelines.
7. **WebGPU acceleration:** Plug into `src/engine/gpu/` per [engine.md section 12](engine.md#12-where-webgpu-plugs-in-later). First target: axis-aligned `pixelSort` for lines ≤ 4,096 px using per-line workgroups, parallel prefix/suffix scan selection and interval splitting, and bitonic sorting network in 16 KiB workgroup memory (clean-room or MIT-attributed port of `ruccho/BitonicPixelSorter` with notice in `THIRD-PARTY-NOTICES.md`). Must pass bit-exact golden tests before enabling for `settle`/`full`; startup smoke test and CPU fallback on device loss remain mandatory.
8. **Motion (GIF and video):** Introduce a frame-source and keyframe-interpolation layer above the pure `renderStack` pipeline (parameter animation over N frames, GIF/video frame-by-frame input, WebCodecs `VideoEncoder` + client-side muxer or Wasm GIF encoder). Zero changes to still-image effect kernels.
9. **Native packaging with Tauri:** Package the static `dist/` build with **Tauri** for native desktop and mobile apps. Because Tauri uses the system webview (WebKit on iOS and macOS, WebKitGTK on Linux), the iOS canvas-limit path in item 3 is required before shipping Apple native builds ([decisions.md D13](decisions.md#d13-tauri-for-later-native-packaging-2026-11-24)).
