# Changelog

## v0.3.0

Adds project files, backup and restore, blending a second image, six more effects, a new start screen and a new editor on phones.

### Project files and backup

- Project files: save a project, with or without its undo history, as one `.glproj` file from the Library or the editor, and open it again with the import picker or by dropping it on the window. Nothing is uploaded.
- Backup and restore: export your Library, presets and settings to one ZIP file and import it on this or another device, merging or replacing. Find it in Settings under Storage, in the Library's top right menu and in the phone editor's menu, or drop the file on the window.

### Effects

- New effect: Image blend, which mixes a second picture into a project with blend modes, opacity and placement. Choose the picture from your device or from another project in the library; a project can use up to 8.
- New effect: Mirror fold, which mirrors or folds the image left to right, top to bottom, four ways or as a kaleidoscope.
- New effect: Bayer dither.
- New effect: RGB noise, which adds colour or monochrome noise and dead or hot pixels.
- New effect: Threshold invert, which inverts channels inside a key range and can show the selection.
- New effect: Pixel smear, which drags selected pixels along an angle in fading trails.
- New effect: JPEG crush, which crushes blocks like a badly saved JPEG and can corrupt some of them into colour glitches.

### Start screen

- A new start screen while the library is empty: drop photos or open them, try a built-in sample picture, or pick one of four effect previews to see it applied. It replaces the welcome card.

### Phones and touch screens

- A new editor on phones. The photo stays large while you edit: pick a control by name and drag it, or open all of them. The toolbar has labels and sits under the photo, only the selected effect shows its switch and menu, and "Apply crop" is in view as soon as you open Transform.
- On touch screens, swiping the controls up or down scrolls them without changing a slider.
- Keyboard shortcuts are no longer shown on phones and tablets. On computers they are in tooltips, menus and the guide, and no longer on the start screen.

### Fixes

- On touch screens, buttons, switches, menu items and text fields are large enough to tap, and typing in a field no longer zooms the page.
- The preset, rename, delete and Transform controls no longer lose keyboard focus, and long names no longer push buttons or lists off the screen.
- Clearing a number in the export dialog no longer turns it into a 1 px (or other) value. The dialog says which range it accepts, holds the download until then, and restores the last value when you leave the field.
- The keyboard focus stays on a sensible control after leaving the Guide or the editor and after dismissing an import error, and the whole "Include undo history" row toggles its checkbox.

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
