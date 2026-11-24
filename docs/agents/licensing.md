Written by Claude Sonnet 5.5 (thinking medium), documentation subagent.

# Licensing: what code may be copied

Source: `docs/research/ecosystem-survey.md` section 14 and `docs/research/primary-references.md` sections 1, 2.1, and 3.1, checked 2026-11-24. This is not legal advice. Re-check a repository's licence file before copying from it.

## The project's own licence

Not chosen. This is an owner decision. Until it is made, do not add a `LICENSE` file, an SPDX header, or a licence field to `package.json`. The decision matters because GPL code in the shipped bundle would force the whole app to be GPL-3.0, and the choice of project licence limits what may be copied.

## Rule

A missing licence is not permission. A README claim is not a licence file. Copy code only from a project in the first table. For every other project, read it for understanding and write your own implementation from the behavior described in the specs and research, without the source open beside you.

## May copy from (MIT, attribution required)

| Project | Licence | Notice to keep | Worth taking |
| --- | --- | --- | --- |
| `satyarth/pixelsort` | MIT | Copyright (c) 2015 satyarth | interval functions |
| `czycha/pxlsrt` | MIT | Copyright (c) 2014 czycha | `middlate`, `smooth`, pair-sum keys, array rotation |
| `GarrettGunnell/Pixel-Sorting` | MIT | Copyright (c) 2023 Garrett Gunnell | kernels, hash function, HSL conversions, threshold animation |
| `ruccho/BitonicPixelSorter` | MIT | Copyright (c) 2020 ruccho | bitonic compute shader, scan math (a port to WGSL is allowed) |

When you copy:

1. Copy only parts whose implementation is non-obvious. Write simple parts yourself.
2. Add the project's copyright line and the full MIT permission text to `THIRD-PARTY-NOTICES.md` at the repository root (create it with the first copy). Record which project and which part.
3. Say in the pull request and in the effect's spec (Provenance) what was copied.
4. A hosted web app ships its code to users, so the notices must also be reachable from the app. The specs decide where.
5. Do not imply the original author endorses this project.

## May only learn from (never copy)

| Project | Licence status | Why it is closed to copying |
| --- | --- | --- |
| `Krzysztofz01/pixel-sorter` (Go) | GPL-3.0 | Copyleft. Copying makes the whole app GPL-3.0. |
| `rkargon/pixelsorter` | GPL-3.0 | Same. Re-implement its path catalogue, `discretize`, `mirror`, `splice`, and tile density from documentation. |
| `notlauren/pxlsort` (C, Codeberg) | no licence | All rights reserved by default. |
| `jeffThompson/PixelSorting` | no licence file; README claims CC BY-NC-SA 3.0 | Non-commercial and share-alike. Unusable in a product. |
| `kimasendorf/ASDFPixelSort` | no licence | All rights reserved. Do not copy the `.pde` file or its comments. |
| `julescarbon/sortpixels.js` | no licence | All rights reserved. |
| `DavidMcLaughlin208/PixelSorting` | no licence | All rights reserved. |
| `DenizBicer/Pixel-Sorting` | no licence | All rights reserved. |

Learning means: reading the project, describing its behavior in your own words in a spec, then implementing from the spec. Ideas and algorithms are free to reuse. Code and its comments are not.

## Attribution

Kim Asendorf's ASDFPixelSort is the origin of most pixel-sorting tools. Credit the lineage in docs or the app's about page even where no licence requires it. The specs decide where.

## Other dependencies

A new npm dependency needs a licence that allows use in a closed or open distributed app (MIT, ISC, BSD, Apache-2.0). Do not add a GPL, AGPL, or unlicensed package. State the licence of each new dependency in the pull request.
