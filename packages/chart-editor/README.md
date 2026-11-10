# Shared chart editor

Framework-independent exact beat arithmetic, playback projection, clipped note geometry,
source-time review model and canvas editor primitives. DCM uses the exact beat/timing/geometry
modules; the video review application also uses source-bound notes, independent weighted ticks,
scroll events and censored endpoints. UCS is an export adapter, not this model.

After installing web dependencies, build with `pnpm --dir web run build:shared`, then run
`pnpm --dir packages/chart-editor pack --out <destination.tgz>`. The web Studio consumes
this same package through a local link dependency. No media or application storage is included.
