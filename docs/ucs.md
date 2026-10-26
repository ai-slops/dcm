# Native UCS export and Studio visualization

UCS conversion preserves the **actual DCM chart**, not a downloaded timing skeleton. Taps,
chords, holds, section timing, and initial audio offset are converted by the native Rust adapter;
the web server never maintains a second UCS parser. No gameplay video, OCR, model provider, or
commercial media is needed. Exported/imported charts remain **uncertified user-generated drafts**.

## One flow, one timing model

Start the existing Studio with `sh scripts/studio-preview.sh start`, then open its printed URL.
Public sign-in and the private provider boundary remain unchanged; see [Studio startup](studio.md).
Use the Studio's UCS transfer controls to download a saved chart or import UCS with either a selected
audio file or the current project's audio. Save local edits before importing or exporting. Import
replaces the chart/timing only on explicit confirmation and commits chart/audio together with a
revision check. Existing title, artist, and evaluation contract are retained. An incompatible
contract is rejected, not silently rewritten. The mode is retained as an explicit export preference.

The same editor, audio element, tempo functions, transport, playhead, and physical-pad preview render
both DCM and imported UCS notes. Playback uses the actual audio clock; speed, pause, seek, offset,
and tempo changes do not create a separate UCS clock. The timeline uses a bounded visible window
rather than rendering every row of a long file. A UCS file does not identify or contain audio:
choosing current audio is an explicit association, not proof that it matches the imported song.

## Supported Format 1 profile

- Header: `:Format=1`, then an explicit `:Mode=Single` or `:Mode=Double` before timing data.
  This is a file-format identifier, not a claim that the header contains `Version=3`.
- Single has five columns mapped to native bits 0–4: **DL, UL, C, UR, DR** on the left pad.
  Double has ten columns: those five left-pad lanes, then the same five right-pad lanes (bits 5–9).
  Single export rejects any right-pad notes; it never truncates them. Native DCM remains ten-panel.
- Cells: `.` rest, `X` tap, `M` hold head, `H` hold body, `W` hold tail. Chords use multiple cells
  in one row. Every held lane must have `H` on intervening rows and a terminating `W`, including
  across section boundaries. A hold is one native note, not repeated taps.
- Timing: `:BPM`, `:Delay`, `:Beat`, `:Split`. The first section must establish BPM, Beat, and Split;
  later sections inherit these settings if omitted. Delay is **per section**, defaulting to zero.
  Beat is supported as `4` (meter information); it does **not** multiply the row duration.
- Each section's first row occurs after its Delay in **milliseconds**. Every row advances exactly
  `60,000,000 / (BPM × Split)` microseconds, including the row before the next section begins.
  For example, BPM 120, Split 4, Delay 125 gives row times 125,000, 250,000, and 375,000 µs.
  BPM 150 with Split 8 advances 50,000 µs per row.
- Initial signed Delay maps to DCM's signed integer `offset_micros`: positive means tick zero is
  later in audio. Delay must be exactly representable in microseconds. Later nonzero Delay requires
  stops/warps absent from DCM's music model and is rejected, not hidden in a fake BPM change.
- Split is 1–128. Import uses the exact least common multiple of section splits, capped at 4096
  native ticks/beat; no row position is rounded. Rendering uses that grid when possible, or an exact
  common-divisor reduction of every event, tempo boundary, and span, to fit a supported Split.
- BPM literals accept at most six fractional digits; Delay literals accept at most three. Exponent
  notation and excess literal precision are unsupported, including redundant fractional digits.
  BPM output must have an exact terminating decimal of at most six fractional places. Unsupported
  fractions fail instead of rounding. Offset output converts integer microseconds to exact decimal
  milliseconds. Tempo periods remain native reduced fractions.
- Input accepts ASCII, optionally prefixed by a UTF-8 BOM, with LF or CRLF and an optional final
  newline. UTF-16, non-ASCII data, unknown/duplicate directives, malformed rows, partial trailing
  sections, invalid numbers, stray bodies/tails, and unfinished/overlapping holds are rejected.
  Export is deterministic ASCII with CRLF and a final newline. Import does not modify its source.
- Bounds: 16 MiB UCS input/output, 1,000,000 rows/derived duration ticks, 4096 sections, 10,000 canonical
  notes, and JavaScript-safe integer fields for Studio. Audio remains limited to 32 MiB. Invalid
  data never partially replaces saved chart/audio.
- Native release/re-press at one lane/tick cannot fit one UCS cell. Export rejects that collision
  and a hold tail exactly at chart end, rather than adding a row and silently changing duration.

UCS does not encode title/artist, audio digest, reference accents, evaluation contracts, source
certificates, or provenance. Import binds audio externally and starts with no reference accents.
An exported UCS must never inherit a source bundle's certificate or a video's trust status.

Exact piecewise tempo periods can be preserved even when summing an unusually complex whole song
would exceed the existing native `u128` fraction capacity. Such a chart remains importable,
editable, exportable, and browser-previewable. Exact native assessment can separately report
`timing_capacity_exceeded`; no approximate assessment or certificate is substituted. As in the
existing Studio, browser playback is a floating-point projection of the exact stored timing model.

## Native CLI and local reference checks

The preview launcher builds the CLI and needed WASM artifacts. Standalone conversion needs no
browser or video:

```sh
dist/pump chart export-ucs chart.json --music music.json --mode Double --out chart.ucs --format json
dist/pump chart import-ucs chart.ucs --audio music.wav --format json
```

Export refuses an existing destination. Import prints native `{mode, chart, music}` JSON; without
`--audio` the digest is explicitly unbound (zero), not an assertion that a song was verified.
The Studio always binds an uploaded/current audio asset before persistence.

Two user-provided files are kept **untracked and immutable** at `.local/references/ucs/`.
They are not bundled fixtures, downloadable examples, or licensed assets for redistribution.
Run the read-only compatibility/round-trip check when those local files are available:

```sh
node scripts/check-ucs-references.mjs
```

This verifies their original SHA-256, ASCII/CRLF/no-BOM properties, actual note counts, independently
expected early row times, native round-trips, and unchanged source bytes. Temporary exports are
removed. Committed codec tests instead use small independently authored fixtures and expected times.

With the preview running, the real-browser regression drives editing, saved UCS download, native
reparse, UCS upload, tempo/hold/offset playback, errors, and reload persistence. It uses generated
DCM metronome audio, restores the prior saved chart/audio, and refuses to restore over concurrent
edits. An owner-only recovery directory containing the original project JSON and audio is retained
under the ignored evidence directory, including if the browser test fails or is interrupted.
Do not run it while another author is editing this single-project Studio.

```sh
just studio-install
# On a machine without a system Chromium, install the pinned Playwright browser once:
# sh scripts/studio.sh browser-ucs uses Playwright's normal browser lookup.
just studio-browser-ucs
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an existing browser; the Linux workspace automatically
uses `/usr/lib/chromium/chrome` when available. Otherwise run `corepack pnpm exec playwright install
chromium` in `web/` first. The test discovers the URL from `.studio-dev/state.json` and reads the
private local credential without printing it. `STUDIO_BROWSER_STATE_FILE` can select an existing
managed state file when running checks from a separate review checkout; the private password is
read beside that state file and is never copied into the checkout. `STUDIO_BROWSER_URL` can select
a local foreground URL even when managed preview state does not exist;
credentials are only used for the matching approved state origin. Screenshots and downloads stay
in ignored `web/artifacts/ucs/`. No authentication headers or source reference charts are published.

## References and licensing

- Behavioral/architectural reference: [piu-video-timeline-generator](https://github.com/lllllrad/piu-video-timeline-generator),
  inspected at commit `44a43819b0a9a368bf844799b85bed6ece3d6e95`, particularly
  [`charts/ucs.py`](https://github.com/lllllrad/piu-video-timeline-generator/blob/44a43819b0a9a368bf844799b85bed6ece3d6e95/src/piu_timeline/charts/ucs.py)
  and [`docs/chart-data.md`](https://github.com/lllllrad/piu-video-timeline-generator/blob/44a43819b0a9a368bf844799b85bed6ece3d6e95/docs/chart-data.md).
  No declared license/LICENSE/COPYING was found. **No source, tests, audio, video, or other assets
  from that project were copied.** Its timing-skeleton/observed-note distinction is preserved here;
  DCM exports only notes already present in its own chart.
- Independent format evidence: the MIT-licensed [Valius UCSConverterTool](https://github.com/valius/UCSConverterTool/tree/bc9298390ace230499480a65ccdf8c2f3dc92ef0),
  particularly [`ucs_file.dart`](https://github.com/valius/UCSConverterTool/blob/bc9298390ace230499480a65ccdf8c2f3dc92ef0/lib/step_files/ucs_file.dart)
  and [`sm_converter_common.dart`](https://github.com/valius/UCSConverterTool/blob/bc9298390ace230499480a65ccdf8c2f3dc92ef0/lib/converters/sm_converter_common.dart).
  These confirm Format 1, five/ten columns, M/H/W holds, milliseconds for Delay, Split timing,
  and a 128 subdivision profile. DCM's implementation and fixtures are independently authored.
- User-supplied format compatibility samples: the supplied CS306/CS349 files, retained only in
  ignored local storage. Their names do not establish chart provenance or certification.
  Official format context: [UCS site](https://ucs.piugame.com/) and
  [sample catalogue](https://ucs.piugame.com/sample_download/pdf.php). Official downloads
  may require sign-in; no credentials, commercial charts, or commercial music are published here.
