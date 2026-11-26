# Changelog

## Unreleased

- New effect: Mirror fold, which mirrors or folds the image left to right, top to bottom, four ways or as a kaleidoscope.
- New effect: Bayer dither.
- New effect: RGB noise, which adds colour or monochrome noise and dead or hot pixels.
- New effect: Threshold invert, which inverts channels inside a key range and can show the selection.
- New effect: JPEG crush, which crushes blocks like a badly saved JPEG and can corrupt some of them into colour glitches.

## v0.2.0

Adds geometry tools, five effects, more image formats, a history panel, a stack for each side of the split view and a built-in guide.

### Geometry

- Rotate, flip, crop with an on-canvas box, and resize, under "Transform" in the editor. The original photo is never changed, and each change can be undone.

### Effects and presets

- New effects: Slice shift, Channel swap, Block shuffle, Scanline wave and Posterize.
- New built-in presets: VHS split and Tile scramble.

### Compare and split view

- Each side of the split view has its own effect stack. Copy one side to the other, swap them, or export either side.
- Split left and right or top and bottom (Shift+S).

### History

- History panel that lists every step and jumps to any of them.
- Steps are named after the change, for example "Angle 90°".

### Import and export

- Import TIFF files (first page) and SVG files.
- Animated GIF, WebP, APNG and AVIF files import their first frame and say so.
- HEIC and camera RAW files are refused with a message saying what to convert them to.
- Export as AVIF, BMP and TIFF.

### App

- Built-in guide (question-mark button or the ? key) and a welcome card on first launch.
- Release notes in Settings, under About.
- Larger toolbar buttons on touch screens.

### Fixes

- Zoom and pan are no longer reverted when an edit or undo happens while they are being saved.

## v0.1.0

First release of Drift, an offline editor for glitch art and pixel sorting of still photos.

### Photos and library

- Import photos with the file picker or by drag and drop, several at once. Very large images ask before import or are refused.
- Library of saved projects with thumbnails: open, rename, duplicate and delete.
- Projects, edits and undo history are saved in browser storage and restored after a reload.

### Editing

- Effect stack: add, turn on or off, reorder, duplicate and remove effects.
- Pixel sort effect with direction, selection, interval, sort key, order and fill controls.
- Channel shift effect that moves the red, green and blue channels separately.
- Parameter controls with exact number entry, reset, random seed and a Randomize button.
- Built-in presets and your own saved presets. Replacing existing effects asks first.
- Undo and redo, with up to 200 steps.

### Preview and export

- Preview with zoom, pan and pinch.
- Compare with the original, by toggle, hold or split view.
- Export as PNG, JPEG or WebP, with size choices and an optional file-size limit.

### App

- Layouts for phone, tablet and desktop widths.
- System, Light and True Black themes.
- Works offline after the first visit and can be installed as an app.
- Storage usage and storage protection status in Settings.
- Keyboard and screen reader accessibility improvements.
- Open-source links and third-party notices with full licence texts.
- Photos stay on your device. No accounts and no analytics.
