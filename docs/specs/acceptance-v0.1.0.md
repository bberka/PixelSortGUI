# Drift `v0.1.0` Acceptance Traceability (`T6.3`)

Maps every first-release feature (`F1`–`F16`, `F18`–`F19` in [product.md](product.md)) to its automated test coverage or manual desktop acceptance item (`T6.4`).

| Feature | Automated E2E / Unit coverage | Manual desktop checklist (`T6.4`) |
|---|---|---|
| `F1` Import images | `tests/e2e/import.spec.ts`, `tests/e2e/acceptance.spec.ts`, `src/codec/decode.test.ts` | Native OS file picker & drag-drop smoke on Chromium/Firefox |
| `F2` Library | `tests/e2e/library.spec.ts`, `tests/e2e/acceptance.spec.ts`, `tests/storage/repository.test.ts` | 100-project scroll smoothness on reference laptop |
| `F3` Session restore | `tests/e2e/session-restore.spec.ts`, `tests/e2e/acceptance.spec.ts`, `tests/storage/restore.test.ts` | Cold browser restart & 50-project < 1 s startup check |
| `F4` Effect stack | `tests/e2e/effect-stack.spec.ts`, `tests/e2e/param-panel.spec.ts`, `tests/engine/pipeline.test.ts` | — |
| `F5` Parameter controls | `tests/e2e/param-panel.spec.ts`, `tests/engine/params.test.ts` | — |
| `F6` Pixel sort effect | `tests/e2e/acceptance.spec.ts`, `tests/e2e/golden.spec.ts`, `tests/engine/pixel-sort.test.ts`, `tests/engine/effect-contract.test.ts` | — |
| `F7` Glitch effects (`channelShift`) | `tests/e2e/acceptance.spec.ts`, `tests/e2e/golden.spec.ts`, `tests/engine/channel-shift.test.ts` | — |
| `F8` Live preview & full-res view | `tests/e2e/render-workers.spec.ts`, `tests/e2e/canvas.spec.ts`, `tests/e2e/render-bench.spec.ts`, `src/render/coordinator.test.ts` | 12 MP 5 s drag trace & p50/p95 timing sign-off on reference laptop |
| `F9` Undo and redo | `tests/e2e/toolbar.spec.ts`, `tests/e2e/session-restore.spec.ts`, `tests/e2e/acceptance.spec.ts`, `tests/storage/repository.test.ts` | — |
| `F10` Presets | `tests/e2e/toolbar.spec.ts`, `tests/e2e/acceptance.spec.ts`, `tests/presets/builtin.test.ts` | — |
| `F11` Compare & split view | `tests/e2e/compare.spec.ts`, `tests/e2e/acceptance.spec.ts` | — |
| `F12` Export | `tests/e2e/export.spec.ts`, `tests/e2e/acceptance.spec.ts`, `src/codec/encode.test.ts` | 12 MP Full PNG < 5 s timing & Web Share check where supported |
| `F13` Zoom and pan | `tests/e2e/canvas.spec.ts`, `tests/e2e/acceptance.spec.ts` | 60 fps continuous wheel/trackpad zoom check on reference laptop |
| `F14` Themes | `tests/e2e/theme.spec.ts`, `tests/e2e/settings.spec.ts`, `tests/e2e/acceptance.spec.ts`, `tests/e2e/a11y.spec.ts` | 60 fps reload recording for zero-FOUC verification |
| `F15` Offline & install | `tests/e2e/pwa.spec.ts`, `tests/e2e/acceptance.spec.ts` | `https://drift.bbay.dev` live deploy, `CNAME`, install prompt & offline reload |
| `F16` Storage status & warnings | `tests/e2e/settings.spec.ts`, `tests/e2e/storage.spec.ts`, `tests/e2e/import.spec.ts`, `tests/e2e/acceptance.spec.ts` | Private browsing window sanity check |
| `F18` Responsive layouts | `tests/e2e/editor-layout.spec.ts`, `tests/e2e/acceptance.spec.ts`, `tests/e2e/a11y.spec.ts` | Visual layout check at `390×844`, `820×1180`, `1440×900` |
| `F19` Accessibility baseline | `tests/e2e/a11y.spec.ts` | — |
