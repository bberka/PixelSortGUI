/**
 The shared slider thumb draws a 12 px dot, which is under the 24 px pointer
 target that DESIGN.md section 8 asks for. Growing the box and clipping the
 fill to its content keeps the dot the same size while the whole 24 px counts
 as the target (axe `target-size`).
 */
export const sliderThumbTarget =
	'[&_[data-slot=slider-thumb]]:size-6 [&_[data-slot=slider-thumb]]:border-[6px] [&_[data-slot=slider-thumb]]:border-transparent [&_[data-slot=slider-thumb]]:bg-clip-content';
