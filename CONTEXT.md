# Context: Drift vocabulary

Use these words the same way in specs, code, UI copy, and pull requests. The specs in `docs/specs/` fix the exact detail; where a spec defines a term differently, the spec wins and this file should be corrected.

## Line, run, interval

A **line** is one straight path of pixels along the sort direction. A **run** is a maximal sequence of consecutive selected pixels in a line; runs never continue past the end of a line. An **interval** is a run, or a piece of a run when `maxLength` splits it, that the effect sorts or changes as one unit. Defined in [engine.md](docs/specs/engine.md#54-selection-runs-and-intervals). This repository does not use the word "span".

## Sort key

The number computed from each pixel (brightness, hue, saturation, one colour channel, and so on) that decides the order of pixels inside an interval.

## Threshold

A lower and upper bound on a value (usually a sort key) that decides which pixels are selected. Unselected pixels end a run.

## Mask

A per-pixel weight or on/off map that limits where an effect applies. Pixels outside the mask keep their original values.

## Effect

One named image operation with parameters, such as a pixel sort or a channel shift. An effect takes pixels in and gives pixels out. It is the unit a contributor adds. See [adding-an-effect.md](docs/agents/adding-an-effect.md).

## Parameter

A named setting of an effect, such as a threshold range or a direction. The UI exposes each parameter as a control.

## Effect stack

The user's ordered list of effect instances, applied top to bottom to the source image. Each instance receives the previous instance's output and has its own parameter values, enabled flag, mix, and blend mode.

## Pipeline

The render pipeline: the engine step that runs an effect stack on an image at a render level (`renderStack` in [engine.md](docs/specs/engine.md#43-pipeline)).

## Preset

A saved list of effect instances and parameter values that can be applied to any image. A preset holds no image.

## Proxy preview

A downscaled copy of the source image that the pipeline runs on while the user adjusts controls, so feedback stays fast. The final result is rendered from the full-size image.

## Project

One saved editing session: a source image, a stack for split side B (main) and A (optional), history, view state, and export settings. Masks are later work. It reopens as it was left.

## Library

The user's list of saved projects, stored in the browser on that device. Presets are a separate global list, not part of the library.

## Export

The render of a project at a chosen size (full, 1/2, 1/4, or a custom longest side), saved as an image file on the user's device.
