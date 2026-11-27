# Drift `v0.4.0` Acceptance Traceability (`T10.8`)

Maps every acceptance criterion of the `v0.4.0` features in [product.md](product.md) to its automated tests: masks and the on-canvas brush (`F29`), pasting from the clipboard (`F30`), comparing against any history step (`F31`) and `pixelSort` version 2 (`AC-F6.7` to `AC-F6.9`). Earlier features stay mapped in [acceptance-v0.1.0.md](acceptance-v0.1.0.md), [acceptance-v0.2.0.md](acceptance-v0.2.0.md) and [acceptance-v0.3.0.md](acceptance-v0.3.0.md).

Each test is written as its file, then its title in quotes. Titles with `%s`, `%o` or `$name`, and titles holding a `${...}` value, are table-driven. Tests under `tests/storage/` that name two adapters run against IndexedDB (`fake-indexeddb`) and the in-memory adapter. The `M` numbers point to the [manual checklist](#manual-checklist), which covers what a test machine cannot judge. Run the automated tests with `vp run check` (unit and component), `vp run test:e2e` (Playwright, Chromium and Firefox) and `vp run test:perf` (speed budgets).

Pen and touch input in the tests is synthetic pointer events. No pen or touch hardware is driven.

## F29: masks and on-canvas brush

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F29.1` Empty mask, Fill, Remove mask | `tests/e2e/mask-controls.spec.ts` "AC-F29.1: a new painted mask hides the effect, Fill and Remove mask restore it"<br>`tests/state/app-store-masks.test.ts` "adds, replaces and removes a mask, one history entry each, with the stack version", "fills with a stored all-255 asset at the grid size, and clears it" | — |
| `AC-F29.2` Inside and outside the stroke | `tests/e2e/mask-brush.spec.ts` "AC-F29.2: pixels outside the stroke keep the input, the hard core gets the effect" | — |
| `AC-F29.3` Invert mask | `tests/e2e/mask-controls.spec.ts` "AC-F29.3: Invert mask keeps the painted area and affects the rest"<br>`tests/engine/mask-pipeline.test.ts` "inverting twice is the identity" | — |
| `AC-F29.4` Erase, 50% strength | `tests/e2e/mask-brush.spec.ts` "AC-F29.4: erase removes the effect, and one 50% stroke never builds up past 128"<br>`tests/engine/mask-brush.test.ts` "stays at 128 at half strength however often it crosses itself", "erases a filled mask to 0 inside every hard dab core" | — |
| `AC-F29.5` Hardness and feather | `tests/e2e/mask-brush.spec.ts` "AC-F29.5: hardness shapes the edge, and feather widens it in preview and export"<br>`tests/engine/mask-brush.test.ts` "has an edge of at most 2 px at hardness 100", "fades from the centre to the radius at hardness 0"<br>`tests/engine/mask-evaluate.test.ts` "scales the radius from effective-image pixels" | `M6` |
| `AC-F29.6` One stroke, one history entry | `tests/e2e/mask-brush.spec.ts` "AC-F29.6: one drag is one history entry that undo, redo, reload and History restore"<br>`tests/state/app-store-brush.test.ts` "commits one stroke as one entry, and a later undo waits for it", "writes no entry for a stroke that changed nothing" | — |
| `AC-F29.7` Pen pressure | `tests/e2e/mask-brush.spec.ts` "AC-F29.7: pen pressure sets the size only when asked, and a mouse stroke is even"<br>`tests/engine/mask-brush.test.ts` "scales by pen pressure only when the setting is on" | `M1` |
| `AC-F29.8` Second touch pans or zooms | `tests/e2e/mask-brush.spec.ts` "AC-F29.8: a second finger drops the stroke and zooms; a pen shuts out touches" | `M2` |
| `AC-F29.9` Keyboard only | `tests/e2e/mask-brush.spec.ts` "AC-F29.9: the keyboard alone adds a mask, paints, sets the brush and leaves it" | `M7` |
| `AC-F29.10` Brightness mask | `tests/e2e/mask-controls.spec.ts` "AC-F29.10: a brightness mask selects by the photo, whatever runs above it"<br>`tests/engine/mask-evaluate.test.ts` "selects 128 and up for the range 50% to 100% (AC-F29.10)"<br>`tests/engine/mask-pipeline.test.ts` "computes a brightness mask from the source, whatever runs above" | — |
| `AC-F29.11` Image mask | `tests/e2e/mask-controls.spec.ts` "AC-F29.11: an image mask limits the effect, is stored once and outlives its project"<br>`tests/storage/masks.test.ts` "counts mask images as extra sources, with one cap and message", "stores an image picked for a mask with its commit" | `M6` |
| `AC-F29.12` Pixel sort runs and selection view | `tests/e2e/mask-controls.spec.ts` "AC-F29.12: no pixel sort run crosses a zero area, and Show selection darkens it"<br>`tests/engine/pixel-sort-mask.test.ts` "breaks a run at a mask value of 0", "darkens masked-out pixels in the selection view", "with fill sort never moves a pixel into or out of the zero area" | — |
| `AC-F29.13` Rotate and crop | `tests/e2e/mask-brush.spec.ts` "AC-F29.13: paint stays on the same photo content through rotate and crop"<br>`tests/engine/mask-evaluate.test.ts` "orients and crops like the geometry transform of the photo" | — |
| `AC-F29.14` Split view sides | `tests/e2e/mask-brush.spec.ts` "AC-F29.14: in split view the brush paints only the side being edited" | — |
| `AC-F29.15` Presets keep brightness masks only | `tests/e2e/mask-controls.spec.ts` "AC-F29.15: a saved preset keeps only the brightness mask"<br>`tests/storage/masks.test.ts` "keeps only brightness masks in a preset (AC-F29.15)"<br>`tests/state/app-store-masks.test.ts` "drops painted and image masks from a saved preset and keeps brightness masks" | — |
| `AC-F29.16` `.glproj` and backup round trip | `tests/e2e/acceptance-v040.spec.ts` "AC-F29.16: a project file and a backup of a masked project restore pixels and undo steps on a fresh profile" (also the missing and changed mask entry messages), "AC-F29.16: a project without masks still saves as format version 1"<br>`tests/storage/archive-masks.test.ts` "writes nothing for a project file with %s (AC-F29.16)", "writes nothing for a backup with %s (AC-F29.16)", "stores each mask of a backup once and restores undo (AC-F29.16)", "writes version 1 without a mask list when nothing is masked" | `M3` |
| `AC-F29.17` Database upgrade, identical exports | `tests/e2e/acceptance-v040.spec.ts` "AC-F29.17: a 4000 × 3000 project upgraded from database version 3 keeps pixels and history, and masked exports are identical"<br>`tests/storage/db-v4-upgrade.test.ts` "adds the mask store and references and keeps all other data (AC-F29.17)", "leaves version 3 intact when the upgrade %s" | `M4` |
| `AC-F29.18` Speed while painting | `tests/e2e/acceptance-v040.spec.ts` "AC-F29.18: painting a 12 MP photo shows the overlay and the preview in time @perf". Results: [speed](#brush-speed) | `M5` |
| `AC-F29.19` Three widths, both themes | `tests/e2e/mask-controls.spec.ts` "mask controls at ${viewport.width}x${viewport.height} in ${theme.name} @a11y"<br>`tests/e2e/mask-brush.spec.ts` "the brush at ${viewport.width}x${viewport.height} in ${theme.name} @a11y"<br>The 44 px targets are checked in Chromium only, which can emulate a coarse pointer | `M2`, `M3` |
| `AC-F29.20` No network request | `tests/e2e/mask-brush.spec.ts` "AC-F29.2: pixels outside the stroke keep the input, the hard core gets the effect" records every request from adding the mask through painting and export, and allows the app's own origin only | — |
| Overlay, missing mask, settings (`F29` text) | `tests/e2e/mask-controls.spec.ts` "Show mask: the overlay follows the switch, M, opacity, compare and split, and stays out of exports", "a painted mask that storage lost shows Missing mask and skips the effect"<br>`tests/e2e/mask-brush.spec.ts` "the overlay, cursor, panning and suspending follow the brush rules", "brush settings are kept on the device" | `M6` |

### Brush speed

`AC-F29.18` names the reference laptop. The numbers below are from the development machine (Intel Core i7-13650HX, Linux, power-saver profile, other builds running), so they do not settle the criterion; `M5` does. The test uses a 4000 × 3000 px photo, one default pixel sort effect and the default brush: 180 timed pointer moves and 10 strokes. Run it with `BRUSH_BUDGETS=1 pnpm exec playwright test --config playwright.perf.config.ts --workers=1 acceptance-v040`. Without `BRUSH_BUDGETS=1`, as in CI, the test asserts only that Chromium reports no main-thread task over 50 ms, that every timed move shows, and that no time is ten times over its budget.

Measured on 2026-11-28. Runs 1 and 2 asserted the budgets; run 3 (the whole perf suite) and run 4 only recorded them. Load average on 12 threads was between 20 and 50, and lowest in run 4.

| Run | Browser | Overlay p95 (median, max), budget 50 ms | Preview p95 (median), budget 500 ms | Main thread, budget 50 ms | Result |
|---|---|---|---|---|---|
| 1 | Chromium | 49 ms (41, 53) | 442 ms (364) | no long task; timer stall 49 ms | within budget |
| 2 | Chromium | 50.1 ms (40, 55) | 485 ms (365) | no long task; timer stall 44 ms | overlay over by 0.1 ms |
| 1 | Firefox | 156 ms (48, 344) | 1281 ms (620) | timer stall 116 ms | over budget |
| 2 | Firefox | 123 ms (57, 297) | 1603 ms (873) | timer stall 125 ms | over budget |
| 3 | Chromium | 49 ms (40, 51) | 375 ms (313) | no long task; timer stall 46 ms | within budget |
| 3 | Firefox | 94 ms (47, 167) | 1253 ms (496) | timer stall 62 ms | over budget |
| 4 | Chromium | 48 ms (42, 56) | 455 ms (294) | no long task; timer stall 43 ms | within budget |
| 4 | Firefox | 55 ms (46, 61) | 630 ms (450) | timer stall 46 ms | overlay and preview over |

`AC-F29.18` is therefore not verified. Chromium sits at the limit on this machine. Firefox misses at least one budget in every run, by less when the machine is less loaded, and these runs cannot tell that load apart from the app's own cost.

The overlay time runs from the pointer event to the first animation frame in which the canvas pixel under the pointer has changed. The preview time runs from releasing the button to the first frame after the new full preview arrives. The main-thread check is a second pass without the pixel probe: the Long Tasks API in Chromium, and the longest delay of a 10 ms timer in Firefox, which has no such API.

## F30: paste image from clipboard

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F30.1` Paste on the Library | `tests/e2e/clipboard-paste.spec.ts` "Ctrl+V imports on the Library and in the editor (AC-F30.1, .2, .5)" | `M8` |
| `AC-F30.2` Paste in the editor | `tests/e2e/clipboard-paste.spec.ts` "Ctrl+V imports on the Library and in the editor (AC-F30.1, .2, .5)" | `M8` |
| `AC-F30.3` Text fields and dialogs | `tests/e2e/clipboard-paste.spec.ts` "typing fields and dialogs keep the paste (AC-F30.3)", "a text field in the editor keeps the paste (AC-F30.3)"<br>`src/features/import/clipboard-paste.test.tsx` "stays out while a dialog is open" | — |
| `AC-F30.4` Text only | `tests/e2e/clipboard-paste.spec.ts` "text and the Guide import nothing (AC-F30.4)"<br>`src/features/import/clipboard-paste.test.tsx` "leaves a paste without a picture alone" | — |
| `AC-F30.5` Shared source | `tests/e2e/clipboard-paste.spec.ts` "Ctrl+V imports on the Library and in the editor (AC-F30.1, .2, .5)" | — |
| `AC-F30.6` Size limits | `tests/e2e/clipboard-paste.spec.ts` "a copied file keeps its name, and the size limits apply (AC-F30.6)" | — |
| `AC-F30.7` "Paste image" by keyboard | `tests/e2e/clipboard-paste.spec.ts` "\"Paste image\" imports from the empty Library and the menu by keyboard (AC-F30.7)"<br>`src/features/import/clipboard-paste.test.tsx` "starts the import with the clipboard picture", "is left out where the clipboard cannot be read" | `M8` |
| `AC-F30.8` Messages | `tests/e2e/clipboard-paste.spec.ts` "\"Paste image\" says that the clipboard has no picture (AC-F30.8)", "\"Paste image\" says that access was denied (AC-F30.8)"<br>`src/features/import/clipboard-paste.test.tsx` "says that the clipboard has no picture" | `M8` |
| `AC-F30.9` No shortcut on touch | `tests/e2e/clipboard-paste.spec.ts` "no paste shortcut is named (AC-F30.9)" | `M2` |

## F31: compare against any history step

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F31.1` Non-destructive pin | `tests/e2e/history.spec.ts` "AC-F31.1 AC-F31.2 AC-F31.3 AC-F31.4: compares against an earlier history step in split, horizontal split, and toggle compare without mutating history"<br>`tests/state/app-store-compare-history.test.ts` "pins a history step non-destructively without mutating history, head, stacks, or stored compareMode" | — |
| `AC-F31.2` Pill and row mark | the same `AC-F31.1` Playwright test | — |
| `AC-F31.3` Split and toggle show the pin | the same `AC-F31.1` Playwright test | — |
| `AC-F31.4` Exit | the same `AC-F31.1` Playwright test<br>`tests/state/app-store-compare-history.test.ts` "keeps split mode on exit when split mode was already active before pinning" | — |
| `AC-F31.5` Clean teardown | `tests/e2e/history.spec.ts` "AC-F31.5 AC-F31.6: handles different geometry transforms and clears cleanly on Escape, Undo, and crop mode"<br>`tests/state/app-store-compare-history.test.ts` "clears cleanly on project switch, close, crop mode, undo, redo, jump, and trimmed redo branch" | — |
| `AC-F31.6` Different transforms | `tests/e2e/history.spec.ts` "AC-F31.5 AC-F31.6: handles different geometry transforms and clears cleanly on Escape, Undo, and crop mode"<br>`tests/state/app-store-compare-history.test.ts` "renders a pinned entry with a different transform even when its stack is empty" | `M6` |
| `AC-F31.7` Trimmed redo branch | `tests/state/app-store-compare-history.test.ts` "clears cleanly on project switch, close, crop mode, undo, redo, jump, and trimmed redo branch" | — |
| `AC-F31.8` Keyboard, targets, widths, themes | `tests/e2e/history.spec.ts` "AC-F31.8: the compare toggle and the canvas exit work from the keyboard", "AC-F31.8: the compare toggle is at least 44 by 44 px", "AC-F31.8: compare history layout and a11y at ${viewport.name} in ${theme} @a11y" | `M2` |

## pixelSort version 2

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F6.7` Channels | `tests/engine/pixel-sort.test.ts` "sorts R, G and B independently in rgb mode while keeping alpha intact", "sorts only the selected single channel in r, g and b modes"<br>`tests/engine/pixel-sort.property.test.ts` "with fill sort keeps the multiset of pixels in rgba and per-channel multisets in every channelMode"<br>`tests/e2e/param-panel.spec.ts` "AC-F6.7 & AC-F6.8: pixelSort Channels and Interval transform controls toggle visibility and render" | `M6` |
| `AC-F6.8` Interval transform | `tests/engine/pixel-sort.test.ts` "produces the exact bijective index permutations on odd and even lengths", "applies each interval transform to sorted intervals", "applies interval transforms to gradient fills"<br>`tests/e2e/param-panel.spec.ts` "AC-F6.7 & AC-F6.8: pixelSort Channels and Interval transform controls toggle visibility and render" | `M6` |
| `AC-F6.9` Version 1 migration | `tests/engine/pixel-sort.test.ts` "migrates v1 instances without params-fixed warning and renders byte-identically to v2 defaults" | — |

## Manual checklist

Run against the production build (`vp run gui`) or the published site. A phone or tablet needs the published site, because the app needs HTTPS. Record the tester, device, browser version, date and result for each item. None has been run for this document.

| ID | Steps | Pass when |
|---|---|---|
| `M1` | With a real stylus (drawing tablet, or a tablet with a pen): paint with light and hard pressure, with "Pen pressure sets size" on and off, while resting a hand on the screen. | Pressure changes the width only when on, strokes have no gaps or jumps, and the palm paints nothing. |
| `M2` | On a real phone and tablet: add each mask type, paint and erase with one finger, put a second finger down during a stroke, pinch and pan, compare an earlier history step, and open the start screen. | One finger paints, two fingers cancel the stroke and zoom, every control can be tapped, the page does not scroll or zoom by itself, and no keyboard shortcut is named. |
| `M3` | In Safari on a Mac, an iPhone and an iPad: paint a mask, save a `.glproj` and a backup, and open both in Chrome, then the other way round. Safari is best effort. | Record what fails. Nothing existing is lost or changed. |
| `M4` | On a browser profile that has real `v0.3.0` projects, open `v0.4.0`. Then keep a second tab of the old version open during the first start. | Every project opens with the same pixels and history. The second tab is told to reload. |
| `M5` | On the reference laptop on mains power, balanced or performance profile, nothing else running, run the speed command under [Brush speed](#brush-speed) for Chromium and Firefox, then paint on a real 12 MP photo by hand. | Overlay p95 under 50 ms, no main-thread task over 50 ms, preview p95 within 500 ms. Record the numbers in this document. |
| `M6` | On real photos, paint around a subject, try feather, invert, brightness and image masks, the new pixel sort channels and interval transforms, and compare with an earlier cropped step. | Edges look as the controls say, the overlay lies on the right place, and the preview matches the exported PNG. |
| `M7` | With a screen reader, paint a stroke from the keyboard. | The brush state, tool and each finished stroke are announced and understandable. |
| `M8` | Copy a picture from another application, a screenshot, and an image file in a file manager. Paste each with the shortcut and with "Paste image", in Chrome and Firefox. | Each becomes one project, or the message says why not. Permission prompts are understandable. |
| `M9` | Open Settings, then About, then View changelog. After the owner publishes the release, check the version and link shown there against the GitHub release. | The `v0.4.0` notes are first and read correctly. |
