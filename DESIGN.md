Written by Gemini 4 Neon (Antigravity, thought level high), spec subagent.
Updated with post-v0.1.0 UI specs (F20, F23, F24) by Gemini 4 Neon (Antigravity, thought level medium), specification subagent.
Updated with project files (F25), full backup and restore (F17), and image blend (F26) UI specs by Gemini 4 Neon (Antigravity, thought level medium), specification subagent.
Updated with split orientation and per-side stacks (F11) by Claude Sonnet 5.5 (apx, high thinking), spec and implementation subagent.

# Drift design system

Status: settled for first release, 2026-11-24. Companion specs: [product.md](docs/specs/product.md), [engine.md](docs/specs/engine.md), [persistence.md](docs/specs/persistence.md), [roadmap.md](docs/specs/roadmap.md), [decisions.md](docs/specs/decisions.md). Source of truth for CSS tokens in code: `src/styles/app.css`.

## 1. Design direction and principles

Drift is a darkroom-style still-photo utility. The user's image is the visual focus; the interface recedes into neutral monochrome chrome with one restrained accent reserved for active controls, slider tracks, progress indicators, and keyboard focus.

Rules every screen follows:

- **No decoration or marketing copy.** No hero banners, gradients, background grids, onboarding tours, landing pages, or explanatory subtitles that restate labels. Help lives on the Guide screen (section 7.3); the only first-launch aid is one dismissible welcome card in the empty Library.
- **No remote assets.** System fonts only, bundled `lucide-react` icons only. Zero network requests at runtime.
- **Semantic tokens only.** Never write raw hex, `rgb()`, or Tailwind palette color utilities (`bg-zinc-900`, `text-blue-500`) in `.tsx` components. Use semantic classes (`bg-background`, `text-muted-foreground`, `border-border`) mapped in `src/styles/app.css`.
- **Same features on every screen size.** Phone, tablet, and desktop layouts expose the exact same first-release capabilities; only chrome placement and target sizing adapt. First-release acceptance is desktop only; phone and tablet widths are checked in a desktop browser for layout only.

## 2. Themes and color tokens

Two explicit themes: **Light** and **True Black** (pure `#000000` background for OLED clarity and zero colour cast around photos), plus **System** (follows `prefers-color-scheme`, default), with the selector in Settings (the app bar has no theme button).

### 2.1 Activation and zero-flash boot

- `<html data-theme="system | light | dark">` controls the active theme.
- An inline `<script>` in `index.html` reads `localStorage.getItem('drift:theme')` synchronously before CSS/JS loads and sets `document.documentElement.dataset.theme`, preventing any flash of the wrong theme on reload (AC-F14.2).
- Switching the OS appearance while `data-theme="system"` updates immediately via `@media (prefers-color-scheme: dark)` without reloading (AC-F14.1).

### 2.2 Semantic token table

Defined as space-separated RGB triples in `src/styles/app.css` and exposed through Tailwind 4 `@theme` (`--color-background: rgb(var(--background))`). Every foreground/background pair meets WCAG 2.2 AA (≥ 4.5:1 for normal text, ≥ 3:1 for large text and UI components).

| Token | Light (`hex` / RGB) | True Black (`hex` / RGB) | Role |
|---|---|---|---|
| `--background` | `#fafafa` / `250 250 250` | `#000000` / `0 0 0` | App shell, Library background, Editor chrome base |
| `--canvas-stage` | `#e4e4e7` / `228 228 231` | `#000000` / `0 0 0` | Viewport behind the photo canvas |
| `--card` | `#ffffff` / `255 255 255` | `#0a0a0a` / `10 10 10` | Library cards, sidebar panels, bottom sheet surface |
| `--popover` | `#ffffff` / `255 255 255` | `#121212` / `18 18 18` | Dialogs, menus, dropdowns, floating canvas pills |
| `--secondary` | `#f4f4f5` / `244 244 245` | `#18181b` / `24 24 27` | Secondary buttons, segmented track, hover fills |
| `--muted` | `#f4f4f5` / `244 244 245` | `#141414` / `20 20 20` | Disabled surfaces, thumbnail placeholders, slider track |
| `--foreground` | `#09090b` / `9 9 11` | `#fafafa` / `250 250 250` | Primary text and icons (≥ 18:1 on `--background`) |
| `--muted-foreground` | `#52525b` / `82 82 91` | `#a1a1aa` / `161 161 170` | Secondary labels, dimensions, dates, units (≥ 7:1) |
| `--border` | `#e4e4e7` / `228 228 231` | `#262626` / `38 38 38` | Hairline 1 px dividers, card and panel borders |
| `--input` | `#d4d4d8` / `212 212 216` | `#3f3f46` / `63 63 70` | Input borders, slider thumb ring, switch off-track |
| `--primary` | `#18181b` / `24 24 27` | `#fafafa` / `250 250 250` | Primary action button fill ("Open images", "Export") |
| `--primary-foreground` | `#fafafa` / `250 250 250` | `#000000` / `0 0 0` | Text/icons on `--primary` |
| `--accent` | `#2563eb` / `37 99 235` | `#3b82f6` / `59 130 246` | Slider fill, active selection indicator, progress bar |
| `--accent-foreground` | `#ffffff` / `255 255 255` | `#000000` / `0 0 0` | High-contrast label on filled accent controls |
| `--accent-text` | `#1d4ed8` / `29 78 216` | `#60a5fa` / `96 165 250` | Accent text/links on `--background` or `--card` (≥ 6.5:1) |
| `--ring` | `#2563eb` / `37 99 235` | `#60a5fa` / `96 165 250` | Keyboard focus ring (`2 px solid`) |
| `--destructive` | `#dc2626` / `220 38 38` | `#ef4444` / `239 68 68` | Delete button fill and error indicators |
| `--destructive-text` | `#b91c1c` / `185 28 28` | `#f87171` / `248 113 113` | Destructive text on `--background` or `--card` (≥ 6.4:1) |
| `--destructive-foreground` | `#ffffff` / `255 255 255` | `#000000` / `0 0 0` | Text on `--destructive` fill |
| `--warning` | `#b45309` / `180 83 9` | `#f59e0b` / `245 158 11` | Storage warning accent |
| `--success` | `#15803d` / `21 128 61` | `#22c55e` / `34 197 94` | Persistent storage badge, completed status |
| `--checker-a` | `#d4d4d8` / `212 212 216` | `#141414` / `20 20 20` | Transparency checkerboard tile A behind RGBA images |
| `--checker-b` | `#e4e4e7` / `228 228 231` | `#0a0a0a` / `10 10 10` | Transparency checkerboard tile B behind RGBA images |

## 3. Typography

System stacks only (zero network requests):

- `--font-sans`: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- `--font-mono`: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

| Role | Font | Size / Line height | Weight | Extra rules |
|---|---|---|---|---|
| App / Screen heading (`h1`) | Sans | 18 px / 24 px | 600 | Single `h1` per screen |
| Dialog / Sheet title | Sans | 16 px / 22 px | 600 | |
| Parameter group heading | Sans | 11 px / 16 px | 600 | Uppercase, `letter-spacing: 0.05em`, `text-muted-foreground` |
| Control label / Body | Sans | 14 px / 20 px | 500 (label), 400 (body) | |
| Metadata (dimensions, dates, helper text) | Sans | 12 px / 16 px | 400 | `text-muted-foreground` |
| Numeric readouts & inputs (desktop) | Mono | 13 px / 18 px | 400 | `font-variant-numeric: tabular-nums` |
| Text and numeric inputs (coarse pointer) | Mono / Sans | **16 px** / 22 px | 400 | Enforced under `@media (pointer: coarse)` so mobile browsers do not auto-zoom on focus |
| Status pill (`Off`, `Original`, `100%`) | Mono / Sans | 12 px / 16 px | 500 | `tabular-nums` for percentages |

## 4. Spacing, radii and elevation

- **Base grid:** 4 px (`4, 8, 12, 16, 20, 24, 32`).
- **Radii:** `--radius: 8px` for cards, dialogs, and sheets; `6px` for buttons, inputs, and stack rows; `4px` for badges, pills, and fader slider tracks/grips; `9999px` for the angle dial.
- **Chrome dimensions:**
  - Top bar height: `48 px` on desktop; `52 px` plus `env(safe-area-inset-top)` on tablet and phone.
  - Desktop right sidebar width: `340 px` (fixed).
  - Tablet docked bottom panel height: `360 px` default, resizable by pointer/keyboard handle between `240 px` and `50%` of viewport height, collapsible to a `48 px` header strip.
  - Phone bottom sheet detents: **Collapsed** (`56 px` + `env(safe-area-inset-bottom)`), **Half** (`44%` viewport height), **Expanded** (`80%` viewport height).
- **Interactive target minimums:**
  - Coarse pointer (`@media (pointer: coarse)` or phone/tablet viewport class): `44 × 44 CSS px` minimum hit area for every button, slider thumb, toggle, chip, and menu trigger.
  - Desktop (`@media (pointer: fine)` and desktop class): `24 × 24 CSS px` minimum (`32 px` standard toolbar buttons).
- **Elevation:** Flat hierarchy using `1 px solid rgb(var(--border))` and `--background` → `--card` → `--popover` steps. Only overlays (`Dialog`, `Popover`, `DropdownMenu`, `Sheet`) carry a subtle shadow in Light mode (`0 8px 24px rgb(0 0 0 / 0.10)`); in True Black mode they rely on a crisp `1 px solid rgb(var(--input))` border instead of diffuse shadow.

## 5. Controls and shadcn component mapping

All base primitives come from **shadcn/ui** (`new-york` style, Radix UI primitives, `lucide-react` icons, `src/components/ui/`). Every scrollable region uses the one `ScrollArea` described in 5.4.

### 5.1 Parameter controls (F5, schema-driven)

Every control renders a visible `<label>` (equal to its accessible name, AC-F5.6), its formatted current value with unit (`120 px`, `45°`, `0.25`, `30%`), and a compact per-parameter `"Reset to default"` icon button (`RotateCcw`, disabled/hidden at opacity 0 until focus when value equals default, always reachable by keyboard when modified). Parameters whose `visibleWhen` predicate evaluates to `false` are omitted from the DOM (AC-F5.5). Groups from `ParamSpec.group` appear in first-use order separated by `Separator`.

| `ParamSpec.kind` | Control composition | Exact behaviour |
|---|---|---|
| `number` | `Slider` + numeric `Input` (`inputMode="decimal"`) | Slider emits live `drag` updates; 1 commit on release. Input commits on Enter/blur, clamps to `[min, max]`, rounds to `step` (AC-F5.1, AC-F5.2). |
| `integer` | `Slider` + numeric `Input` (`inputMode="numeric"`) | Same as `number`; displays `px` suffix when `unit === 'px'`. |
| `boolean` | `Switch` | Toggles immediately; 1 commit per toggle. |
| `enum` (≤ 4 options) | `ToggleGroup` (`type="single"`) | Segmented toggle buttons; active option uses high-contrast fill. |
| `enum` (> 4 options) | `Select` (`SelectTrigger`, `SelectContent`, `SelectItem`) | Dropdown list (used for 8 sort/selection keys). |
| `range` | Two-thumb `Slider` (`minStepsBetweenThumbs={0}`) + two numeric `Input`s (`Low`, `High`) | Thumbs cannot cross; typing `lo > hi` swaps them to match `validateParams` (engine.md section 3). |
| `angle` | Custom `AngleDial` + numeric `Input` (unit `°`, step `0.1`) | 44 × 44 px circular dial with pointer/touch drag; snaps within `±4°` to `spec.snaps` (`0, 45, 90, 135, 180, 225, 270, 315`), Shift bypasses snap. Keyboard on dial: Arrow ±1°, Shift+Arrow ±15°, Home 0°. |
| `seed` | Numeric `Input` (`inputMode="numeric"`, uint32) + `"New seed"` `Button` (`Dices` icon) | `"New seed"` writes a random uint32 from `crypto.getRandomValues` as 1 commit. |

#### Slider presentation

All numeric, integer, range, Mix, and Export quality sliders use `Slider` (`src/components/ui/slider.tsx`), whose default variant is **`fader`** (`DEFAULT_SLIDER_VARIANT`):

- **Dimensions and radii:** `32 px` (`h-8`) interactive row height; `10 px` (`h-2.5`, `4 px` radius) thick track; `12 × 24 px` (`4 px` radius) rectangular studio-fader grip centered inside a `24 × 28 px` pointer target (`44 × 44 px` under `@media (pointer: coarse)`).
- **Tokens and contrast:** Unfilled track uses `bg-muted` with `1 px solid` `border-input`; filled range uses `bg-accent` (≥ 4.6:1 against `bg-muted` in both Light and True Black themes). The grip uses `bg-card` with a `2 px` `border-foreground` frame and a `2 × 12 px` `bg-foreground` centre notch (`border-accent` on hover). End ticks at `0%` and `100%` use `bg-input`; the default-value tick uses `bg-foreground`. Focus renders `2 px solid` `outline-ring` with `2 px` offset. Disabled state reduces opacity to `50%` and blocks pointer events.
- **Range form:** Two-thumb sliders render a filled `bg-accent` band between two identical rectangular grips that cannot cross (`minStepsBetweenThumbs={0}`).
- **Alternative variants** (selectable via the `variant` prop or `DEFAULT_SLIDER_VARIANT`):
  - **`fill-bar`:** `32 px` tall scrubby fill bar (`rounded-md`, `border-input`, `bg-muted` track, full-height `bg-accent` fill, vertical bar grip, default-value tick).
  - **`stepped`:** `28 px` tall segmented track of 16 discrete pixel cells (`rounded-[2px]`, `bg-accent` lit cells over `bg-muted` / `border-input` unlit cells, block cursor thumb, default-value notch).

### 5.2 Universal effect instance controls

Displayed in the parameter panel whenever an effect instance is selected (outside `ParamSpec`):

- **Header row:** Effect label, `"Show selection"` `Switch` (only when `def.debugViews?.includes('selection')`, F6), and `"Reset all"` `Button` (ghost, resets all params + `mix` + `blend` to defaults as 1 commit), plus a `"Randomize"` `Button` (ghost, `DicesIcon`, tooltip) before it that sets every param to a random valid value as 1 commit and leaves `mix`, `blend` and `enabled` alone; icon-only on phone widths (F5).
- **Blend & Mix group (bottom section):**
  - `Mix`: `Slider` + numeric `Input` (`0` to `100%`, step `1%`, stored as `0..1` step `0.01`, default `100%`).
  - `Blend`: `ToggleGroup` (`normal` "Normal", `lighten` "Lighten", `darken` "Darken", `difference` "Difference").

### 5.3 Application-wide shadcn mapping

| UI element | Feature | shadcn component | Notes |
|---|---|---|---|
| Primary / toolbar / icon buttons | All | `Button` + `Tooltip` | Every icon-only button has `aria-label` and a `Tooltip` (desktop) |
| Library project card | F2 | `Card` | 4:3 thumbnail container, title (1-line truncate), `W × H px`, last-opened date, overflow `DropdownMenu` |
| Card actions / Instance actions / Zoom menu | F2, F4, F13 | `DropdownMenu` | Keyboard-navigable menus |
| Add effect picker | F4 | `Popover` (desktop/tablet) / `Dialog` (phone) | Lists all registered effects with label and 1-line description (AC-F4.1) |
| Presets picker | F10 | `Popover` (desktop/tablet) / `Dialog` (phone) | Lives in the editor toolbar (`src/features/toolbar/`), not in a sidebar tab |
| Export / Save preset / Settings / About | F10, F12, F16 | `Dialog` (desktop/tablet) / full-height `Sheet` (phone) | Focus-trapped modals |
| Delete project / Storage full / Large image (> 50 MP) choice | F1, F2, F16 | `AlertDialog` | Explicit confirmation or blocking choice |
| Phone parameter panel | F18 | Custom detent bottom sheet (Radix `Dialog` non-modal or pointer-tracked region) | Drag handle + detent cycle button; never blocks canvas gestures while collapsed/half |
| Render & export progress | F8, F12 | `Progress` | `2 px` top bar on canvas (> 300 ms renders); labeled bar with Cancel in Export dialog |
| Status tags (`Off`, `Original`, `Persistent`) | F4, F11, F16 | `Badge` | Text + icon, never colour alone |
| Update ready / Deleted project | F3, F15 | `Sonner` (`Toaster`) | Non-blocking toasts; update toast persists until acted on or dismissed |
| Persistent warning (Storage unavailable) | F16 | Inline alert bar (`role="status"` or `role="alert"`) | Docked directly under the top bar; never overlays canvas controls |

### 5.4 Scrollbars

One component, `ScrollArea` in `src/components/ui/scroll-area.tsx` (Radix `ScrollArea`, restyled), draws every scrollbar in the app. No scroll region uses a native `overflow-auto` or `overflow-y-auto` element, and `src/` has no other scrollbar CSS. Radix is chosen over native CSS because Firefox's `scrollbar-width` cannot change thickness on hover or drag and has no `::-webkit-scrollbar`; the Radix bar behaves the same in Chromium and Firefox.

- **Overlay.** The bar sits over the content edge and takes no layout width, so content never shifts when it appears or disappears. It mounts only on an axis that overflows.
- **Plain thumb.** No arrow buttons, no track background, no border: a rounded thumb only. The track is `transparent`.
- **Thickness.** The thumb is `4 px` at rest. While the pointer is on the scrollbar strip, or the thumb is being dragged, it widens to `8 px` over `150 ms`, and returns to `4 px` when the pointer leaves and the drag ends. With `prefers-reduced-motion: reduce` there is no transition.
- **Grab target.** The transparent strip is `12 px` wide, so the thin thumb is as easy to grab as a wide one.
- **Colour.** The thumb is `--muted-foreground`: at least `7:1` on `--background`, `--card`, `--popover` and `--secondary` in Light, and at least `6.9:1` on the same surfaces in True Black (`#000000`). Both exceed the `3:1` needed for UI components.
- **Idle.** The bar is invisible while the area is idle and fades in (`150 ms`) while the pointer is over the area, while focus is inside it, while it scrolls (and for `800 ms` after), and during a drag.
- **Unchanged behaviour.** Wheel, touch, keyboard scrolling and focus work as before. The viewport is an explicit tab stop (`tabIndex=0`) in the parameter panel, the Settings panel and the gallery, as before. Regions that were plain `overflow` elements keep the browser's own rule (`tabStop={false}`), so no tab stop is added.
- **Regions.** Parameter panel, effect stack (both axes: the phone strip scrolls horizontally), library grid, Settings body and third-party notices, export sheet body, and the dev gallery page. Radix `Select` and `DropdownMenu` lists scroll natively and are the exception, because their positioning needs Radix's own viewport.

## 6. Layout

Viewport classes match [product.md section 4](docs/specs/product.md#4-platforms-and-support) and proof viewports match [workflow.md](docs/agents/workflow.md#proof):

- **Phone:** width `< 640 CSS px`, or height `< 500 CSS px` in landscape. Proof viewport: **`390 × 844`**.
- **Tablet:** width `640` to `1023 CSS px` (and height ≥ 500 px). Proof viewport: **`820 × 1180`**.
- **Desktop:** width `≥ 1024 CSS px` (and height ≥ 500 px). Proof viewport: **`1440 × 900`**.

All three layouts are built and checked at these viewport sizes in a desktop browser so a later mobile port needs no layout rework. Checking `390 × 844` and `820 × 1180` in a desktop browser verifies layout only and does not reproduce mobile canvas, memory, or storage limits.

All screens use `100dvh` height and `overflow-x: hidden` on the root shell so horizontal page scroll never occurs at any width (AC-F18.1). Resizing across viewport classes preserves the open project, selected instance, zoom, and pan without tearing down the canvas worker (AC-F18.2).

### 6.1 Library screen (all widths)

```
+-------------------------------------------------------------------+
| Drift          [Import images] [Guide] [Settings] |  <- 48/52 px
+-------------------------------------------------------------------+
| [Optional banner: Storage unavailable]                            |
+-------------------------------------------------------------------+
|  +---------------+  +---------------+  +---------------+          |
|  |  [thumbnail]  |  |  [thumbnail]  |  |  [thumbnail]  |          |
|  |  sunset   [...]  |  portrait [...]  |  street   [...]          |
|  |  4032x3024    |  |  3000x4000    |  |  1920x1080    |          |
|  |  Today        |  |  Yesterday    |  |  Nov 18       |          |
|  +---------------+  +---------------+  +---------------+          |
+-------------------------------------------------------------------+
```

- **Grid columns:** Phone (`390 × 844`): 2 columns, `12 px` gap, `12 px` page padding. Tablet (`820 × 1180`): 3 columns, `16 px` gap, `16 px` padding. Desktop (`1440 × 900`): `repeat(auto-fill, minmax(220px, 1fr))`, `16 px` gap, `24 px` padding.
- **Drag and drop (desktop, AC-F1.2):** Dragging files over the window displays a high-contrast dashed overlay (`"Drop images to open"`).
- **Card interaction (AC-F2.7):** Card body is a focusable button (`Enter` / `Space` opens project); overflow `⋯` button sits in the card footer with `Open`, `Rename`, `Duplicate`, `Delete`.

### 6.2 Editor screen: Desktop (`1440 × 900`)

```
+-----------------------------------------------------------------------------+
| <- Drift project-name                     [Export] [Guide] [Settings] |  48 px
+-----------------------------------------------------------------------------+
| [Undo][Redo] | [Presets] | [Compare][Split]            | + Add effect       |  40 px toolbar
+--------------------------------------------------------+ [=] Pixel sort [on]|  <- Stack
| [2 px render progress bar when > 300 ms]               | [=] Ch. shift [Off]|     (max 38% H,
|                                                        |                    |      ScrollArea)
|                     CANVAS STAGE                       +--------------------+
|                 (fluid: ~1100 x 812)                   | Pixel sort [Reset] |  <- Params
|                                                        | Show selection [o] |     (fluid H,
|                                                        | DIRECTION          |      ScrollArea)
|  [100% v]                   [Rendering full resolution]| Angle (dial) 45.0° |
|                                                        | SELECTION ...      |
+--------------------------------------------------------+--------------------+
                                                           <--- 340 px --->
```

### 6.3 Editor screen: Tablet (`820 × 1180`)

```
+---------------------------------------------------+
| <- Drift project-name  [Export] [Settings] |  52 px
+---------------------------------------------------+
| [Undo][Redo] | [Presets] | [Compare][Split]       |  40 px toolbar
+---------------------------------------------------+
| [2 px progress bar]                               |
|                                                   |
|                   CANVAS STAGE                    |
|                 (820 x ~728 px)                   |
|                                                   |
| [100% v]                              [Full res]  |
+======================[ === ]======================+  <- resize/collapse handle
| + Add effect            | Pixel sort      [Reset] |
| [=] Pixel sort     [on] | Show selection      [o] |
| [=] Channel shift [Off] | DIRECTION               |  <- Docked bottom panel
|                         | Angle   [dial]   45.0°  |     (360 px default,
|                         | SELECTION               |      resizable 240 px–50% H,
| <--- 260 px --->        | <--- fluid (560 px) --> |      collapsible to 48 px)
+-------------------------+-------------------------+
```

### 6.4 Editor screen: Phone (`390 × 844`)

```
+-------------------------------+
| <- Drift    [Exp] [Set]|  52 px + safe-area-top
+-------------------------------+
| [Undo][Redo] | [Presets] ...  |  40 px toolbar
+-------------------------------+
| [2 px progress bar]           |
|                               |
|         CANVAS STAGE          |  (≥ 40% viewport height at Half detent)
|                               |
| [100% v]                      |
+-------------------------------+
| [+][Pixel sort][Ch. shift Off]|  <- 48 px horizontal scrollable stack strip
+===========[  ===  ]===========+  <- Bottom sheet (Collapsed / Half / Expanded)
| Pixel sort            [Reset] |
| Show selection            [o] |
| DIRECTION                     |
| Angle        [dial]    45.0°  |
| ...                           |
+-------------------------------+  + safe-area-bottom
```

- **App bar and toolbar:** The app bar starts with the Drift icon (`/icons/icon.svg`, `24 px`, decorative with `alt=""`) immediately left of the `"Drift"` heading on every screen, after the back button where there is one. The app bar has no theme button (theme lives in Settings -> Appearance) and shows compact icon buttons (`Export`, `Guide`, `Settings`) on phone width. Undo, Redo, Presets, and Compare/Split live in the editor toolbar directly above the canvas.
- **Phone horizontal stack strip:** Each effect instance is a `44 px`-tall chip showing name, enabled switch/`"Off"` text, and tap-to-select; tapping the chip's `⋮` menu opens Move left, Move right, Duplicate, Remove. A pinned `+` chip opens Add effect.
- **Phone bottom sheet:** Starts at **Half** detent (capped so the canvas keeps at least `40%` of viewport height while a parameter is being adjusted), and cycles or drags between **Collapsed** (`56 px` + `env(safe-area-inset-bottom)`), **Half**, and **Expanded** (`80%` viewport height, dropping temporarily or remaining clear of the canvas when collapsed/half).
- **Phone landscape (`height < 500 CSS px`):** Switches the bottom sheet and stack strip into a collapsible `300 px` right drawer so the canvas keeps at least half the viewport width and full height.

## 7. Feature-specific visual specifications

- **Canvas rendering (F8, F13):** Displays the active `ImageBitmap` (or `2,048 × 2,048` tiles for `full` renders) on an `<canvas>` sized to `clientWidth * devicePixelRatio` × `clientHeight * devicePixelRatio`. Above 200% zoom, sets `ctx.imageSmoothingEnabled = false` so individual pixels stay crisp. Transparent areas render over the `--checker-a` / `--checker-b` `16 × 16 CSS px` checkerboard.
- **Compare and Split overlays (F11):**
  - When Compare toggle/hold is active, draw the `original` `settle` bitmap aligned to the exact same zoom and pan transform, and display a top-left pill `"Original"` (AC-F11.1).
  - In Split view, clip side A to `[0, splitX]` and side B to `[splitX, canvasWidth]` (vertical), or side A to `[0, splitY]` and side B to `[splitY, canvasHeight]` (horizontal), both under the same zoom and pan transform. Side A draws its rendered frame, or the source bitmap while its stack is empty or its first frame is pending. Draw a `2 px` line across the canvas (`#ffffff` with `1 px` `#000000` casing so it stays visible over any photo) and a `44 × 44 CSS px` circular grab handle at its midpoint (`role="separator"`, `aria-orientation` matching the line, `aria-label="Compare split position"`, `aria-valuemin="0"`, `aria-valuemax="100"`; `MoveHorizontal` and `ew-resize` when vertical, `MoveVertical` and `ns-resize` when horizontal).
  - Each side has a small pill reading `"Original"` while its stack is empty, otherwise `"A"` or `"B"`: side A top-left; side B top-right (vertical) or bottom-right (horizontal). In a horizontal split the `"Rendering full resolution"` pill moves to the top-right.
  - **Split side switcher** (`src/features/stack/split-side-switcher.tsx`): a `44 px` row at the top of the effects panel (desktop sidebar, tablet bottom panel, phone above the stack strip, landscape drawer), present only while the split view is on, and hidden with a collapsed panel or while the desktop History tab is shown. It holds the label `"Editing"`, an outline `ToggleGroup` (`"A · Left"` / `"B · Right"`, or `"A · Top"` / `"B · Bottom"`), and two ghost icon `Button`s with tooltips: `"Copy to other side"` (`Copy`) and `"Swap sides"` (`ArrowLeftRight`, or `ArrowUpDown` when horizontal). On portrait phone the Half detent shrinks by the row's height so the canvas keeps `40%` of the viewport.
  - **Toolbar:** the Split button's icon is `Columns2` (vertical) or `Rows2` (horizontal). Beside it, an icon button (`RotateCwSquare`) switches orientation; its name states the target, `"Switch to top/bottom view"` or `"Switch to left/right view"`.
- **Selection debug view (F6):** While `"Show selection"` is on for a `pixelSort` instance, show a top-left pill `"Selection preview (not exported)"`.
- **Effect stack row (F4):** Shows drag grip (`GripVertical`), effect label, enabled `Switch`, and when off displays BOTH an `EyeOff` icon and the text `"Off"` (AC-F4.2). An unknown or newer-version instance renders with a dashed border, label `"Unsupported effect (<type> v<version>)"`, no parameter controls, and only Move up / Move down / Remove menu items (AC-F4.6).
- **Export dialog (F12):**
  - Format: `ToggleGroup` showing `PNG`, `JPEG`, `WebP` (omitted when startup `convertToBlob` probe fails, AC-F12.2), `AVIF`, `BMP`, and `TIFF`.
  - Quality: `Slider` + `Input` (`50` to `100`), shown only for `JPEG`, `WebP` (default `92`) and `AVIF` (default `80`, its own value).
  - Size: `ToggleGroup` (`Full`, `1/2`, `1/4`, `Custom`). Choosing `Custom` reveals a `"Longest side (px)"` numeric input capped at `max(sourceWidth, sourceHeight)`. Below the control, display exact output dimensions computed by `renderSize` (e.g. `"2000 × 1500 px"`).
  - Side: shown first, only when side A has effects: `ToggleGroup` with the same two labels as the split side switcher, B selected on every open.
  - Filename: text `Input` prefilled `<project name>-<YYYYMMDD-HHmmss>.<ext>`.
  - Actions: `"Download"` primary button, `"Share"` secondary button (shown only when `navigator.canShare?.({files: [...]})` is true), and during export a `Progress` bar with stage label (`Decoding`, `Rendering`, `Encoding`) and `"Cancel"` button (AC-F12.4).
- **Settings and About (F14, F15, F16):**
  - Appearance: Theme `ToggleGroup` (`System`, `Light`, `True Black`).
  - Storage: `"Using <used> of <quota>"` (AC-F16.1), persistence status + `"Request protection"` button, and a short note that Private Browsing does not retain data after closing.
  - App installation: `"Install app"` button when `beforeinstallprompt` is captured (desktop Chromium).
  - About: App version, credit line `"Pixel sorting lineage: inspired by Kim Asendorf's ASDFPixelSort."` (licensing.md), and `"Third-party notices"` expandable section listing each bundled package with its version and licence, and a `"Full licence texts"` link to the same-origin file `THIRD-PARTY-NOTICES.txt` (no licence text in the app's JavaScript).

### 7.1 On-canvas tool slot (reserved for later)

Designed now so future interactive tools (such as painting a mask or drawing a sort path) plug in without changing the parameter panel or the three responsive layouts. Not built in the first release.

- **Placement:** An optional floating tool strip docked inside the canvas stage (top-left on desktop and tablet, above the stack strip on phone), rendered only when the selected effect instance has a registered canvas tool binding ([engine.md section 4.7](docs/specs/engine.md#47-on-canvas-tool-slot-reserved-for-later)).
- **Overlay and input:** The canvas stage reserves a transparent pointer-event overlay layer aligned to the same zoom and pan transform as the photo canvas. When an on-canvas tool is active, pointer events route to the tool handler; holding `Space` (or switching back to the pan/hand tool) temporarily restores canvas pan.
- **No impact on schema-driven effects:** Effects without a registered canvas tool render no tool strip and keep the default pan-on-drag canvas behaviour.

### 7.2 Post-v0.1.0 UI specifications (F20, F23, F24)

- **Geometry tools (F20):**
  - Entry point: a `"Transform"` toggle button (`Crop` icon, `aria-pressed`) in the editor toolbar, with its text on desktop and tablet and icon-only on phones, where `"Presets"` is icon-only too so the toolbar fits a `390 px` touch screen. Activating it shows the Geometry panel (`src/features/transform/`) in place of the Parameter panel and starts crop mode. It also shows the Stack tab on desktop and tablet and opens a collapsed panel, sheet or drawer; the portrait phone sheet is headed `"Transform"`, so there the panel's own title is for screen readers only and the close button ends the orientation row. The panel closes with the toggle, its `"Close transform panel"` button, selecting or adding an effect, or leaving the editor.
  - Orientation row: four icon buttons (`RotateCcw` `"Rotate 90° counter-clockwise"`, `RotateCw` `"Rotate 90° clockwise"`, `FlipVertical2` `"Flip horizontal"`, `FlipHorizontal2` `"Flip vertical"`; Lucide names the flip icons by the mirror line), each committing immediately as one history entry, in or out of crop mode. The crop box and the resize turn with the image, and a ratio switches to its turned form (`16:9` to `9:16`), or to `Free` when it has none.
  - Crop section: aspect-ratio `Select` (`Free`, `Original`, `1:1`, `4:3`, `3:4`, `3:2`, `2:3`, `16:9`, `9:16`, `4:5`) and numeric `X`, `Y`, `Width`, `Height` inputs (`Enter` or blur sets the box; typing a width or height switches the ratio to `Free`). In crop mode: `"Apply crop"` primary and `"Cancel"` outline buttons. Out of it: an `"Edit crop"` outline button; choosing a ratio or typing in a field also starts crop mode. A `"Reset crop"` ghost button saves the full image at once, as one history entry.
  - Applying a crop that changes the cropped width or height removes the resize, and the panel says so beforehand. Undo, redo and a history jump drop an unapplied box and show the saved one.
  - Resize section: unit `ToggleGroup` (`px` | `%`), `Width` and `Height` inputs with an aspect-lock `Button` (`"Lock aspect ratio"`, `aria-pressed`, default on), resampling `Select` (`Lanczos-3`, `Bilinear`, `Nearest`), `"Apply resize"` primary button and `"Reset resize"` ghost button. `Enter` in a field applies. The new size is shown under the fields. Errors appear inline as the user types and nothing is saved: `"Maximum output size is 50 MP (50,000,000 px) and 16,384 px per side."`, `"Enter whole numbers of at least 1."` or `"Enter a percentage from 1 to 1000."`. While the crop box has unapplied changes the section is disabled with the note `"Apply or cancel the crop first."` Applying a resize ends crop mode.
  - **Crop mode canvas:** the whole rotated and flipped image without effects, fitted with a margin for the handles. Zoom and pan work, are not saved, and the saved view returns afterwards. The image is the preview proxy, so very large photos are softer when zoomed in. The mode ends with Apply, Cancel, a resize, closing the panel, or the desktop History tab.
  - **Split view and Compare in crop mode:** both are suspended. Their buttons and the orientation button are disabled, `\`, `S` and `Shift+S` do nothing, a latched Compare is released, and no split divider or side labels are drawn. The saved split preference does not change and applies again when crop mode ends.
  - On-canvas crop box (section 7.1 overlay layer): `1 px` `#ffffff` border with `1 px` `#000000` casing, dimmed mask over the image outside it (`rgba(0, 0, 0, 0.55)`), rule-of-thirds guides while dragging, and 8 focusable corner and edge handles (`44 × 44 px` hit area on coarse pointer, `24 × 24 px` on fine pointer) plus a focusable `"Move crop box"` control. Drag a handle to resize, drag inside the box to move it, drag outside to pan; a box that covers the whole image cannot move, so dragging it pans, as does holding `Space`.
- **Project change history panel (F23):**
  - **Desktop (`1440 × 900`):** Second tab in the right sidebar `Tabs` bar alongside Stack: `[Stack | History]`. Selecting `History` replaces the Stack + Parameters area with a full-height `ScrollArea` listing commits newest-first (`Initial` at bottom).
  - **Tablet (`820 × 1180`):** Second tab in the left column of the docked bottom panel (`[Stack | History]`).
  - **Phone (`390 × 844`):** `"History"` button in the editor toolbar, opening the History list in a `Sheet`.
  - **Row anatomy:** Single-line truncated action label (`13 px` sans, `font-medium`), relative or short timestamp (`12 px` `text-muted-foreground`), `2 px` `--accent` left border and `"Current"` `Badge` on the active row (`aria-current="step"`). Entries with `seq > historyHeadSeq` render their label in `text-muted-foreground`, with `"Redo step"` for screen readers, to show they belong to the redo branch and will be discarded on a new commit. No opacity is applied, because dimmed text fails the 4.5:1 contrast minimum. Each row is a native `<button>` so `Tab` and `Enter`/`Space` jump directly to that state. The timestamp is the clock time for today's entries, and `"Yesterday"` or a short date for older ones.
  - The phone `Sheet` (bottom in portrait, right in landscape) stays open after a jump, so several entries can be tried in a row.
- **App changelog (F24):**
  - Placed in Settings -> About (`src/features/settings/settings-content.tsx`) directly below `"Third-party notices"`, using the same collapsible pattern (`"Changelog"` + `"View changelog"` / `"Hide changelog"` button with `aria-expanded` and `aria-controls`), rendering the bundled `CHANGELOG.md` text in a scrollable container.
- **Project files (F25):**
  - **Library card menu (`src/features/library/project-card.tsx`):** Add `"Save project file"` (`Download` or `Archive` icon) below `"Duplicate"` and above the separator before `"Delete"`.
  - **Editor (`src/features/toolbar/editor-toolbar.tsx` / phone overflow):** Add `"Save project file"` action reachable from the editor toolbar (desktop/tablet) and phone top-bar overflow (`⋮`).
  - **Save project file dialog:** Compact `Dialog` (desktop/tablet) / `Sheet` (phone) with project name summary, `"Include undo history"` checkbox (default checked), `"Save"` primary button, and during assembly a `Progress` bar with `"Cancel"`.
  - **Open project file (`src/features/import/`):** `"Open images"` file picker (`use-image-picker.ts`) accepts `.glproj` and `.zip` alongside image formats. Window-wide drag-and-drop (`window-file-drop.tsx`) updates the drop overlay copy (`drop-overlay.tsx`) to `"Drop images or project files to open"`. Error messages use the existing `ImportProblemDialog`.
- **Full backup and restore (F17):**
  - **Settings -> Storage (`src/features/settings/settings-content.tsx`):** Add a `"Backup & restore"` row below the persistence controls with `"Export backup"` and `"Import backup"` outline buttons.
  - **Library app bar (`src/app/app-bar-actions.ts`):** Add a compact overflow menu button (`⋮`, `aria-label="Library actions"`) next to Settings with `"Export backup"` and `"Import backup"`.
  - **Export backup dialog:** `Dialog` (desktop/tablet) / full-height `Sheet` (phone) with `"Select all"` / `"Select none"`, scrollable project checkbox list (project name, `W × H px`), `"Include undo history"`, `"Include user presets"`, `"Include settings"`, estimated size readout, `"Export backup"` primary button, and progress bar with `"Cancel"` while packing.
  - **Import backup dialog:** Two-step modal: validating progress state (with `"Cancel"`), followed by a selection view with a `ToggleGroup` for `"Merge"` / `"Replace"`, scrollable project checkbox list (name, `W × H px`, size, status `Badge` `"New"` / `"Unchanged"` / `"Modified locally"`), presets and settings checkboxes, `"Import"` primary button, and a destructive `AlertDialog` confirmation when `"Replace"` is chosen.
- **Image blend parameter control (`kind: 'image'`, F26):**
  - Rendered by `ImageControl` (`src/features/params/image-control.tsx`) inside `ParamControl` (`src/features/params/param-control.tsx`).
  - Layout: `48 × 36 px` rounded thumbnail preview (or muted placeholder icon with `"No image selected"`), dimensions metadata (`W × H px`), `"Choose image"` outline button, and `"Clear"` icon button (`X`, shown when an image is set).
  - Clicking `"Choose image"` opens a `Popover` (desktop/tablet) / `Sheet` (phone) with two options: `"From device"` (opens native image file picker with F1 validation/50 MP flow) and `"From library"` (scrollable grid of existing library project thumbnails to reuse a stored `SourceRecord` without duplicating bytes).
  - If the referenced source is missing (`'missing-source'` warning), displays a destructive-text inline note `"Missing image"` beside `"Choose image"`.

### 7.3 Guide screen and welcome card (F27)

- **App bar:** a ghost icon `Button` with `CircleHelp` (`aria-label="Guide"`, tooltip `"Guide (?)"`) before Settings on the Library and Editor. On the Guide, a back arrow on the left and Settings on the right.
- **Layout:** one `ScrollArea` for the page. At `>= 1024 px` a `224 px` contents column, sticky at the top, beside a text column of at most `68ch`. Below that, a sticky bar with a full-width outline `Button` `"Contents"` (`aria-expanded`) that opens the list; the list scrolls inside `60dvh`.
- **Contents:** plain full-width buttons with hover fill on `--secondary`; `32 px` tall, `44 px` on coarse pointer. Activating one scrolls the section into view without animation and focuses its heading.
- **Type:** page title `24 / 32` semibold (`h2`), section titles `18 / 24` semibold (`h3`), effect names `16 / 24` (`h4`), body `14 / 24`.
- **Effects reference:** one bordered `--card` block per effect with a definition list of parameters, divided by `1 px` `--border`. Keys in the shortcut table use `kbd` with `--secondary` fill and the mono font.
- **Welcome card:** `Card` at most `448 px` wide below the empty-state column: title `"Welcome to Drift"`, one line of text, outline `"Import a photo"`, ghost `"Read the guide"`, and a ghost icon button `"Dismiss welcome"` at the top right. Dismissing moves focus to the `"No projects yet"` heading.

## 8. Interaction: touch, pointer and keyboard

### 8.1 Canvas gestures (F13)

- **Zoom bounds:** `minZoom = 0.1 * fitZoom`, `maxZoom = 32` (`3200%`).
- **Pan clamp (AC-F13.3):** After every pan or zoom update, clamp `centerX` and `centerY` so at least `64 CSS px` of the rendered image remains inside the canvas viewport on every edge.
- **Pointer (desktop/tablet with mouse or trackpad):**
  - Drag on canvas: pan (`grab` / `grabbing` cursor).
  - `Ctrl` / `Cmd` + wheel, or trackpad pinch (`wheel` with `ctrlKey`): zoom continuously around the pointer position.
  - Plain wheel: pan vertically (and horizontally with trackpad two-finger scroll or `Shift + wheel`).
  - Double-click: toggle between `Fit` and `100%` centered on the clicked point.
- **Touch (phone/tablet):**
  - Single-finger drag: pan.
  - Two-finger pinch: continuous zoom and pan around the finger midpoint at 60 fps (`touch-action: none` on the canvas element, direct `requestAnimationFrame` redraw without React re-renders, AC-F13.1).
  - Double-tap: toggle between `Fit` and `100%` centered on the tap point.
- **Zoom control (AC-F13.2):** Shows current zoom rounded to nearest integer percent (e.g. `"100%"`); activating opens a menu with `Fit`, `50%`, `100%`, `200%`, `400%`.

### 8.2 Compare hold vs toggle (F11)

- **Pointer / touch on Compare button:** `pointerdown` starts a `300 ms` timer and immediately shows the source image. If `pointerup` occurs before `300 ms`, Compare toggles its latched state (`on ↔ off`). If held ≥ `300 ms`, releasing returns to the edited result (AC-F11.2).
- **Keyboard `\`:** Same `300 ms` hold-vs-toggle rule (`keydown` without `repeat` starts timer; `keyup` < 300 ms toggles, ≥ 300 ms releases back to result).

### 8.3 Keyboard shortcuts

Shortcuts do not trigger while focus is inside `<input>`, `<textarea>`, `<select>`, or `[contenteditable]`, except Undo/Redo (`Ctrl/Cmd+Z`) which let native text undo work inside text inputs.

| Shortcut | Scope | Action |
|---|---|---|
| `?` | Anywhere except text fields and open dialogs | Open the Guide (F27) |
| `Ctrl+Z` / `Cmd+Z` | Editor | Undo last commit (AC-F9.1) |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` / `Ctrl+Y` | Editor | Redo commit (AC-F9.1) |
| `\` | Editor | Toggle Compare (tap) or peek Original (hold > 300 ms) (F11) |
| `S` | Editor | Toggle Split compare view (F11) |
| `Shift+S` | Editor | Switch between left/right and top/bottom split, turning the split view on (F11) |
| `+` / `=` and `-` | Editor | Zoom in / out by factor of 2 around canvas centre (F13) |
| `0` | Editor | Zoom to Fit (F13) |
| `1` | Editor | Zoom to 100% (F13) |
| `Arrow` keys | Canvas focused | Pan by 10% of viewport width/height (F13) |
| `ArrowLeft` / `ArrowRight` (`+ Shift`) | Vertical split divider focused | Move split divider by 1% (10% with Shift) (AC-F11.3) |
| `ArrowUp` / `ArrowDown` (`+ Shift`) | Horizontal split divider focused | Move split divider by 1% (10% with Shift) (AC-F11.6) |
| `Arrow` keys (`+ Shift`) | Slider focused | Change value by 1 step (10 steps with Shift); burst with ≤ 500 ms gaps creates 1 commit (AC-F5.4) |
| `Arrow` keys (`+ Shift`) | Crop handle focused | Move that side of the crop box by 1 px (10 px) (F20) |
| `Arrow` keys (`+ Shift`) | Crop box focused | Move the crop box by 1 px (10 px) (F20) |
| `Enter` / `Escape` | Crop mode (canvas or crop box; `Escape` anywhere outside text fields and open menus) | Apply / cancel the crop (F20) |
| `Space` held while dragging | Crop mode | Pan instead of moving the crop box (F20) |
| `Alt+ArrowUp` / `Alt+ArrowDown` | Effect stack row focused | Move selected effect instance up / down 1 position (AC-F4.3) |
| `Escape` | Any modal / menu / sheet | Close overlay and restore focus to its trigger |

## 9. Empty, loading and error states

| State | Trigger | Presentation and exact copy | Actions |
|---|---|---|---|
| Empty library (AC-F2.1) | 0 projects stored | Centered column: heading `"No projects yet"`, note `"Images stay on this device."` | `"Open images"` (primary); the welcome card on a first launch, afterwards the link `"New here? Read the guide"` (section 7.3) |
| Empty effect stack | New project or all effects removed | Centered note in stack panel: `"No effects yet"` | `"Add effect"`, `"Browse presets"` |
| Render in progress (AC-F8.3) | Preview render running > 300 ms | Thin `2 px` `--accent` progress bar pinned to top of canvas stage | Disappears on finish or cancel |
| Full-resolution render (AC-F8.4) | Zoom > 1.25× settle proxy | Compact pill at bottom-left of canvas: `"Rendering full resolution"` | Disappears on finish or cancel (AC-F8.5) |
| Worker crash (engine.md section 11) | 2nd worker crash within 60 s | Centered error card over canvas stage: `"Rendering stopped unexpectedly."` | `"Retry"`, `"Reset effects"` |
| Insecure context (product.md section 4) | `!window.isSecureContext` | Full-screen blocking card: `"Secure connection required"` + `"Open Drift over HTTPS or http://localhost so browser storage and offline features can work."` | none |
| Unsupported image format (AC-F1.3) | Browser cannot decode file | Error toast / dialog: `"Can't open <file name>: the browser can't read this image format."` | `"Dismiss"` |
| HEIC / HEIF file (AC-F21.4) | HEIC/HEIF extension or header | Same dialog: `"Can't open <file name>: HEIC/HEIF is not supported in this browser. Convert it to JPEG, PNG, or WebP first."` | `"Dismiss"` |
| Camera RAW file (AC-F21.4) | RAW extension or header | Same dialog: `"Can't open <file name>: RAW camera files are not supported. Export a TIFF, PNG, or JPEG from your RAW converter first."` | `"Dismiss"` |
| Animated input (AC-F21.3) | Animated GIF, WebP, APNG, or AVIF imported | Non-blocking toast: `"Imported the first frame of <file name>. Animation is not supported yet."` | none |
| Image too large (AC-F1.4) | Longest side > 16,384 px or file size > 200 MB | Error dialog: `"Image too large: the longest side is <N> px; the limit is 16,384 px."` (or file-size equivalent) | `"Dismiss"` |
| Large image over 50 MP (AC-F1.5) | Image > 50 MP (50,000,000 px) within longest-side and file-size limits | `AlertDialog`: explains the 50 MP guaranteed maximum and that larger files may fail to export | `"Import at 50 MP"` (primary), `"Import anyway"` (secondary), `"Cancel"` |
| Deleted project link (AC-F3.5) | Open `#/p/<deleted-id>` | Library screen + toast: `"That project no longer exists."` | none |
| Storage full (AC-F16.2) | Quota pre-flight fail or `QuotaExceededError` | `AlertDialog`: `"Storage is full"` + explanation that no partial project was saved | `"Manage library"` |
| Storage unavailable (AC-F16.4) | IndexedDB cannot open | Persistent top banner: `"Storage unavailable: nothing will be saved after you close this tab."` | none |
| Export out of memory (engine.md section 11) | Worker returns `out-of-memory` | Inline error inside Export dialog: `"Not enough memory to export at this size. Try 1/2 or 1/4 size."` | Switch size preset, retry |
| PWA update ready (AC-F15.3) | New service worker waiting | Persistent non-blocking toast: `"A new version is ready."` | `"Reload to update"`, `"Later"` |

## 10. Accessibility

Target: **WCAG 2.2 Level AA** for all UI outside the user's photo (F19).

- **Semantic structure:** Every screen uses landmark elements (`<header>`, `<main>`, `<aside>` or named `<section>`), a single `<h1>`, and logical DOM reading order matching visual layout.
- **Keyboard completeness (AC-F19.1):** The entire core loop (importing via keyboard-activated file input, adding an effect, tuning every parameter including angle and range, reordering the stack, undoing/redoing, comparing, moving the split divider, zooming/panning, and exporting) works without a pointer. Every drag or hover interaction has a keyboard equivalent.
- **Focus visibility and management:** `:focus-visible` renders `2 px solid rgb(var(--ring))` with `2 px` offset on every interactive control. Opening a dialog or menu traps or moves focus inside; closing returns focus to the triggering element. Deleting a project card or effect row moves focus cleanly to the next sibling (or the Add/Open button if empty).
- **Accessible names and tooltips:** Every icon-only button has an explicit `aria-label`. Undo and Redo buttons include the target commit label in both `aria-label` and tooltip, for example `"Undo Angle 90°"` and `"Redo Add Pixel sort"` (AC-F9.2).
- **Status announcements (AC-F19.3):** One visually hidden live region (`role="status" aria-live="polite" aria-atomic="true"`) announces `"Rendering"`, `"Rendered"`, `"Export finished: <file name>"`, and undo/redo results. Throttled so rapid `drag` renders do not spam assistive tech (announce on `settle` and `full` transitions).
- **Pointer and coarse-pointer sizing:** Minimum `24 × 24 CSS px` interactive targets on desktop (`@media (pointer: fine)`), and minimum `44 × 44 CSS px` targets plus `16 px` font size on text/numeric inputs under `@media (pointer: coarse)` so responsive layouts stay ready for touch devices.
- **Reduced motion (AC-F19.4):** Under `@media (prefers-reduced-motion: reduce)`, all sheet transitions, toast slides, zoom easing, and spinner/progress animations become instant state updates (`transition-duration: 0.01ms`).
- **Automated verification (AC-F14.3, AC-F19.2):** CI runs Playwright with `@axe-core/playwright` checking zero serious/critical/moderate WCAG 2.2 AA violations on the Library, Editor, Export dialog, Settings, and Guide screens in both Light and True Black themes at `390 × 844`, `820 × 1180`, and `1440 × 900`.
