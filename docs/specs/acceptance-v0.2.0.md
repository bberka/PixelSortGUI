# Drift `v0.2.0` Acceptance Traceability (`T7.17`)

Maps every acceptance criterion added since `v0.1.0` in [product.md](product.md) to its automated tests: the next-release features `F20` to `F24`, the side-by-side effect stacks and horizontal split (`AC-F11.5` to `AC-F11.14`, `AC-F12.10`), the export file-size limit (`AC-F12.8`, `AC-F12.9`) and the in-app guide (`F27`). Features present in `v0.1.0` stay mapped in [acceptance-v0.1.0.md](acceptance-v0.1.0.md).

Each test is written as its file, then its title in quotes. Titles with `%s` or `%i` are table-driven tests. The `M` numbers point to the [manual desktop checklist](#manual-desktop-checklist), which covers what a test machine cannot judge. Run the automated tests with `vp run check` (unit and component), `vp run test:e2e` (Playwright, Chromium and Firefox) and `vp run test:perf` (speed budgets).

## F11 and F12: split sides, horizontal split and export

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F11.5` Orientation button and `Shift+S` | `tests/e2e/split-sides.spec.ts` "AC-F11.5: Shift+S and the orientation button switch between left/right and top/bottom, turning split on" | `M6` |
| `AC-F11.6` Horizontal divider drag and keys | `tests/e2e/split-sides.spec.ts` "AC-F11.6: a horizontal divider drags up and down and steps with Up/Down by 1% and 10%" | — |
| `AC-F11.7` Orientation and position per project | `tests/e2e/split-sides.spec.ts` "AC-F11.7: orientation and divider position are kept per project across reload" | — |
| `AC-F11.8` Side A starts as the original | `tests/e2e/split-sides.spec.ts` "AC-F11.8: side A starts as the original and takes its own effects through the Editing switch" | `M6` |
| `AC-F11.9` Copy to other side, Swap sides | `tests/e2e/split-sides.spec.ts` "AC-F11.9: Copy to other side and Swap sides are each one undoable step"<br>`tests/state/app-store-split.test.ts` "swaps the two stacks and their selections as one undo step" | — |
| `AC-F11.10` Undo and redo across sides | `tests/e2e/split-sides.spec.ts` "AC-F11.10: undo and redo step through both sides with the side in the button name"<br>`tests/state/app-store-split.test.ts` "undoes and redoes edits to both sides in order" | — |
| `AC-F11.11` Presets on the edited side | `tests/e2e/split-sides.spec.ts` "AC-F11.11: presets apply to and save from the side being edited" | — |
| `AC-F11.12` Side A and selections survive reload | `tests/e2e/split-sides.spec.ts` "AC-F11.12: side A, both selections and the edited side survive a reload" | — |
| `AC-F11.13` Pixel alignment under zoom and pan | `tests/e2e/split-sides.spec.ts` "AC-F11.13: two sides with the same stack stay pixel-aligned while zoomed and panned" | `M6` |
| `AC-F11.14` No second worker without side A | `tests/e2e/split-sides.spec.ts` "AC-F11.14: a second preview worker exists only while a non-empty side A is shown"<br>`tests/state/app-store-split.test.ts` "creates no side A renderer while side A is empty or the split is off" | — |
| `AC-F12.8` File-size limit, missed target, EXIF, cancel | `tests/e2e/export.spec.ts` "AC-F12.8 & AC-F12.9: size-limited export fits within target and persists limit"<br>`tests/e2e/avif.spec.ts` "AVIF export has the right header, size and no metadata, with a size limit too (AC-F21.5)"<br>`src/codec/encode.test.ts` "binary-searches JPEG quality to fit within maxBytes without scaling when possible"<br>`src/codec/encode.test.ts` "scales PNG dimensions down to fit within maxBytes and reports targetMet"<br>`src/codec/encode.test.ts` "reports targetMet: false when even minimum size exceeds maxBytes"<br>`src/codec/encode.test.ts` "aborts size-limited encoding when isCancelled returns true"<br>`src/features/export/export-dialog.test.tsx` "AC-F12.8: reports a limit that the minimum size still exceeds"<br>The 1 s cancel time is measured without a limit only: `tests/e2e/export.spec.ts` "AC-F12.4: Cancel stops the export within 1 s @perf" | `M5` |
| `AC-F12.9` Limit saved per project | `tests/e2e/export.spec.ts` "AC-F12.9: a custom limit, a preset and Off are each restored after a reload"<br>`src/features/export/export-dialog.test.tsx` "persists file-size limit presets, shows PNG note, and displays export summary" | — |
| `AC-F12.10` Export side A or B | `tests/e2e/split-sides.spec.ts` "AC-F12.10: export offers a side only when side A has effects, and downloads the chosen one" | — |

## F20: geometry tools

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F20.1` Rotate updates canvas, export and library | `tests/e2e/transform-ui.spec.ts` "AC-F20.1: rotating 4000 x 3000 updates canvas, export and library, and survives reload, undo and redo"<br>`tests/e2e/geometry.spec.ts` "AC-F20.1: shows and exports a rotated 4000 x 3000 photo at 3000 x 4000"<br>`tests/worker/preview-worker.test.ts` "AC-F20.1: rotates a 4000 x 3000 source to 3000 x 4000 and leaves the file alone"<br>`src/features/library/library-screen.test.tsx` "shows the size after the geometry transform (AC-F20.1)" | `M1` |
| `AC-F20.2` Two flips or four turns are identity | `tests/e2e/transform-ui.spec.ts` "AC-F20.2: two flips or four rotations give pixel-identical output"<br>`tests/engine/transform.test.ts` "returns the original after four 90 degree rotations (AC-F20.2)"<br>`tests/engine/transform.test.ts` "returns the original after flipping twice (AC-F20.2)" | — |
| `AC-F20.3` Aspect ratios, Apply, reset | `tests/e2e/transform-ui.spec.ts` "AC-F20.3: ratios start centred boxes, Apply saves once, and reset restores the image" | `M1` |
| `AC-F20.4` Resize and limits | `tests/e2e/transform-ui.spec.ts` "AC-F20.4: resize by percent keeps the ratio, and sizes over the limits are refused"<br>`tests/engine/transform.test.ts` "halves 2000x1000 to 1000x500 (AC-F20.4)"<br>`tests/engine/transform.test.ts` "caps each side at 16,384 and the area at 50 MP" | — |
| `AC-F20.5` Export size after crop | `tests/e2e/transform-ui.spec.ts` "AC-F20.5: a 1200 x 800 crop made in the panel exports at full and half size"<br>`tests/e2e/geometry.spec.ts` "AC-F20.5: a 1200 x 800 crop exports at 1200 x 800 and 600 x 400"<br>`tests/worker/export-worker.test.ts` "AC-F20.5: a 1200 x 800 crop exports at 1200 x 800 and at 1/2 as 600 x 400" | — |
| `AC-F20.6` Presets keep geometry | `tests/e2e/transform-ui.spec.ts` "AC-F20.6: applying a preset leaves crop, rotation, flip and resize in place"<br>`tests/state/app-store-transform.test.ts` "AC-F20.6: applying or adding a preset keeps the geometry" | — |
| `AC-F20.7` Keyboard alone | `tests/e2e/transform-ui.spec.ts` "AC-F20.7: every geometry control works from the keyboard alone" | — |
| Crop mode: a saved change ends a held drag (`F20` text) | `tests/e2e/transform-ui.spec.ts` "undoing a rotate while holding a crop handle ends the drag and keeps the box on the image"<br>`tests/e2e/transform-ui.spec.ts` "undoing a rotate while holding the crop body ends the drag and keeps the box on the image" | — |

## F21: extended image formats

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F21.1` 8-bit and 16-bit TIFF import | `tests/e2e/tiff-bmp.spec.ts` "a 8-bit RGB TIFF imports upright at its exact size (AC-F21.1)"<br>`tests/e2e/tiff-bmp.spec.ts` "a 16-bit big-endian TIFF imports upright at its exact size (AC-F21.1)"<br>`tests/e2e/tiff-bmp.spec.ts` "a quarter-turned TIFF imports upright at its exact size (AC-F21.1)"<br>`src/codec/tiff.test.ts` "keeps the high byte of 16-bit samples (little endian: %s)" | `M2` |
| `AC-F21.2` SVG at 2048 × 1024, no requests | `tests/e2e/import-svg.spec.ts` "a viewBox-only SVG imports at 2048 × 1024 and requests nothing it references (AC-F21.2)"<br>`tests/e2e/import-svg.spec.ts` "importing a second SVG from the open editor requests nothing it references (AC-F21.2)"<br>`src/features/import/rasterize-svg.test.ts` "scales a viewBox-only SVG to 2,048 px on its longest side" | — |
| `AC-F21.3` Animated GIF first frame and notice | `tests/e2e/import-formats.spec.ts` "loop.gif imports frame 0 and shows the first-frame notice (AC-F21.3)"<br>`tests/e2e/import-formats.spec.ts` "loop.avif imports frame 0 and shows the first-frame notice (AC-F21.3)"<br>`src/codec/format.test.ts` "finds a second GIF frame beyond the first read chunk" | — |
| `AC-F21.4` HEIC and RAW refusals | `tests/e2e/import-formats.spec.ts` "dropping phone.heic creates no project and names the format (AC-F21.4)"<br>`tests/e2e/import-formats.spec.ts` "dropping studio.dng creates no project and names the format (AC-F21.4)"<br>`tests/e2e/import-formats.spec.ts` "dropping canon.cr2 creates no project and names the format (AC-F21.4)" | `M2` |
| `AC-F21.5` AVIF, BMP, TIFF export | `tests/e2e/avif.spec.ts` "AVIF export has the right header, size and no metadata, with a size limit too (AC-F21.5)"<br>`tests/e2e/tiff-bmp.spec.ts` "BMP and TIFF exports have the right header, size and no metadata (AC-F21.5)" | `M3` |
| `AC-F21.6` Lazy chunks, offline export | `tests/e2e/avif.spec.ts` "stays unloaded until an AVIF export"<br>`tests/e2e/tiff-bmp.spec.ts` "stays unloaded until TIFF export is selected"<br>`tests/e2e/tiff-bmp.spec.ts` "loads when a TIFF is imported"<br>`tests/e2e/avif.spec.ts` "AVIF export works offline once the app is precached (AC-F21.6)"<br>`tests/e2e/tiff-bmp.spec.ts` "TIFF export works offline once the app is precached (AC-F21.6)" | — |

## F22: expanded effect catalogue

`v0.2.0` implements `sliceShift`, `channelSwap`, `blockShuffle`, `scanlineWave` and `posterize`. The tests below loop over the effect registry, so they also cover `pixelSort`, `channelShift` and any effect added later.

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F22.1` Registry, picker, generated controls | `tests/e2e/acceptance.spec.ts` "AC-F22.1: Add effect offers every registered effect and builds its controls from the schema"<br>`src/features/stack/stack-panel.test.tsx` "lists every registered effect with its label and description and appends the chosen one" | `M4` |
| `AC-F22.2` Contract suite and golden images | `tests/engine/effect-contract.test.ts` "never writes to its input", "produces identical output for identical inputs", "renders 1x1, 1xN, Nx1, and odd sizes without error", "returns input unchanged when mix is 0"<br>`tests/golden/golden.test.ts` "covers every registered effect in tests/golden/<type>/ (AC-F22.2)"<br>`tests/e2e/golden.spec.ts` "every golden case produces the exact Node golden hash in Chromium and Firefox" | — |
| `AC-F22.3` `vhs-split` and `tile-scramble` presets | `tests/presets/builtin.test.ts` "defines the eight presets with unique ids"<br>`tests/presets/builtin.test.ts` "gives vhs-split and tile-scramble the instances and values of the spec table"<br>`tests/presets/builtin.test.ts` "applying each preset to gradient-64x48 runs without error or warnings and changes the image" | `M4` |

## F23: project history panel

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F23.1` Newest first, current step | `tests/e2e/history.spec.ts` "AC-F23.1: lists Initial plus 5 commits newest first and marks the current step" | — |
| `AC-F23.2` Jump keeps view and redo entries | `tests/e2e/history.spec.ts` "AC-F23.2 AC-F23.3: a jump keeps the view and the later entries until a new commit replaces them"<br>Geometry follows the jump: `tests/e2e/acceptance.spec.ts` "F20, F22, F23: a history jump restores geometry and effects, and survives reload and export"<br>`tests/storage/geometry.test.ts` "snapshots the transform per commit, keeps it when omitted, and restores it on undo, redo and jump" | — |
| `AC-F23.3` New commit replaces later entries | `tests/e2e/history.spec.ts` "AC-F23.2 AC-F23.3: a jump keeps the view and the later entries until a new commit replaces them" | — |
| `AC-F23.4` Reload restores list and position | `tests/e2e/history.spec.ts` "AC-F23.4: reload restores the full list and the current position" | — |
| `AC-F23.5` 201 entries after 205 commits | `tests/e2e/history.spec.ts` "AC-F23.5: after 205 commits the panel shows 201 entries" | — |
| `AC-F23.6` Keyboard and three viewports | `tests/e2e/history.spec.ts` "AC-F23.6: keyboard jumps at phone in light without overflow or a11y violations @a11y" (also `tablet` and `desktop`, `light` and `dark`) | — |

## F24: app changelog

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F24.1` Offline "View changelog" | `tests/e2e/settings.spec.ts` "AC-F24.1 & AC-F24.2: expands the CHANGELOG.md release notes offline with zero network requests"<br>`src/features/settings/settings.test.tsx` "AC-F24.1: expands and collapses the bundled release notes" | `M7` |
| `AC-F24.2` Bundled from `CHANGELOG.md` | `scripts/changelog.test.ts` "matches the root CHANGELOG.md"<br>`tests/e2e/settings.spec.ts` "AC-F24.1 & AC-F24.2: expands the CHANGELOG.md release notes offline with zero network requests" | `M7` |

## F27: in-app guide and welcome card

| Criterion | Automated coverage | Manual |
|---|---|---|
| `AC-F27.1` App bar button and back | `tests/e2e/guide.spec.ts` "the app bar button opens the guide from the library and the editor (AC-F27.1)" | — |
| `AC-F27.2` `?` key and its exceptions | `tests/e2e/guide.spec.ts` "? opens the guide, but not while typing or with a dialog open (AC-F27.2)"<br>`src/features/guide/content.test.ts` "opens the guide on a bare question mark only" | — |
| `AC-F27.3` Settings link | `tests/e2e/guide.spec.ts` "Settings links to the guide and closes (AC-F27.3)" | — |
| `AC-F27.4` Every effect and parameter listed | `src/features/guide/effects-reference.test.tsx` "lists every registered effect with every parameter label" | `M8` |
| `AC-F27.5` Contents list per width | `tests/e2e/guide.spec.ts` "the contents list stays beside the text on desktop and moves focus (AC-F27.5)"<br>`tests/e2e/guide.spec.ts` "the contents list collapses at phone width (AC-F27.5)"<br>`tests/e2e/guide.spec.ts` "the contents list collapses at tablet width (AC-F27.5)" | — |
| `AC-F27.6` Offline, same origin | `tests/e2e/guide.spec.ts` "#/guide loads offline with no external request (AC-F27.6)" | — |
| `AC-F27.7` Welcome card once | `tests/e2e/guide.spec.ts` "the welcome card appears once and stays dismissed after reload (AC-F27.7)"<br>`tests/state/app-store-guide.test.ts` "dismisses the welcome card on the first import" | — |
| `AC-F27.8` axe and no horizontal scroll | `tests/e2e/guide.spec.ts` "@a11y guide and welcome card are clean in light at 390x844 (AC-F27.8)" (also `820x1180` and `1440x900`, `light` and `dark`) | — |

## Manual desktop checklist

Run on desktop Chrome or Edge 120+ and Firefox 128+ against the production build (`vp run gui`, then `http://localhost:4173`). Record the tester, browser version, date and result for each item. None has been run for this document.

| ID | Steps | Pass when |
|---|---|---|
| `M1` | Import a real portrait photo from a phone. Open Transform, rotate, flip, drag the crop box and a corner handle with the mouse, apply, then resize to 50%. | The box follows the pointer without lag, the result is upright and sharp, and the library card shows the new size. |
| `M2` | Import a 16-bit TIFF saved by a photo editor, then drop a real iPhone `.heic` and a real camera RAW file. | The TIFF looks like the original. Each refused file shows its message and adds no project. |
| `M3` | Export a 12 MP photo as AVIF, BMP and TIFF and open each file in a second application. Press Cancel during one AVIF export. | Each file opens at the chosen size. Cancel stops the export and saves no file. |
| `M4` | On a real photo, add each of Slice shift, Channel swap, Block shuffle, Scanline wave and Posterize, move their controls, then apply the VHS split and Tile scramble presets. | Each effect visibly does what its description says, and the preview matches the exported PNG. |
| `M5` | Turn on a 500 KB limit for a 12 MP PNG export, start it and press Cancel. Run it again to the end. | Cancel stops within 1 s and saves no file. The finished file is at or below 500 KB. |
| `M6` | Put different effects on sides A and B, switch between left/right and top/bottom, zoom to 200% and drag the divider across an edge in the photo. | No seam or offset shows at the divider in either orientation. |
| `M7` | Open Settings, then About, then View changelog. After the owner publishes the release, check the version and link shown there against the GitHub release. | The `v0.2.0` notes are first and read correctly. |
| `M8` | Read the Guide from top to bottom and try each keyboard shortcut it lists. | The text matches what the app does. |
