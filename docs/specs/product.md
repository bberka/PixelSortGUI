Written by Claude Opus 5.5 (Antigravity, thought level high), spec subagent.
Reconciled by Claude Sonnet 5.5 (thinking medium), documentation subagent.
Updated for owner decisions by Gemini 4 Neon (Antigravity, thought level medium), documentation subagent.

# PixelSortGUI product spec

Status: settled for first release, 2026-11-24. Companion specs: [engine.md](engine.md), [persistence.md](persistence.md), [../../DESIGN.md](../../DESIGN.md), [roadmap.md](roadmap.md), [decisions.md](decisions.md).

## 1. Purpose and users

PixelSortGUI is an editor for pixel sorting and glitch effects on still photos. It runs in a browser, works offline, has no accounts and no server, and keeps every image and setting in the browser's own storage on the device.

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
- Built output is a static folder (`dist/`) hosted on GitHub Pages on the custom domain `glitch.bbay.dev`. The build must work when served from the domain root (`/`), and the published output includes a `CNAME` file containing `glitch.bbay.dev`.

Image size limits for the first release:

| Limit | Value |
|---|---|
| Accepted input formats | Whatever the browser decodes with `createImageBitmap`: JPEG, PNG, WebP, GIF (first frame), BMP, AVIF in the accepted desktop browsers. The app bundles no extra decoders. |
| Longest side | 16,384 px. Larger files are rejected with a message. |
| Area | 50 MP (50,000,000 px) is the guaranteed maximum on the accepted desktop browsers. Larger images within the longest-side and file-size limits are offered a downscaled import: "Import at 50 MP" (stores a downscaled copy as the source image) or "Import anyway" (best effort: the image is stored at its original size, and preview or export may fail with an out-of-memory error, which is shown as an error message and leaves the project intact). |
| File size | 200 MB per file. |

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
- AC-F1.7: Importing the same file twice creates two projects; the storage usage shown in Settings grows by less than 1% of the file size on the second import.

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

- AC-F5.1: Typing 37.5 into the angle field and pressing Enter sets the angle to 37.5 and creates one commit.
- AC-F5.2: Typing a value outside the range (for example 400 for a 0 to 1 slider) clamps it to the nearest limit and shows the clamped value.
- AC-F5.3: Dragging a slider for 3 s creates exactly one commit, on release.
- AC-F5.4: With keyboard focus on a slider, Arrow keys change the value by one step and Shift+Arrow by ten steps; a burst of key presses with no gap over 500 ms creates one commit.
- AC-F5.5: Setting pixel sort `intervalMode` to `edges` hides the threshold range and shows the edge threshold and edge blur controls.
- AC-F5.6: Every control has a visible label, its current value with unit (for example "120 px", "45°", "0.25"), and an accessible name equal to the label.

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
- AC-F9.2: The undo button's tooltip and accessible name include the entry label, for example "Undo Change Angle".
- AC-F9.3: After 205 commits, 200 undos are possible and the 201st is not.
- AC-F9.4: Undo and redo do not change zoom, pan, selection of the library or theme.
- AC-F9.5: Undo history is restored after a reload (see AC-F3.2).

### F10. Presets

The preset list shows built-in presets first (the six listed in [engine.md section 7](engine.md#7-built-in-presets)), then user presets by name. Applying a preset replaces the stack (one commit). "Add to stack" appends the preset's instances instead. "Save as preset" stores the current stack under a name. User presets can be renamed and deleted. Presets are global, not per project.

- AC-F10.1: Applying "ASDF classic" to a project with an empty stack yields two pixel sort instances (angle 270, then angle 0) and a visible result.
- AC-F10.2: Saving a stack as "Mine", then applying "Mine" to another project, reproduces the same parameters and seeds.
- AC-F10.3: Built-in presets cannot be renamed or deleted (the actions are absent).
- AC-F10.4: User presets survive a reload.

### F11. Compare

The Compare button toggles between the result and the source image (keyboard: `\` toggles; holding the button with a pointer or holding `\` for more than 300 ms shows the source only while held). The split view (toolbar toggle or `S`) shows the source on the left and the result on the right of a draggable divider.

- AC-F11.1: Clicking Compare shows the source and labels the canvas "Original"; clicking again shows the result.
- AC-F11.2: Pressing and holding Compare for 1 s and releasing returns to the result.
- AC-F11.3: In split view, dragging the divider moves it; with the divider focused, Left and Right move it by 1% and Shift+Left/Right by 10%; its position is restored after reload.
- AC-F11.4: Compare and split work while zoomed and panned, with both sides aligned to the same pixels.

### F12. Export

The export dialog offers format (PNG, JPEG, and WebP only where the browser's native encoder produces WebP), quality for JPEG and WebP (50 to 100, default 92), size (Full, 1/2, 1/4, or a custom longest side, never larger than the source), and the file name (default `<project name>-<YYYYMMDD-HHmmss>.<ext>`). Export renders at the chosen size in a separate worker with a progress bar and Cancel. On browsers that support sharing files (`navigator.canShare({files})`), a Share button is shown next to Download. Exported files carry no EXIF, GPS or ICC metadata and are sRGB.

- AC-F12.1: Exporting a 12 MP project as PNG at Full size downloads a PNG of exactly the source dimensions within 5 s on a reference laptop.
- AC-F12.2: WebP appears in the format list only when the startup `convertToBlob` probe confirms the browser encodes WebP (offered in Chrome, Edge and Firefox).
- AC-F12.3: Exporting a 4001 × 3001 px project at 1/2 size produces a 2000 × 1500 px image (`floor(width × 0.5)` × `floor(height × 0.5)`, the render size rule in engine.md section 8), rendered at that size rather than resized after rendering.
- AC-F12.4: Cancel stops the export within 1 s and no file is written.
- AC-F12.6: The exported file has no EXIF block (checked with an EXIF reader).
- AC-F12.7: The export settings last used for a project are preselected the next time its export dialog opens.

### F13. Zoom and pan

The canvas supports fit-to-view, 100% (one image pixel per CSS pixel) and continuous zoom from 10% of fit up to 3200%. Pointer: drag pans, Ctrl/Cmd + wheel or trackpad pinch zooms around the pointer, plain wheel pans, double-click toggles fit and 100%. Touch: one finger pans, two-finger pinch zooms around the midpoint, double-tap toggles fit and 100%. Keyboard: `+` and `-` zoom by a factor of 2 around the centre, `0` fits, `1` shows 100%, Arrow keys pan by 10% of the viewport when the canvas has focus. Above 200% zoom, pixels are drawn without smoothing.

- AC-F13.1: Continuous wheel or trackpad zoom on a reference laptop runs at 60 frames per second on a `settle` proxy of 4 MP (measured in the browser performance panel; at most 3 dropped frames over 1 s of continuous zoom).
- AC-F13.2: The zoom percentage is shown in the canvas toolbar, and choosing it opens a menu with Fit, 50%, 100%, 200%, 400%.
- AC-F13.3: Panning cannot move the image entirely out of view: at least 64 CSS px of the image stays visible.

### F14. Themes

Two themes, light and true black (pure `#000000` background), plus "System" which follows the operating system setting. Default: System. The choice is made in Settings and from the theme button in the toolbar, applied before first paint on reload (no flash of the other theme). Tokens are in [DESIGN.md](../../DESIGN.md#2-themes-and-color-tokens).

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

## 6. Later (not in the first release)

Grouped by likely order. Each needs its own spec before work starts (moved first-release features keep their original IDs and existing spec text under the "Later" sections of `engine.md` and `persistence.md`).

1. **Backup and restore (`F17`, later).** ZIP export and import of selected projects or the whole library (source images, effect stacks, optional history, and all user presets), double-import deduplication, corruption/version errors, and the 30-day backup reminder. Format in [persistence.md section 8](persistence.md#8-later-backup-export-and-import-f17-and-eviction-warnings).
2. **Deferred glitch effects (from `F7`, later).** `sliceShift` (shift random bands sideways), `blockShuffle` (swap square tiles), and `channelSwap` (permute R, G, B), plus the `vhs-split` and `tile-scramble` built-in presets. Specified in [engine.md section 16.1](engine.md#161-deferred-glitch-effects).
3. **Mobile, tablet and Safari acceptance (later).** Acceptance testing and reference devices for phones, tablets and Safari; the iOS canvas-limit path (tiled decode, custom streaming PNG writer, on-demand WebAssembly JPEG encoder, and 24 MP mobile limit, specified in [engine.md section 16.2](engine.md#162-ios-canvas-limit-decode-and-export-path)); and Safari 7-day storage eviction / Home Screen warnings (specified in [persistence.md section 8.0](persistence.md#80-safari-7-day-eviction-warning-later)).
4. **Masks and on-canvas tools.** Brush-painted mask per effect instance (paint, erase, size, hardness, invert, clear, overlay opacity), mask from the image's own luminance, imported mask images, and interactive on-canvas tools using the reserved slot in [engine.md section 4.7](engine.md#47-on-canvas-tool-slot-reserved-for-later) and [DESIGN.md section 7.1](../../DESIGN.md#71-on-canvas-tool-slot-reserved-for-later). Engine mask semantics are already specified in engine.md section 5.6.
5. **More effects.** Smear with decay trails, wave displacement (sine row offsets), posterize, ordered dither, noise and grain, data bending (corrupting compressed JPEG bytes and decoding the result), per-channel pixel sort (a different key per channel), mirror and kaleidoscope.
6. **Interval transforms for pixel sort.** Mirror (alternate ends), splice (rotate the interval), fold from the middle, and grouping equal colours.
7. **More line shapes for pixel sort.** Concentric rectangles, circles, spirals, random walks, tiles with density.
8. **Editing comfort.** History panel listing entries; compare against any history entry; paste an image from the clipboard; crop and rotate of the source; project tags or folders; batch export of several projects; side-by-side preview of two presets.
9. **Formats.** AVIF export and WebP export on Safari through a WebAssembly encoder; 16-bit PNG input kept at 16 bits; wide-gamut (Display P3) output.
10. **Speed.** WebGPU acceleration for axis-aligned pixel sort; multi-worker splitting; WebAssembly SIMD kernels. See engine.md section 12.
11. **Motion.** Parameter animation to GIF and video, and video input frame by frame.
12. **Packaging.** Native desktop and mobile apps packaged with Tauri from the same web build (note: Tauri uses the system webview, so WebKit/iOS canvas limits still apply on Apple platforms; see decisions.md).
13. **Languages.** Translated UI (the first release is English only).

## 7. Non-goals

These are out of scope for the first release and are not planned unless the owner asks:

- Accounts, cloud sync, sharing links, collaboration, analytics or any network calls after the app is loaded.
- Server-side processing of any kind.
- A general photo editor: no layers, text, drawing, retouching, RAW development, curves or colour grading beyond the listed effects.
- Loading effect plug-ins at runtime from files or URLs. New effects are added in source code (engine.md section 4).
- Preserving EXIF, GPS or ICC metadata in exports.
- Colour management beyond converting input to sRGB.
- Support for browsers without module workers, `createImageBitmap` or IndexedDB.
- Guaranteeing identical output bytes across browsers for JPEG sources (decoders differ; see engine.md section 10).

## 8. Release acceptance

The first release ships when:

1. Every acceptance criterion in section 5 passes on the desktop browser matrix below, recorded in a release checklist with the tester, browser version and date.
2. The engine test suite (golden images and property tests) passes in CI.
3. The performance budgets in engine.md section 9 are met on the reference laptop, or each miss is listed with its measured value and accepted by the owner.

Device and browser matrix (desktop only for the first release; Safari is best effort and not an acceptance target):

| Class | Device and browser |
|---|---|
| Desktop | 2020 or newer laptop (Apple M1 or Intel i5 11th gen class) with Chromium (Chrome or Edge 120+) and Firefox 128+ |
