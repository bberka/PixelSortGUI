Written by Claude Opus 5.5 (Antigravity, thought level high), spec subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.
Updated after the engine tasks by Gemini 4 Neon (Antigravity, thought level low), documentation subagent.
Updated with post-v0.1.0 specs (F20 to F24) by Gemini 4 Neon (Antigravity, thought level medium), specification subagent.
Updated with project files (F25), full backup and restore (F17), and multi-image blending (F26) specs by Gemini 4 Neon (Antigravity, thought level medium), specification subagent.

# Drift product spec

Status: settled for first release, 2026-11-24. Companion specs: [engine.md](engine.md), [persistence.md](persistence.md), [../../DESIGN.md](../../DESIGN.md), [roadmap.md](roadmap.md), [decisions.md](decisions.md).

## 1. Purpose and users

Drift is an editor for pixel sorting and glitch effects on still photos. It runs in a browser, works offline, has no accounts and no server, and keeps every image and setting in the browser's own storage on the device.

Primary user: the owner, a person making glitch art from his own photos. Secondary users: anyone who opens the hosted static site. Assume one person per browser profile. There is no sharing, sync or collaboration. First-release acceptance targets desktop browsers; layouts stay responsive at phone, tablet and desktop widths for a later mobile port.

What the user wants from it, in order:

1. Open a photo and get a pixel-sorted result within seconds, without reading documentation.
2. Tune the effect with immediate visual feedback.
3. Close the app at any point and find everything as it was when it is opened again.
4. Export a full-resolution file.

## 2. Terms

These names are used in all six spec files and should be used in code, UI copy and tests.

| Term | Meaning |
|---|---|
| Library | The list of all projects stored in this browser profile. |
| Project | One source image plus its effect stack, history, view state and export settings. |
| Source image | The original file bytes as imported. Never modified. |
| Effect type | A registered effect definition, for example `pixelSort`. Identified by a stable string `type` and an integer `version`. |
| Effect instance | One entry in a project's effect stack: an effect type with its own parameter values, enabled flag, mix and blend mode. |
| Effect stack | The ordered list of effect instances applied top to bottom to the source image. |
| Parameter | One typed, named value of an effect instance, declared by the effect type's parameter schema. |
| Preset | A named, saved list of effect instances. Built-in presets ship with the app and are read-only; user presets are stored. |
| Commit | A completed change to the effect stack that creates one history entry (for example releasing a slider). |
| History | The per-project list of committed effect stack snapshots used for undo and redo. |
| Render level | The resolution at which the pipeline runs: `drag` (while a control is moving), `settle` (after it stops), `full` (source resolution). |
| Proxy | The downscaled copy of the source image used for the `drag` and `settle` levels. |
| Compare | Showing the source image instead of, or beside, the result. Two modes: toggle (with hold) and split. |
| Export | Writing the result at a chosen size and format to a file the user keeps. |
| Line, run, interval | Pixel sort terms defined in [engine.md](engine.md#5-pixel-sort-effect-pixelsort). |

## 3. Core loop

1. **Open.** The user picks one or more image files (file picker or drag and drop). Each file becomes a project in the library, and the editor opens the first one.
2. **Pick effects.** The user applies a preset or adds effect instances to the stack. A new project starts with an empty stack and shows the source image.
3. **Tune.** The user selects an instance and moves its parameter controls. The preview updates while dragging (`drag` level) and sharpens when the control stops (`settle` level). Undo and redo step through commits.
4. **Compare.** The user toggles or holds Compare, or turns on the split view, to see the source beside the result.
5. **Export.** The user picks format, quality and size, and downloads or shares the file. The project stays in the library with its stack, so the user can come back and change it.

The library screen is the home screen. The editor screen shows one project at a time.

## 4. Platforms and support

- **Accepted browsers (desktop and laptop only):** Chromium-based browsers (Chrome and Edge 120 and later) and Firefox (128 and later).
- **Best effort:** Safari on any platform is best effort — nothing may be built that knowingly breaks it, but it is not tested and not an acceptance target. Phones and tablets are not acceptance targets in the first release.
- Requires a secure context: `https://` or `http://localhost`. On plain `http://` over a LAN address the app shows an error screen that says to use HTTPS or localhost, because IndexedDB persistence requests, the service worker, `crypto.randomUUID` and `crypto.subtle` need it.
- Viewport classes, used throughout the specs and defined in [DESIGN.md](../../DESIGN.md#6-layout):
  - phone: viewport width below 640 CSS px, or height below 500 CSS px in landscape;
  - tablet: 640 to 1023 CSS px wide;
  - desktop: 1024 CSS px and wider.
  All three layouts are built and checked at `390 × 844`, `820 × 1180`, and `1440 × 900` in a desktop browser so a later port needs no layout rework. Checking phone and tablet widths in a desktop browser tests layout only and does not reproduce mobile canvas, memory, or storage limits.
- `vp run dev` starts the Vite dev server with hot reload. `vp run gui` builds the production app and serves it locally at `http://localhost:4173`, so the service worker and offline behaviour can be checked.
- Built output is a static folder (`dist/`) hosted on GitHub Pages on the custom domain `drift.bbay.dev`. The build must work when served from the domain root (`/`), and the published output includes a `CNAME` file containing `drift.bbay.dev`.

Image size limits for the first release:

| Limit | Value |
|---|---|
| Accepted input formats | Whatever the browser decodes with `createImageBitmap`: JPEG, PNG, WebP, GIF (first frame), BMP, AVIF in the accepted desktop browsers. The app bundles no extra decoders. |
| Longest side | 16,384 px. Larger files are rejected with a message. |
| Area | 50 MP (50,000,000 px) is the guaranteed maximum on the accepted desktop browsers. Larger images within the longest-side and file-size limits are offered a downscaled import: "Import at 50 MP" (stores a downscaled copy as the source image) or "Import anyway" (best effort: the image is stored at its original size, and preview or export may fail with an out-of-memory error, which is shown as an error message and leaves the project intact). |
| File size | 200 MB per file (209,715,200 bytes). |

## 5. First release: must-have features

Each feature has an ID (`F1` to `F16`, `F18`, `F19`; `F17` is moved to section 6 Later, and IDs are not renumbered) used by the roadmap. Acceptance criteria are numbered `AC-<feature>.<n>` and are written so a tester can check them by hand or in Playwright on the accepted desktop browsers. Layout criteria under `F18` apply to all three viewport classes checked in a desktop browser.

### F1. Import images

The user adds images through a file picker (multiple selection allowed) or by dropping files on the library or editor. Each accepted file becomes a new project named after the file without its extension. If the same file bytes were imported before (same SHA-256), the new project reuses the stored source image instead of storing a second copy.

- AC-F1.1: Activating "Open images" opens the system file picker filtered to images; choosing 3 JPEG files creates 3 projects in the library, and the editor opens the first chosen file.
- AC-F1.2: Dropping a PNG file on the library screen (desktop) creates one project and opens it.
- AC-F1.3: A file the browser cannot decode (for example a `.txt` renamed to `.jpg`) creates no project and shows the error "Can't open <file name>: the browser can't read this image format."
- AC-F1.4: A 20,000 × 1,000 px image is rejected with "Image too large: the longest side is 20,000 px; the limit is 16,384 px."
- AC-F1.5: Importing an image larger than 50 MP (for example 60 MP) within the longest-side and file-size limits shows a dialog with "Import at 50 MP" and "Import anyway"; choosing the first creates a project whose source image is at most 50,000,000 px and keeps the aspect ratio within 1 px.
- AC-F1.6: A JPEG with EXIF orientation 6 (rotated 90°) appears upright in the library thumbnail, in the editor and in the export.
- AC-F1.7: Importing the same file twice creates two projects; the second import grows the browser's storage usage estimate (the figure Settings shows) by less than 1% of the file size. Check it with a file of 2 MB or more: the new project's own records, such as its thumbnail, do not scale with the file and can exceed 1% of a small one. Offline-cache writes are not part of the import.

### F2. Library

The library screen lists every project as a card with a thumbnail of the current result, the project name, pixel dimensions and the last-opened date. Default order: most recently opened first. Each card has a menu with Open, Rename, Duplicate and Delete.

- AC-F2.1: With no projects, the library shows the empty state described in DESIGN.md (heading, "Open images" button, the note "Images stay on this device").
- AC-F2.2: Cards show the thumbnail of the result after the last commit, not of the source image, within 5 s of that commit.
- AC-F2.3: Rename accepts 1 to 120 characters, trims surrounding spaces, and the new name survives a reload.
- AC-F2.4: Duplicate creates a project named "<name> copy" with the same effect stack, the same history and its own view state; editing the copy does not change the original.
- AC-F2.5: Delete asks for confirmation ("Delete <name>? This removes it from this device."); after confirming, the card disappears, and if no other project uses the same source image, the storage usage drops by about the file size.
- AC-F2.6: With 100 projects, the library is scrollable without visible stutter on a reference laptop, and thumbnails that are off screen are not decoded until scrolled into view.
- AC-F2.7: Every card action is reachable with the keyboard alone (Tab to the card, Enter opens, the menu button opens the menu).

### F3. Session restore

Closing the tab, reloading or restarting the browser must not reset the app. On start the app restores the library, reopens the project that was open (if one was), and restores its effect stack, selected instance, history, zoom and pan, compare split position and export settings. Global settings (theme, compare mode) are restored too. The restore sequence is specified in [persistence.md](persistence.md#9-restore-sequence-on-startup).

- AC-F3.1: Open a project, add a pixel sort instance, change the angle to 90, wait 1 s, close the tab, reopen the app URL: the same project is open, the instance is selected and shows angle 90, and the preview matches what was shown before closing.
- AC-F3.2: After AC-F3.1, Undo restores the stack from before the angle change.
- AC-F3.3: Zoom to 200% and pan to a corner, reload: the same zoom and centre are restored within 1 source px.
- AC-F3.4: Return to the library, reload: the library is shown, not the editor.
- AC-F3.5: Reloading with the URL `#/p/<id>` of a deleted project shows the library and the message "That project no longer exists."
- AC-F3.6: A change committed less than 300 ms before the tab is killed may be lost; a change committed 1 s or more before is never lost.
- AC-F3.7: With 50 projects stored, the library (or the reopened project's source image placeholder) is visible within 1 s of navigation start on a reference laptop.

### F4. Effect stack

The stack lists the project's effect instances top to bottom in the order they are applied. The user can add an instance (from a list of effect types), select it, remove it, duplicate it, reorder it (drag and keyboard), and switch it on or off. At most 32 instances per stack.

- AC-F4.1: "Add effect" lists the two first-release effect types (`pixelSort` and `channelShift`) with their labels and one-line descriptions; choosing one appends an instance with default parameters and selects it.
- AC-F4.2: Switching an instance off removes its effect from the preview within the visible-update budget (engine.md section 9) and shows the instance as off with both an icon and the text "Off".
- AC-F4.3: Reordering by drag (pointer) and by "Move up" / "Move down" in the instance menu (keyboard: Alt+Up / Alt+Down) changes the rendering order; each reorder is one commit.
- AC-F4.4: Duplicate inserts a copy directly below with the same parameters and seed, so the preview with both enabled equals applying the effect twice.
- AC-F4.5: Remove deletes the instance as one commit; Undo restores it at the same position with the same parameters.
- AC-F4.6: An instance whose effect type is unknown to this app version (for example from a newer version) is shown as "Unsupported effect (<type> v<version>)", is skipped when rendering, and is kept unchanged when the project is saved.
- AC-F4.7: Every instance's parameter panel has a Mix control (0 to 100%, step 1%, default 100%) and a Blend control with the options Normal, Lighten, Darken and Difference (default Normal). Changing either updates the preview within the visible-update budget (engine.md section 9) and creates one commit; Undo restores the previous value.
- AC-F4.8: With one instance in the stack and Mix at 0%, the preview and the export are pixel-identical to the same project with the instance switched off, for every Blend option.
- AC-F4.9: With Blend Normal, let `i` be a pixel channel of the export with the instance off, `f` the same channel of the export at Mix 100%, and `m` the Mix percentage. At Mix 50% every R, G, B and A channel of the export equals `floor((2 * (i * (100 - m) + f * m) + 100) / 200)` (engine.md section 4.5).
- AC-F4.10: At Mix 100%, with `i` and `f` as in AC-F4.9, the R, G and B channels of the export equal `max(i, f)` for Lighten, `min(i, f)` for Darken and `abs(i - f)` for Difference. The A channel equals `f` in all four modes.

### F5. Parameter controls

Selecting an instance shows its parameters, generated from the effect type's parameter schema (engine.md section 3). Number parameters have a slider plus a numeric field for exact entry; enums use a segmented toggle (up to 4 options) or a select (more); booleans use a switch; ranges use a two-thumb slider with two numeric fields; angles use an angle dial with snap points and a numeric field; seeds use a numeric field and a "New seed" button. Parameters whose `visibleWhen` condition is false are hidden. Each parameter has a "Reset to default" action, and the instance has "Reset all".

The panel header also has a "Randomize" button (dice icon) that gives every parameter of the selected instance a random valid value, so the user can explore looks quickly. Randomize is schema-driven: it reads only each parameter's `ParamSpec` (engine.md section 3) and names no effect or parameter, so an effect added later works with no extra code.

- A `number` is drawn uniformly from the multiples of its step between `min` and `max`; an `integer` the same with step 1.
- An `angle` is drawn uniformly from the 3600 values `0.0` to `359.9` (step 0.1). Snap points only guide dragging and are not used.
- A `range` is two such draws, stored low then high. The range control has no minimum gap between its thumbs, so none is enforced.
- An `enum` is drawn uniformly from its options and a `boolean` is true with probability one half.
- A `seed` is a new uint32, like the one "New seed" writes.
- Parameters hidden by `visibleWhen` are randomized too, because they keep their values and reach `render` (engine.md section 3); they are ready when a later change reveals them. Every combination of values the schema allows is valid, so nothing is restricted.
- Randomize leaves the instance's Mix, Blend and on/off state, "Show selection", the other instances and the stack order unchanged.
- The button is disabled when no effect is selected (the panel then shows its "No effect selected" note beside the disabled button) or the selected effect has no parameters. Activating it announces "Randomized <effect label>". On a phone-width layout it shows the icon only; the tooltip and accessible name stay "Randomize".
- The random numbers come from `crypto.getRandomValues` in the app and from an injected source in tests. They only choose the stored values; rendering stays deterministic for the stored values.

- AC-F5.1: Typing 37.5 into the angle field and pressing Enter sets the angle to 37.5 and creates one commit.
- AC-F5.2: Typing a value outside the range (for example 400 for a 0 to 1 slider) clamps it to the nearest limit and shows the clamped value.
- AC-F5.3: Dragging a slider for 3 s creates exactly one commit, on release.
- AC-F5.4: With keyboard focus on a slider, Arrow keys change the value by one step and Shift+Arrow by ten steps; a burst of key presses with no gap over 500 ms creates one commit.
- AC-F5.5: Setting pixel sort `intervalMode` to `edges` hides the threshold range and shows the edge threshold and edge blur controls.
- AC-F5.6: Every control has a visible label, its current value with unit (for example "120 px", "45°", "0.25"), and an accessible name equal to the label.

- AC-F5.7: The parameter panel header shows a "Randomize" button with a dice icon beside "Reset all". It has the accessible name "Randomize" and a tooltip, is reachable by Tab, and Enter and Space activate it.
- AC-F5.8: One activation creates exactly one history entry labelled "Randomize <effect label>", so the Undo button reads "Undo Randomize <effect label>". One Undo restores every parameter to its previous value, and Redo reapplies the random values.
- AC-F5.9: Every randomized value is valid for its `ParamSpec`: within `min` and `max`, a multiple of the step (integers stay integers), a range with low at most high, an enum option, a boolean, a uint32 seed, an angle in [0, 360) on the 0.1 step. For one random source the result is the same every time, and it is unchanged by `validateParams`.
- AC-F5.10: Randomize changes the instance's parameters only: Mix, Blend, the enabled state, "Show selection" and every other instance are unchanged, and parameters hidden by `visibleWhen` are randomized too.
- AC-F5.11: Randomize is disabled when no effect is selected or the effect has no parameters. After a click the live region says "Randomized <effect label>".
- AC-F5.12: On a pixel sort instance, Randomize changes at least one displayed value and the rendered canvas, creates one history entry, and Undo restores the exact previous values. At 390 px width the header shows both buttons without horizontal overflow, and the page has no accessibility violations.

### F6. Pixel sort effect

The `pixelSort` effect type with every parameter listed in [engine.md section 5](engine.md#5-pixel-sort-effect-pixelsort): angle, interval mode (threshold, edges, whole line), selection key, threshold range, edge threshold, edge blur, invert, maximum interval length, length jitter, skip chance, sort key, order (ascending, descending, shuffle, random), discretize, fill (sort, average, gradient) and seed. The instance panel has a "Show selection" switch that, while on, renders this instance's selection instead of its result: selected pixels unchanged, unselected pixels darkened to 25% brightness.

- AC-F6.1: On a synthetic gradient test image generated in code by `tests/fixtures/synthetic.ts` (engine.md section 14.2; no photo file is committed) and imported into the app by the test, adding a pixel sort instance with defaults produces visible horizontal streaks within the visible-update budget.
- AC-F6.2: Setting the angle to 90 makes the streaks vertical; 45 makes them diagonal from lower left to upper right; the result contains no blurred pixels (every output pixel colour exists in the instance's input at the same render level when `fill` is `sort`), checked by the engine property tests.
- AC-F6.3: With threshold range 0 to 1, `invert` off and `intervalMode` threshold, every pixel with alpha above 0 is selected ("Show selection" shows no darkened pixels).
- AC-F6.4: Changing only the seed changes the result when `order` is `shuffle` or `random`, or when `lengthJitter` or `skipChance` is above 0, and leaves it unchanged otherwise.
- AC-F6.5: Exporting the same project twice gives byte-identical image data (compare decoded pixels of two PNG exports).
- AC-F6.6: "Show selection" affects only the preview: exports never include the selection view, and turning it off restores the normal result.

### F7. Glitch effects

One additional effect type in the first release, specified in [engine.md section 6](engine.md#6-other-first-release-effects): `channelShift` (offset R, G and B separately). (`sliceShift`, `blockShuffle` and `channelSwap` are deferred to section 6 Later.)

- AC-F7.1: `channelShift` can be added, tuned and exported, and has golden-image tests that pass in CI.

### F8. Live preview and full-resolution view

The editor renders the stack at the `drag` level while a control moves and at the `settle` level when it stops, cancelling stale renders. When the user zooms in past the `settle` proxy's resolution, the app renders the `full` level in the background and swaps it in. Rules and budgets are in [engine.md sections 8 and 9](engine.md#8-preview-strategy).

- AC-F8.1: Dragging a pixel sort threshold thumb continuously for 5 s on a 12 MP project keeps the UI responsive (the thumb follows the pointer; no long task over 50 ms on the main thread in a performance trace) and the preview updates at least 5 times per second on a reference laptop.
- AC-F8.2: After the control stops, the `settle` result is shown within 300 ms on a reference laptop (12 MP source, one pixel sort instance).
- AC-F8.3: While a render takes more than 300 ms, a thin progress bar shows at the top of the canvas; it disappears when the render finishes or is cancelled.
- AC-F8.4: Zooming to 200% on a 12 MP project shows a "Rendering full resolution" indicator and, within 3 s on a reference laptop, a sharp image whose pixels match the export at 100% size.
- AC-F8.5: Changing a parameter during a `full` render cancels it; the indicator disappears and no stale image is shown.

### F9. Undo and redo

Every commit (parameter change, add, remove, reorder, enable or disable, preset apply, reset) creates one history entry with a label. Undo and redo move through the entries; a new commit after undo discards the redo entries. History is stored with the project and survives restarts; it holds up to 200 entries per project, dropping the oldest.

- AC-F9.1: Ctrl+Z / Cmd+Z undoes and Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y redoes; the toolbar buttons do the same and are disabled when nothing can be undone or redone.
- AC-F9.2: The undo button's tooltip and accessible name include the entry label, for example "Undo Angle 90°" (label formats: [persistence.md section 8.2](persistence.md#82-history-jump-and-rich-action-labels-f23)).
- AC-F9.3: After 205 commits, 200 undos are possible and the 201st is not.
- AC-F9.4: Undo and redo do not change zoom, pan, selection of the library or theme.
- AC-F9.5: Undo history is restored after a reload (see AC-F3.2).

### F10. Presets

The preset list shows built-in presets first (the eight listed in [engine.md section 7](engine.md#7-built-in-presets)), then user presets by name. Applying a preset replaces the stack (one commit). When the stack already has effects, a confirmation asks first: "Replace current effects?", with the number of effects that will be removed and a note that the change can be undone. Cancel changes nothing and adds no history entry. With an empty stack the preset applies immediately. "Add to stack" appends the preset's instances instead. "Save as preset" stores the current stack under a name. User presets can be renamed and deleted. Presets are global, not per project.

- AC-F10.1: Applying "ASDF classic" to a project with an empty stack yields two pixel sort instances (angle 270, then angle 0) and a visible result.
- AC-F10.2: Saving a stack as "Mine", then applying "Mine" to another project, reproduces the same parameters and seeds.
- AC-F10.3: Built-in presets cannot be renamed or deleted (the actions are absent).
- AC-F10.4: User presets survive a reload.
- AC-F10.5: Applying a preset to a project with one or more effects opens a confirmation (`Replace current effects?`, `Applying "<name>" removes the <n> effect(s) in this project. You can undo this.`, buttons `Cancel` and `Replace`). Cancel and Escape leave the stack and history unchanged; Replace applies the preset as one history entry. An empty stack and "Add to stack" never ask. On phone widths the confirmation opens over the Presets dialog, and undo and redo shortcuts stay inactive while it is open.

### F11. Compare

The Compare button toggles between the result and the source image (keyboard: `\` toggles; holding the button with a pointer or holding `\` for more than 300 ms shows the source only while held). The split view (toolbar toggle or `S`) shows the source on the left and the result on the right of a draggable divider.

- AC-F11.1: Clicking Compare shows the source and labels the canvas "Original"; clicking again shows the result.
- AC-F11.2: Pressing and holding Compare for 1 s and releasing returns to the result.
- AC-F11.3: In split view, dragging the divider moves it; with the divider focused, Left and Right move it by 1% and Shift+Left/Right by 10%; its position is restored after reload.
- AC-F11.4: Compare and split work while zoomed and panned, with both sides aligned to the same pixels.

### F12. Export

The export dialog offers format (PNG, JPEG, WebP only where the browser's native encoder produces WebP, BMP, and TIFF), quality for JPEG and WebP (50 to 100, default 92, divided by 100 for the encoder), size (Full, 1/2, 1/4, or a custom longest side, never larger than the source), an optional output file-size limit (Off by default, or a target maximum size in KB/MB with quick presets — 500 KB, 1 MB, 2 MB, 5 MB, 10 MB — plus a custom value clamped to 10 KB–100 MB), and the file name (default `<project name>-<YYYYMMDD-HHmmss>.<ext>`). Transparent pixels are flattened onto white for JPEG. A PNG with partial transparency does not round-trip exactly because browsers premultiply alpha in a 2D canvas (opaque images are exact); exact decoding of such images is later work.

When a file-size limit is active:
- For JPEG and WebP, the encoder first encodes at the requested dimensions and quality; if the output exceeds the target, it binary-searches quality down to a minimum of 10, and if still over the limit, progressively scales down dimensions until the output fits (or reaches the minimum side of 64 px).
- For PNG, BMP and TIFF (lossless), the encoder scales down dimensions to fit, and the dialog shows a brief helper note explaining that the chosen format scales dimensions to fit and JPEG or WebP compress more tightly.
- When export finishes, the dialog displays the final exported file size along with any adjusted dimensions or quality (and a gentle notice if even the minimum size exceeded the target).
- The file-size limit is persisted per project alongside the other export settings.

Export renders at the chosen size in a separate worker with a progress bar and Cancel. On browsers that support sharing files (`navigator.canShare({files})`), a Share button is shown next to Download. Exported files carry no EXIF, GPS or ICC metadata and are sRGB.

- AC-F12.1: Exporting a 12 MP project as PNG at Full size downloads a PNG of exactly the source dimensions within 5 s on a reference laptop.
- AC-F12.2: WebP appears in the format list only when the startup `convertToBlob` probe confirms the browser encodes WebP (offered in Chrome, Edge and Firefox).
- AC-F12.3: Exporting a 4001 × 3001 px project at 1/2 size produces a 2000 × 1500 px image (`floor(width × 0.5)` × `floor(height × 0.5)`, the render size rule in engine.md section 8), rendered at that size rather than resized after rendering.
- AC-F12.4: Cancel stops the export within 1 s and no file is written.
- AC-F12.6: The exported file has no EXIF block (checked with an EXIF reader).
- AC-F12.7: The export settings last used for a project are preselected the next time its export dialog opens.
- AC-F12.8: Exporting with a file-size limit produces a file whose byte size is at or below the chosen target (or reaches the 64 px minimum side and reports that the target could not be met) while preserving EXIF-free output and clean cancellation within 1 s.
- AC-F12.9: The chosen file-size limit (Off, preset, or custom) is persisted per project and restored the next time the export dialog opens.

### F13. Zoom and pan

The canvas supports fit-to-view, 100% (one image pixel per CSS pixel) and continuous zoom from 10% of fit up to 3200%. Pointer: drag pans, Ctrl/Cmd + wheel or trackpad pinch zooms around the pointer, plain wheel pans, double-click toggles fit and 100%. Touch: one finger pans, two-finger pinch zooms around the midpoint, double-tap toggles fit and 100%. Keyboard: `+` and `-` zoom by a factor of 2 around the centre, `0` fits, `1` shows 100%, Arrow keys pan by 10% of the viewport when the canvas has focus. Above 200% zoom, pixels are drawn without smoothing.

- AC-F13.1: Continuous wheel or trackpad zoom on a reference laptop runs at 60 frames per second on a `settle` proxy of 4 MP (measured in the browser performance panel; at most 3 dropped frames over 1 s of continuous zoom).
- AC-F13.2: The zoom percentage is shown in the canvas toolbar, and choosing it opens a menu with Fit, 50%, 100%, 200%, 400%.
- AC-F13.3: Panning cannot move the image entirely out of view: at least 64 CSS px of the image stays visible.

### F14. Themes

Two themes, light and true black (pure `#000000` background), plus "System" which follows the operating system setting. Default: System. The choice is made in Settings -> Appearance (the app bar has no theme button), applied before first paint on reload (no flash of the other theme). Tokens are in [DESIGN.md](../../DESIGN.md#2-themes-and-color-tokens).

- AC-F14.1: Switching the OS to dark mode while "System" is selected switches the app to the true black theme without a reload.
- AC-F14.2: Reloading with the light theme selected on a dark OS shows no dark frame before the light theme appears (checked with a screen recording at 60 fps).
- AC-F14.3: Every screen passes the automated contrast check (axe) in both themes.

### F15. Offline and install

The app is a progressive web app. After the first visit, it loads and works fully offline. Updates are downloaded in the background; when a new version is ready, a toast offers "Reload to update" and the app never reloads itself while the user is editing. On desktop Chromium, an "Install app" item appears in the menu when the browser offers installation.

- AC-F15.1: Load the app once, go offline (DevTools offline), reload: the library loads, a project opens, renders and exports.
- AC-F15.2: The built app makes no network request other than to its own origin (checked with the network panel over a full core loop).
- AC-F15.3: Deploying a new build while the app is open shows the update toast within 60 s of the next navigation or focus, and the app keeps running the old version until the user chooses Reload.

### F16. Storage status and warnings

Settings shows the storage used by the app and the browser's quota (from `navigator.storage.estimate()`) and whether storage is persistent. Quota-full and private-browsing behaviour is specified in [persistence.md sections 5 and 7](persistence.md#7-quota-and-what-the-user-is-told).

- AC-F16.1: Settings shows "Using <used> of <quota>" with values rounded to 0.1 GB or 1 MB.
- AC-F16.2: When an import does not fit in the remaining quota, no partial project is created and the "Storage is full" dialog appears with a "Manage library" button.
- AC-F16.4: When IndexedDB cannot be opened, the app still works for the current session and shows the persistent banner "Storage unavailable: nothing will be saved after you close this tab."

### F18. Responsive layouts (phone, tablet and desktop widths)

The editor and library adapt to the three viewport classes as specified in [DESIGN.md section 6](../../DESIGN.md#6-layout): below 640 px width (phone layout) parameters live in a bottom sheet over the canvas and the stack is a horizontal strip; at 640 to 1023 px (tablet layout) a docked bottom panel holds the stack and parameters side by side; at 1024 px and wider (desktop layout) a right sidebar holds both. Checked in a desktop browser at `390 × 844`, `820 × 1180`, and `1440 × 900` for layout only.

- AC-F18.1: At 390 × 844, 820 × 1180 and 1440 × 900 CSS px in a desktop browser, every screen lays out without horizontal page scrolling and no control is clipped or overlapped. This is a layout check only; features are accepted functionally at desktop width.
- AC-F18.2: Resizing the browser viewport across layout classes keeps the open project, selection and zoom.
- AC-F18.3: Interactive targets are at least 24 × 24 CSS px on desktop (`@media (pointer: fine)`) and at least 44 × 44 CSS px under `@media (pointer: coarse)`.

### F19. Accessibility baseline

WCAG 2.2 level AA for all UI outside the image itself. Details in [DESIGN.md section 10](../../DESIGN.md#10-accessibility).

- AC-F19.1: The full core loop (import through a hidden file input activated by keyboard, add effect, change parameters, undo, compare, export) can be completed with the keyboard alone.
- AC-F19.2: axe reports no violations on the library, editor, export dialog and settings screens in both themes at the three test viewports.
- AC-F19.3: Render state changes ("Rendering", "Rendered", "Export finished: <file name>") are announced through a polite live region.
- AC-F19.4: With `prefers-reduced-motion: reduce`, sheet and zoom animations are replaced by instant changes.

## 6. Next release (v0.2.0): specified features (F20 to F24)

These features were requested by the owner after the first-release scope was settled. They are specified in full here and in [engine.md](engine.md#16-next-release-v020-and-later), [persistence.md](persistence.md#8-next-release-v020-geometry-transforms-and-history-jump), and [DESIGN.md](../../DESIGN.md#72-post-v010-ui-specifications-f20-f23-f24) so implementation agents can build them after `v0.1.0` ships (see [roadmap.md](roadmap.md#milestone-7-post-v010-geometry-formats-effects-and-history-v020) for the schedule impact if any item is pulled into `v0.1.0`).

### F20. Geometry tools (crop, rotate, flip, resize)

Non-destructive source geometry applied before the effect stack. Original file bytes in the `sources` store are never modified; the project stores a `SourceTransform` record (rotation, horizontal/vertical flip, integer crop rectangle, and optional resize with resampling filter) that defines the **effective image** fed into the effect stack. "Cut" in the owner's request is specified here as crop; see [decisions.md D26 and Q11](decisions.md#d26-interpretation-of-cut-and-change-history-2026-11-25) for the alternative region-cutout reading.

- **Orientation:** Rotate 90° clockwise, rotate 90° counter-clockwise, flip horizontal, flip vertical. Stored as `rotation` (`0 | 90 | 180 | 270` degrees clockwise), `flipX`, and `flipY`.
- **Crop:** Free aspect ratio or fixed aspect ratios (`Original`, `1:1`, `4:3`, `3:2`, `16:9`, `9:16`, `4:5`), interactive on-canvas crop box with corner/edge handles and numeric `X`, `Y`, `Width`, `Height` fields in oriented source pixels. Exact rounding rules are in [engine.md section 16.3](engine.md#163-geometry-transforms-f20).
- **Resize:** Resize the cropped image by pixels (`Width`, `Height`) or by percentage (`1%` to `1000%`, rounded half away from zero), with aspect-ratio lock (on by default) and resampling filter choice (`Lanczos-3` default, `Bilinear`, `Nearest`). Output is capped at `16,384` px per side and `50,000,000` px (50 MP) total area (an image imported with "Import anyway" above 50 MP may always be resized downward, but never resized above the larger of 50 MP or its cropped pixel count).
- **Interaction with stack, compare, export, and history:** Effect parameters in pixels (`unit: 'px'`) keep their stored numbers and apply in effective-image pixels. Compare ("Original") and Split show the geometry-transformed image without effects so pixels align 1:1. Export size presets (`Full`, `1/2`, `1/4`, `Custom`) apply to effective dimensions. Each committed geometry action creates one history entry (storing both `transform` and `stack`).

Acceptance criteria:

- AC-F20.1: Rotating a 4000 × 3000 px project 90° clockwise updates effective dimensions to 3000 × 4000 px in the canvas, export dialog, and library card, leaves the stored `SourceRecord` blob unchanged, and creates one history commit; Undo restores 4000 × 3000 px.
- AC-F20.2: Flipping horizontal twice or rotating 90° four times returns pixel-identical output to the un-transformed image.
- AC-F20.3: Choosing aspect ratio `1:1` on a 4000 × 3000 px image initializes the crop box to `x: 500, y: 0, width: 3000, height: 3000`; choosing `16:9` initializes `x: 0, y: 375, width: 4000, height: 2250`. Applying the crop creates one commit and keeps the original bytes intact so resetting the crop restores 4000 × 3000 px.
- AC-F20.4: Resizing a 2000 × 1000 px image by 50% with aspect lock on produces 1000 × 500 px; entering width 20,000 px or dimensions exceeding 50,000,000 px is rejected with an inline error ("Maximum output size is 50 MP (50,000,000 px) and 16,384 px per side.") and does not commit.
- AC-F20.5: Exporting at `Full` size after cropping to 1200 × 800 px downloads a 1200 × 800 px file; exporting at `1/2` downloads 600 × 400 px.
- AC-F20.6: Applying a preset replaces only the effect stack and leaves the project's crop, rotation, flip, and resize intact.
- AC-F20.7: Every geometry control (rotate, flip, aspect ratio, numeric crop fields, resize width/height/percent, filter, apply, reset) is operable by keyboard alone.

### F21. Extended image formats

In `v0.1.0`, import decodes any format supported natively by `createImageBitmap` (`src/codec/decode.ts`: JPEG, PNG, WebP, GIF first frame, BMP, AVIF in Chrome/Edge 120+ and Firefox 128+), and export encodes PNG, JPEG, and probed WebP via `OffscreenCanvas.convertToBlob` (`src/codec/encode.ts`, `src/features/export/export-dialog.tsx`). Since `v0.1.0`, the first-frame notice, the HEIC/HEIF and RAW refusals, and the explicit AVIF, BMP, and GIF picker entries and tests listed below, SVG import, and TIFF import with BMP and TIFF export, have been implemented; the rest of this section has not.

Next-release additions (all bundled offline with MIT-compatible licences, zero runtime network calls; full browser support matrix and sources in [engine.md section 16.4](engine.md#164-extended-format-support-f21)):

- **Import additions:**
  - **TIFF (`.tif`, `.tiff`):** Decoded via bundled `utif2` (MIT, ~25 to 30 KB gzipped, lazy-loaded in the worker). Supports 8-bit and 16-bit (downconverted to 8-bit sRGB) grayscale, RGB, RGBA, paletted, uncompressed, LZW, PackBits, Deflate, and JPEG-compressed TIFFs. First page/IFD is imported.
  - **SVG (`.svg`):** Rasterised on the main thread via an `HTMLImageElement` drawn onto a canvas (scripts and external resources are blocked by the browser's SVG-as-image sandbox) into an RGBA PNG blob stored in `sources`, capped at 16,384 px per side and 50 MP. SVGs without explicit pixel dimensions default to scaling their `viewBox` to a longest side of 2,048 px, and larger sizes are scaled down to fit the cap. `.svg` is listed in the file picker `accept` attribute.
  - **AVIF (`.avif`), BMP (`.bmp`), GIF first frame (`.gif`):** Explicitly tested in CI and listed in the file picker `accept` attribute.
  - **Animated inputs (animated GIF, WebP, APNG, AVIF):** Import the first frame per the HTML `ImageBitmap` specification and show a non-blocking toast: `"Imported the first frame of <file name>. Animation is not supported yet."`
- **Export additions:**
  - **AVIF (`.avif`):** Encoded via lazy-loaded `@jsquash/avif` WebAssembly encoder (Apache-2.0, ~3.3 MB `.wasm` chunk loaded only when AVIF export is chosen), with quality 50 to 100 (default 80 for AVIF).
  - **BMP (`.bmp`):** Encoded via our own pure-TypeScript 24-bit/32-bit uncompressed BMP writer (0 dependencies, ~1 KB). Useful for external databending workflows.
  - **TIFF (`.tif`):** Encoded as uncompressed 8-bit RGBA TIFF via `utif2` (MIT, lazy-loaded).
- **Refused formats (explicitly unsupported with clear errors):**
  - **HEIC / HEIF (`.heic`, `.heif`):** Not natively decoded by Chrome, Edge, or Firefox; available Wasm decoders wrap LGPL `libheif`/`libde265` (~750 KB to 3 MB) and carry HEVC patent encumbrance. Rejected with `"Can't open <file name>: HEIC/HEIF is not supported in this browser. Convert it to JPEG, PNG, or WebP first."`
  - **Camera RAW (`.dng`, `.cr2`, `.cr3`, `.nef`, `.arw`, `.raf`, `.orf`, `.rw2`):** Not natively decoded by browsers; `dcraw` is GPL-2.0+, `LibRaw` is LGPL-2.1/CDDL-1.0, and RAW development is a non-goal (section 7). Rejected with `"Can't open <file name>: RAW camera files are not supported. Export a TIFF, PNG, or JPEG from your RAW converter first."`

Acceptance criteria:

- AC-F21.1: Importing a valid 8-bit RGB TIFF and a 16-bit TIFF creates projects with exact dimensions and upright orientation in Chromium and Firefox.
- AC-F21.2: Importing an SVG with `viewBox="0 0 100 50"` and no explicit width/height rasterises it to 2048 × 1024 px with zero external network requests.
- AC-F21.3: Importing an animated GIF imports frame 0 and displays the first-frame notice toast.
- AC-F21.4: Dropping a `.heic` file or a `.dng`/`.cr2` file creates no project and shows the format-specific message naming HEIC/HEIF or RAW.
- AC-F21.5: Exporting to AVIF, BMP, and TIFF downloads valid files whose headers match the format (`ftypavif`, `BM`, `II*\0` or `MM\0*`), have exact target dimensions, and carry no EXIF or GPS metadata.
- AC-F21.6: Initial app load does not fetch the AVIF Wasm chunk or `utif2` chunk until the user imports a TIFF or selects AVIF/TIFF export. The service worker's offline precache, which downloads the build in the background, may include the `utif2` chunk.

### F22. Expanded glitch effect catalogue

Adds a catalogue of 11 deterministic still-photo glitch effects beyond `pixelSort` and `channelShift`, fully specified in [engine.md section 16.1](engine.md#161-deferred-glitch-effects-and-v020-catalogue). All 11 use the existing `ParamSpec` vocabulary and require zero hand-written parameter UI code.

**Ranked top five for `v0.2.0` (by visual value to implementation effort):**

1. `sliceShift` (glitch): shift random horizontal or vertical bands sideways.
2. `channelSwap` (color): permute R, G, and B channels.
3. `blockShuffle` (glitch): swap square tiles around the image.
4. `scanlineWave` (glitch): sinusoidal and jittered row or column displacement.
5. `posterize` (color): reduce colour depth by level quantization or bit-crush.

**Remaining six specified for subsequent releases (in ranked order):**

6. `bayerDither` (color): ordered Bayer matrix dithering (2×2, 4×4, 8×8).
7. `rgbNoise` (glitch): deterministic colour or monochrome grain and hot-pixel dropout.
8. `pixelSmear` (glitch): carry pixels along a direction with per-pixel decay; supports `'selection'` debug view.
9. `mirrorFold` (glitch): horizontal, vertical, quad, or 8-way radial mirror fold.
10. `thresholdInvert` (color): invert pixels or channels inside a key threshold range; supports `'selection'` debug view.
11. `jpegCrush` (glitch): deterministic 8×8 block quantization and pixel-space byte-bend glitch simulation.

Acceptance criteria:

- AC-F22.1: Each implemented effect is registered in `src/engine/effects/index.ts`, appears in the "Add effect" picker with its label and one-line description, and generates all controls from `ParamSpec` without custom UI code.
- AC-F22.2: Each implemented effect passes the generic contract suite in `tests/engine/effect-contract.test.ts` (output size, input immutability, determinism, `mix = 0` identity) and has committed golden-image cases under `tests/golden/<type>/`.
- AC-F22.3: Built-in presets `builtin:vhs-split` and `builtin:tile-scramble` are enabled once `sliceShift`, `blockShuffle`, and `channelSwap` land.

### F23. Project change history panel

A visible history list for the active project, backed by the existing persisted `history` store (`persistence.md` section 2, up to 201 entries: 1 base state plus 200 undoable commits). Each entry displays a descriptive action label (for example `"Threshold range 0.25 to 0.80"`, `"Add Pixel sort"`, `"Crop 1200 × 800"`, `"Initial"`). Clicking or activating an entry jumps directly to that commit without deleting later entries; entries after the current position (`seq > historyHeadSeq`) appear muted until overwritten by a new commit. Layout placement at desktop, tablet, and phone widths is specified in [DESIGN.md section 7.2](../../DESIGN.md#72-post-v010-ui-specifications-f20-f23-f24).

Acceptance criteria:

- AC-F23.1: After 5 commits, the History panel lists all 6 entries (`Initial` plus 5 commits) in newest-first order with human-readable action labels; the active entry is marked with `aria-current="step"` and a visible `"Current"` badge.
- AC-F23.2: Clicking entry 2 of 5 jumps the project stack (and geometry transform, once F20 lands) to entry 2 without changing zoom or pan; entries 3, 4, and 5 remain visible in a muted redo style.
- AC-F23.3: Making a new commit while positioned at entry 2 discards entries 3, 4, and 5 and appends the new entry as entry 3.
- AC-F23.4: Reloading the browser restores the full history list and the exact active entry position.
- AC-F23.5: After 205 commits, the History panel shows 201 entries (the oldest reachable base state plus 200 undoable commits), matching AC-F9.3.
- AC-F23.6: The History list is fully keyboard navigable (Tab, Enter/Space to jump) and lays out without horizontal overflow at `390 × 844`, `820 × 1180`, and `1440 × 900`.

### F24. App changelog (Settings / About)

Companion feature addressing the second reading of "change history" (see [decisions.md D26 and Q12](decisions.md#d26-interpretation-of-cut-and-change-history-2026-11-25)): an expandable `"Changelog"` section inside Settings -> About (`src/features/settings/settings-content.tsx`) that displays release notes by version. The text is read from a repository root `CHANGELOG.md` bundled at build time (same generated-module pattern as `src/features/settings/third-party-notices.generated.ts`), with zero runtime network requests.

Acceptance criteria:

- AC-F24.1: Settings -> About includes a `"View changelog"` toggle that expands the bundled release notes offline without any network request.
- AC-F24.2: The build reads `CHANGELOG.md` from the repository root so release notes stay in sync with tagged releases.

### F25. Project files (save and open a single project)

A user can save any single project to disk as a self-contained `.glproj` file (a standard ZIP archive) and open it again later on any device or browser without uploading anything. The archive holds the untouched original source bytes (plus any secondary images referenced by `F26`), its SHA-256 hash, project metadata (name, created/modified/opened timestamps, source dimensions and MIME type), the geometry transform (`F20`), the effect stack, export settings, view state, optional undo history (default included), and an optional preview thumbnail. Format details and validation rules are in [persistence.md section 8.3](persistence.md#83-project-file-format-f25).

- **Extension and neutrality:** `.glproj` (standard ZIP container built and read with `fflate`, MIT). The extension and manifest (`kind: 'project'`) do not embed the app name so renaming the app never breaks saved files.
- **UI entry points:**
  - **Save:** `"Save project file"` in each library card menu (`src/features/library/project-card.tsx`) and in the editor toolbar / phone overflow menu (`src/features/toolbar/editor-toolbar.tsx`). Opens a compact dialog with `"Include undo history"` (checked by default), `"Save"`, and a progress bar with `"Cancel"` while assembling.
  - **Open:** Supported alongside image import in the `"Open images"` file picker (`src/features/import/use-image-picker.ts`, accepting `.glproj` and `.zip` in addition to image types) and by dragging and dropping `.glproj` (or `.zip`) files onto the library or editor (`src/features/import/window-file-drop.tsx`).
- **Name clash and deduplication:** Opening a `.glproj` always creates a new project with a fresh UUID so an existing local project is never overwritten. If a project with the same name already exists (case-insensitive trimmed match), the imported copy is named `"<name> (imported)"` (or `"<name> (imported 2)"`, etc., truncated to 120 characters). If the source SHA-256 already exists in `sources`, the existing stored blob is reused without storing a second copy.

Acceptance criteria:

- AC-F25.1: Choosing `"Save project file"` on a project with 2 effects, a geometry transform, custom export settings, and 5 history commits downloads a `<slug>-<YYYYMMDD-HHmmss>.glproj` file whose ZIP entries match [persistence.md section 8.3.2](persistence.md#832-archive-layout) and whose source entry matches the stored `SourceRecord` bytes bit-for-bit.
- AC-F25.2: Opening that `.glproj` file on a fresh browser profile (via picker or drag-and-drop) restores the project name, timestamps, source dimensions, effect stack, geometry transform, export settings, and all 5 undo steps, and opens it in the editor.
- AC-F25.3: Saving with `"Include undo history"` unchecked omits `history.json`; opening that file creates a single `seq: 0` `"Initial"` history entry holding the imported stack and transform.
- AC-F25.4: Opening a `.glproj` whose source SHA-256 already exists in `sources` creates a new project without duplicating the blob (storage usage grows by less than 1% of the source file size); if a project with the same name exists, the new project is named `"<name> (imported)"`.
- AC-F25.5: Opening a corrupt or non-ZIP `.glproj` creates no project and shows `"Can't open <file name>: the file is damaged or not a valid project archive."`
- AC-F25.6: Opening a `.glproj` with a missing source entry or a modified byte in `sources/<sha256>.<ext>` creates no project and shows `"Can't open <file name>: missing image data (<path>)."` or `"Can't open <file name>: image data is damaged (<path>)."`
- AC-F25.7: Opening a `.glproj` with `formatVersion` higher than supported creates no project and shows `"Can't open <file name>: project format version <v> is newer than this app supports. Update the app and try again."`
- AC-F25.8: Opening a `.glproj` containing an unknown effect type or newer effect version imports the project cleanly, preserves the instance verbatim (AC-F4.6), and shows a non-blocking toast `"Opened <name> with <N> unsupported effect(s)."`
- AC-F25.9: Saving and opening a 50 MP project file makes zero network requests and completes without decoding full-resolution pixels on the main thread.

### F17. Full backup and restore

Export all browser data (projects, user presets, and app settings) or a chosen subset of projects into one standard ZIP backup archive, and selectively restore it on the same or another browser with Merge or Replace semantics. Built on the same `fflate` ZIP streaming worker and project payload format as `F25` ([persistence.md section 8.4](persistence.md#84-full-backup-and-restore-f17)), deduplicating shared source blobs across projects inside the archive. The earlier 30-day backup reminder banner idea is dropped (see [decisions.md](decisions.md) for the reason).

- **Selective export:** Opens the `"Export backup"` dialog showing checkboxes for every project (all checked by default, with `"Select all"` / `"Select none"`), plus `"Include undo history"` (checked), `"Include user presets"` (checked), and `"Include settings"` (checked). Displays estimated uncompressed size. Downloads `glitch-backup-<YYYYMMDD-HHmmss>.zip`.
- **Selective import:** Choosing `"Import backup"` (or dropping a backup `.zip` on the Library or Editor) validates the archive in a worker first, then displays a preview list with checkboxes for every project (name, dimensions, source size, and status badge `"New"`, `"Unchanged"`, or `"Modified locally"`), user presets count, and settings (`Theme`, `Compare mode`) before writing anything to IndexedDB.
- **Merge versus Replace:**
  - **Merge (default):** Keeps existing local projects and presets, skips unchanged projects, imports modified clashes as a new UUID named `"<name> (imported)"`, merges presets, and applies settings only if checked.
  - **Replace:** Requires an explicit confirmation dialog (`"Replace all local data? This deletes <N> existing project(s) and <M> user preset(s) on this device before importing."`). Existing data is never removed until archive validation and source writes succeed.
- **Progress, cancel, and quota safety:** Both export and import show stage progress (`Reading`, `Packing` / `Validating`, `Importing`) with a `"Cancel"` button that stops within 1 s without leaving partial projects. If browser storage runs out during import, newly written unreferenced blobs are cleaned up and the library stays completely consistent.
- **UI locations:** `"Export backup"` and `"Import backup"` live in Settings -> Storage (`src/features/settings/settings-content.tsx`) and in a Library app-bar overflow menu (`src/app/app-bar-actions.ts`).

Acceptance criteria:

- AC-F17.1: Exporting a full backup of 3 projects (2 sharing the same source image), 2 user presets, and True Black theme produces a `.zip` containing `manifest.json`, `presets.json`, `settings.json`, 3 `projects/<id>/project.json` entries, and only 2 deduplicated `sources/<sha256>.<ext>` entries.
- AC-F17.2: Importing that backup on a fresh browser profile shows all 3 projects, 2 presets, and settings pre-checked in the preview dialog; unchecking 1 project and importing restores only the 2 checked projects, the 2 presets, and the True Black theme.
- AC-F17.3: Re-importing the same backup in Merge mode marks all 3 projects `"Unchanged"` and skips them without creating duplicates; modifying 1 project locally and re-importing marks it `"Modified locally"` and imports it as `"<name> (imported)"` without overwriting the local edit.
- AC-F17.4: Importing in Replace mode prompts for confirmation, replaces all local projects and presets with the selected backup items, and deletes orphaned source blobs afterwards.
- AC-F17.5: Cancelling a backup export or import stops within 1 s and leaves IndexedDB unchanged.
- AC-F17.6: Triggering a quota error during backup import leaves zero partial or broken projects (every existing project still opens and renders cleanly) and opens the `"Storage is full"` dialog.
- AC-F17.7: Importing a corrupt ZIP, a backup with a tampered source byte, or a backup with `backupVersion` higher than supported writes nothing and shows the exact error message from [persistence.md section 8.4.4](persistence.md#844-validation-quota-safety-and-merge-vs-replace).

### F26. Blending multiple images (`imageBlend`)

Merge or composite a second (third, ...) image into a project using an **`imageBlend`** effect instance inside the existing effect stack ([engine.md section 16.5](engine.md#165-multi-image-blending-imageblend-f26)). Because `imageBlend` is a normal effect in the stack, users can apply pixel sorting or glitch effects before the blend, merge another image with blend mode, opacity, fit, scale, offset, and rotation, and apply further effects to the combined result. Stacking multiple `imageBlend` instances merges 3 or more images.

- **Why an effect instead of a full layer model:** Fits the existing same-size-in, same-size-out `EffectDefinition` architecture (`src/engine/types.ts`), reuses undo/redo, stage cache, and responsive stack layouts without introducing a second layer tree UI or rewriting presets (see [decisions.md](decisions.md)).
- **Choosing an image:** Introduces a new `ParamSpec` kind (`'image'`) rendered by a dedicated `ImageControl` in `src/features/params/`. Users can pick an image from their device (same F1 validation, EXIF normalization, and 50 MP prompt) or reuse any image already stored in the library without duplicating bytes.
- **Controls:** Image picker, Blend mode (`Normal`, `Multiply`, `Screen`, `Overlay`, `Lighten`, `Darken`, `Difference`, `Exclusion`, `Add`, `Subtract`), Opacity (`0%` to `100%`), Fit (`Cover`, `Contain`, `Stretch`, `Tile`, `None`), Scale (`10%` to `400%`), Offset X / Y (`-100%` to `+100%`), and Rotation (`0°` to `360°`).
- **Limits and storage:** Up to **8** distinct extra images per project (each subject to F1's 16,384 px / 50 MP / 200 MB limits). Extra images live in the existing `sources` store, deduplicated by SHA-256, reference-counted across projects and undo history, and included automatically in `.glproj` project files (`F25`) and backups (`F17`). Saving a stack as a user preset clears `image` parameters to empty so presets never pin images.

Acceptance criteria:

- AC-F26.1: Adding `imageBlend` to a project, picking a second image from device or library, and setting Blend mode to `Difference` and Opacity to `100%` updates the preview within the visible-update budget and produces bit-identical output on repeated PNG exports.
- AC-F26.2: Placing `pixelSort` before `imageBlend` and `channelShift` after `imageBlend` applies pixel sort only to the base image, blends the second image on top, and applies channel shift to the merged result.
- AC-F26.3: Picking an image already used by another project reuses its `SourceRecord` (storage usage grows by less than 1% of the file size); deleting the first project keeps the shared image intact for the second project, and deleting both removes the blob from `sources`.
- AC-F26.4: Removing an `imageBlend` instance and clicking Undo restores the blended image cleanly (its source blob is retained while referenced by undo history).
- AC-F26.5: Saving a project containing `imageBlend` to a `.glproj` file (`F25`) or backup (`F17`) and opening it on a fresh browser profile restores both the primary and secondary images and renders the exact same result.
- AC-F26.6: Attempting to reference a 9th distinct extra image in one project is rejected with `"A project can use at most 8 extra blend images."`
- AC-F26.7: Saving a stack containing `imageBlend` as a user preset clears the `image` parameter to empty; applying that preset adds `imageBlend` with its blend/fit/transform parameters and `"No image selected"`.

### F27. In-app guide and first-launch welcome

A Guide screen inside the app at `#/guide`, so the user can learn Drift without leaving it or going online. There is no separate landing page: the app still opens straight to the Library ([decisions.md D32](decisions.md#d32-in-app-guide-instead-of-a-landing-page-2026-11-26)).

- **Opening it:** an icon button `"Guide"` (question-mark circle, tooltip `"Guide (?)"`) in the app bar of the Library and the Editor; a `"Read the guide"` link in Settings -> About; and the `?` key anywhere in the app, unless focus is in a text field or a dialog is open. On the Guide, the app bar has a back button (`"Back to editor"` when a project is open, otherwise `"Back to library"`) and Settings. Opening the Guide does not close the open project or change its stack, history or view.
- **Content, in this order:** what Drift is (offline, photos stay on the device, saved automatically in the browser); quick start (import, add effects, tweak, compare or split, export); the effect stack; effects reference; pixel sort concepts (angle, line, selection, run, interval, sort key, mask) in plain words from [CONTEXT.md](../../CONTEXT.md) and [engine.md section 5](engine.md#5-pixel-sort-effect-pixelsort); presets; undo and history; compare and split view; export, including the file-size limit; keyboard shortcuts; storage and privacy (quota, private browsing, no backup yet); install and offline use. The text describes only what the app does today.
- **Generated parts:** the effects reference lists every effect in the registry with its label, description and each parameter's label, range, default, help and visibility condition, read from the parameter schema (engine.md section 3). The built-in preset names come from the preset list. A new effect or preset appears with no change to the guide.
- **Text in one place:** all other guide and welcome text is in `src/features/guide/content.ts`.
- **Table of contents:** at 1024 px width and wider a sticky list beside the text; narrower, a collapsible `"Contents"` button above it. Choosing an entry scrolls to the section, moves focus to its heading and (when collapsible) closes the list. The URL stays `#/guide`.
- **Empty Library:** shows the link `"New here? Read the guide"` once the welcome card is dismissed.
- **Welcome card:** on a first launch the empty Library shows a card `"Welcome to Drift"` with `"Import a photo"`, `"Read the guide"` and a dismiss button. It is dismissed by that button or by the first import, stored as `welcomeDismissed` in app settings ([persistence.md](persistence.md)), and never shown again. A profile that already holds projects never sees it, because it only appears in an empty Library and any later import dismisses it.

Acceptance criteria:

- AC-F27.1: The `"Guide"` button in the Library and Editor app bar opens `#/guide`; the back button returns to the previous screen, and an open project renders as before.
- AC-F27.2: Pressing `?` in the Library or Editor opens the Guide; pressing it while typing in a text field or with a dialog open does nothing.
- AC-F27.3: Settings -> About -> `"Read the guide"` closes Settings and opens the Guide.
- AC-F27.4: Every effect type in the registry, with every parameter label, appears in the effects reference (unit test).
- AC-F27.5: At 1440 x 900 the contents list stays visible while the text scrolls; at 390 x 844 and 820 x 1180 it is collapsed behind `"Contents"`. Choosing an entry scrolls to that section and focuses its heading.
- AC-F27.6: After one online visit, loading `#/guide` offline shows the Guide, with no request to another origin.
- AC-F27.7: On a fresh profile the welcome card is shown; after dismissing it and reloading, it does not return and the empty Library shows `"New here? Read the guide"`.
- AC-F27.8: axe reports no violations on the Guide in both themes at the three test viewports, and no horizontal page scroll occurs.

## 7. Later (beyond v0.2.0)

Grouped by likely order. Each needs its own spec before work starts (moved first-release features keep their original IDs and existing spec text under the "Later" sections of `engine.md` and `persistence.md`).

1. **Mobile, tablet and Safari acceptance (later).** Acceptance testing and reference devices for phones, tablets and Safari; the iOS canvas-limit path (tiled decode, custom streaming PNG writer, on-demand WebAssembly JPEG encoder, and 24 MP mobile limit, specified in [engine.md section 16.2](engine.md#162-ios-canvas-limit-decode-and-export-path)); and Safari 7-day storage eviction / Home Screen warnings (specified in [persistence.md section 8.4.5](persistence.md#845-safari-7-day-eviction-warning-later)).
3. **Masks and on-canvas tools.** Brush-painted mask per effect instance (paint, erase, size, hardness, invert, clear, overlay opacity), region cutout if requested (Q11), mask from the image's own luminance, imported mask images, and interactive on-canvas tools using the reserved slot in [engine.md section 4.7](engine.md#47-on-canvas-tool-slot-reserved-for-later) and [DESIGN.md section 7.1](../../DESIGN.md#71-on-canvas-tool-slot-reserved-for-later). Engine mask semantics are already specified in engine.md section 5.6.
4. **Remaining F22 effects and `pixelSort` v2.** The 6 lower-ranked effects from F22 (`bayerDither`, `rgbNoise`, `pixelSmear`, `mirrorFold`, `thresholdInvert`, `jpegCrush`), per-channel pixel sort, interval transforms (mirror, splice, fold, grouping equal colours), and more line shapes (concentric rectangles, circles, spirals, random walks, tiles with density).
5. **Editing comfort.** Compare against any history entry; paste an image from the clipboard; project tags or folders; batch export of several projects; side-by-side preview of two presets.
6. **Extended colour pipelines.** WebP export on Safari through a WebAssembly encoder; 16-bit PNG/TIFF processing kept at 16 bits; wide-gamut (Display P3) output.
7. **Speed.** WebGPU acceleration for axis-aligned pixel sort; multi-worker splitting; WebAssembly SIMD kernels. See engine.md section 12.
8. **Motion.** Parameter animation to GIF and video, and video input frame by frame.
9. **Packaging.** Native desktop and mobile apps packaged with Tauri from the same web build (note: Tauri uses the system webview, so WebKit/iOS canvas limits still apply on Apple platforms; see decisions.md).
10. **Languages.** Translated UI (the first release is English only).

## 8. Non-goals

These are out of scope for the first release and are not planned unless the owner asks:

- Accounts, cloud sync, sharing links, collaboration, analytics or any network calls after the app is loaded.
- Server-side processing of any kind.
- A general photo editor: no layers, text, drawing, retouching, RAW development, curves or colour grading beyond the listed effects.
- Loading effect plug-ins at runtime from files or URLs. New effects are added in source code (engine.md section 4).
- Preserving EXIF, GPS or ICC metadata in exports.
- Colour management beyond converting input to sRGB.
- Support for browsers without module workers, `createImageBitmap` or IndexedDB.
- Guaranteeing identical output bytes across browsers for JPEG sources (decoders differ; see engine.md section 10).

## 9. Release acceptance

The first release ships when:

1. Every acceptance criterion in section 5 passes on the desktop browser matrix below, recorded in a release checklist with the tester, browser version and date.
2. The engine test suite (golden images and property tests) passes in CI.
3. The performance budgets in engine.md section 9 are met on the reference laptop, or each miss is listed with its measured value and accepted by the owner.

Device and browser matrix (desktop only for the first release; Safari is best effort and not an acceptance target):

| Class | Device and browser |
|---|---|
| Desktop | 2020 or newer laptop (Apple M1 or Intel i5 11th gen class) with Chromium (Chrome or Edge 120+) and Firefox 128+ |
