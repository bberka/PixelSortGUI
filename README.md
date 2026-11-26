# PixelSortGUI

PixelSortGUI is an editor for glitch art and pixel sorting of still photos. It runs entirely in your browser, works offline, and needs no account. Your photos never leave your device. Projects are saved in browser storage.

## What works today

- Import photos with a file picker or by dragging files onto the window. Several files can be imported at once. Any format your browser can decode works, such as JPEG, PNG, WebP, GIF (first frame), BMP and AVIF. Images over 16,384 pixels on the longest side or over 200 MB are refused. Images over 50 megapixels offer a choice to import at 50 megapixels or import anyway.
- Library of saved projects with thumbnails. Open, rename, duplicate and delete a project.
- Effect stack: add effects, turn each one on or off, reorder, duplicate and remove them.
- Pixel sort effect: sort direction by angle, selection by threshold range, edges or whole line, interval length with jitter and skip chance, sort key (luma, lightness, value, saturation, hue, red, green, blue), order (ascending, descending, shuffle, random direction), and fill (sort, average, gradient).
- Channel shift effect: move the red, green and blue channels by separate offsets, with stretch or wrap at the edges.
- Undo and redo, by toolbar buttons and by Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. History holds 200 steps and survives a reload.
- Presets: six built-in ones, and your own saved from the current stack. Apply one, add one to the stack, rename or delete your own.
- Parameter panel built from each effect's definition: sliders, a range slider, an angle control, switches, choice lists, a random seed, exact number entry, per-parameter reset, "Reset all" and a "Randomize" button that gives every parameter a random valid value. Each effect also has a mix amount and a blend setting.
- Preview canvas with zoom (including a Fit option) and pan, by wheel, keyboard and touch pinch.
- Compare view: toggle or hold Compare (button or `\`) to view the original image, and split view (`S`) with a draggable and keyboard-operable vertical divider.
- Export as PNG, JPEG or WebP (WebP only where the browser can encode it). JPEG and WebP have a quality setting. Size is full, half, quarter or a custom longest side. You can set the file name.
- Settings: theme (System, Light or True Black), storage usage and storage protection status, and links to the source code, issue tracker, licence and releases, the list of bundled third-party packages, and a link to their full licence texts.

## Not there yet

These are planned and not in the app.

- Offline install as an app and update prompt.
- Crop and resize.
- More effects.
- More import and export formats.
- Project files and backup and restore.

The order of work is in [roadmap.md](docs/specs/roadmap.md) and the feature list is in [product.md](docs/specs/product.md).

## Try it

The planned address is https://glitch.bbay.dev. It is not live yet because its DNS record is not set up.

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

Report bugs and ideas in the [issue tracker](https://github.com/bberka/PixelSortGUI/issues).

## Credits

Pixel sorting as a glitch technique comes from Kim Asendorf's ASDFPixelSort. The app's Settings screen says: "Pixel sorting lineage: inspired by Kim Asendorf's ASDFPixelSort." Notices for third-party packages are in the app under Settings, with the full licence texts in `THIRD-PARTY-NOTICES.txt` served by the app (also in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).

## Licence

MIT. See [LICENSE](LICENSE).
