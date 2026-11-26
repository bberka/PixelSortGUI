<h1><img src="public/icons/icon.svg" alt="Drift icon" width="32" height="32" align="center" /> Drift</h1>

Drift is an editor for glitch art and pixel sorting of still photos. It runs entirely in your browser, works offline, and needs no account. Your photos never leave your device. Projects are saved in browser storage.

## What works today

- Import photos with a file picker or by dragging files onto the window. Several files can be imported at once. Any format your browser can decode works, such as JPEG, PNG, WebP, GIF, BMP and AVIF, and TIFF works too (the first page; 16-bit samples are reduced to 8-bit). An SVG is converted to a still image at its stated pixel size, or 2,048 pixels on its longest side if it states none; links to outside files in it are not loaded. An animated GIF, WebP, APNG or AVIF imports its first frame and shows a notice. HEIC/HEIF and camera RAW files are refused with a message saying what to convert them to. Images over 16,384 pixels on the longest side or over 200 MB are refused. Images over 50 megapixels offer a choice to import at 50 megapixels or import anyway.
- Library of saved projects with thumbnails. Open, rename, duplicate and delete a project.
- Effect stack: add effects, turn each one on or off, reorder, duplicate and remove them.
- Pixel sort effect: sort direction by angle, selection by threshold range, edges or whole line, interval length with jitter and skip chance, sort key (luma, lightness, value, saturation, hue, red, green, blue), order (ascending, descending, shuffle, random direction), and fill (sort, average, gradient).
- Channel shift effect: move the red, green and blue channels by separate offsets, with stretch or wrap at the edges.
- Channel swap effect: reassign the red, green and blue channels in any of the six orders.
- Slice shift effect: shift random bands of rows or columns sideways, with a band size range, a probability, a maximum offset, wrap or stretch at the edges, and a seed.
- Block shuffle effect: swap a random share of square tiles with other tiles, with a tile size, an amount and a seed.
- Posterize effect: reduce colour depth to a set number of levels per channel or by dropping low bits, with an optional monochrome output.
- Scanline wave effect: displace rows or columns along a sine, triangle, square or sawtooth wave, with amplitude, wavelength, phase, per-line jitter with a seed, and wrap or stretch at the edges.
- Undo and redo, by toolbar buttons and by Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. Each step is named after the change, for example "Angle 90°". History holds 200 steps and survives a reload.
- History panel: a list of every step, newest first. Select one to jump to it. Later steps stay listed until you make a new change. It is a History tab on desktop and tablet, and a History button in the toolbar on phones.
- Presets: eight built-in ones, and your own saved from the current stack. Apply one, add one to the stack, rename or delete your own.
- Parameter panel built from each effect's definition: sliders, a range slider, an angle control, switches, choice lists, a random seed, exact number entry, per-parameter reset, "Reset all" and a "Randomize" button that gives every parameter a random valid value. Each effect also has a mix amount and a blend setting.
- Preview canvas with zoom (including a Fit option) and pan, by wheel, keyboard and touch pinch.
- Compare view: toggle or hold Compare (button or `\`) to view the original image, and split view (`S`) with a draggable and keyboard-operable vertical divider.
- Responsive editor layouts: a fixed right sidebar on desktop, a resizable and collapsible docked bottom panel on tablet, a horizontal stack strip with a three-detent bottom sheet on portrait phone, and a collapsible right drawer on landscape phone.
- Export as PNG, JPEG, WebP (WebP only where the browser can encode it), BMP or uncompressed TIFF. JPEG and WebP have a quality setting. Size is full, half, quarter or a custom longest side, with an optional output file-size limit (compressing JPEG/WebP quality and scaling dimensions as needed). You can set the file name.
- Settings: theme (System, Light or True Black), storage usage and storage protection status, an "Install app" button when the browser offers installation, and links to the source code, issue tracker, licence and releases, the list of bundled third-party packages, a link to their full licence texts, and a changelog that works offline.
- A built-in guide (the question-mark button, Settings, or the `?` key) with a quick start, a reference of every effect and its settings, keyboard shortcuts, and storage and privacy notes. It works offline. A welcome card on the first launch points to import and the guide.
- Offline use and installable PWA: after the first visit, the app loads, edits and exports offline via a precached service worker. When a new version is ready, a "Reload to update" toast appears without interrupting active edits.

## Not there yet

These are planned and not in the app.

- Crop and resize.
- More effects.
- AVIF export.
- Project files and backup and restore.

The order of work is in [roadmap.md](docs/specs/roadmap.md) and the feature list is in [product.md](docs/specs/product.md).

## Try it

The planned address is https://drift.bbay.dev. It is not live yet because its DNS record is not set up.

To run it locally you need Node 22.18 or later (or 24.11 or later) and pnpm 12.15.0. The `vp` command comes from Vite+, which is a dev dependency, so `pnpm install` provides it. If `vp` is not on your path, put `pnpm exec` in front of the commands below.

```sh
pnpm install
vp run dev
```

`vp run dev` starts the development server. `vp run gui` builds the production version and serves it at http://localhost:4173.

## Supported browsers

- Desktop Chrome and Edge 120 or later, and Firefox 128 or later.
- Safari is best effort and is not tested.
- Phones and tablets get responsive layouts but are not part of acceptance testing.

## Privacy

The app makes no network requests at runtime and has no analytics. Exported files carry no EXIF or GPS data.

## Development

- `vp run check` runs lint, type check and unit tests.
- `vp run build` makes the production build in `dist/`.
- `vp run test:e2e` runs the Playwright tests on Chromium and Firefox. Run `vp run browser:install` first.

AI agents do the development under the rules in [AGENTS.md](AGENTS.md). Every pull request lists the models that worked on it.

- Specs: [docs/specs/](docs/specs/)
- Design: [DESIGN.md](DESIGN.md)
- Domain words: [CONTEXT.md](CONTEXT.md)
- Research on existing tools and engine options: [docs/research/](docs/research/)

## Contributing and reporting problems

Report bugs and ideas in the [issue tracker](https://github.com/bberka/drift/issues).

## Credits

Pixel sorting as a glitch technique comes from Kim Asendorf's ASDFPixelSort. The app's Settings screen says: "Pixel sorting lineage: inspired by Kim Asendorf's ASDFPixelSort." Notices for third-party packages are in the app under Settings, with the full licence texts in `THIRD-PARTY-NOTICES.txt` served by the app (also in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).

## Licence

MIT. See [LICENSE](LICENSE).
