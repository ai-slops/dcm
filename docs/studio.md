# PUMP Chart Studio

Chart Studio authors Single/Double generation-rule projects and their chart outputs. It combines
mode-aware tap/hold editing, audio-clock playback, native assessment and export, and a scoped agent
implemented with `@slop-lab/part` and `@slop-lab/part-plugins`, both pinned to `0.1.0`.
There is no Docker requirement for the normal workflow.

Use the [terminology reference](terminology.md): a **song** supplies background audio, a **project**
holds generation rules, a **chart** is an individual note result, and the **library** holds reusable
project components. The older `StudioProjectV1`/`project.json` wire format is a **chart document**,
not a generation-rule project.

## Start the studio

### One-command persistent preview (Linux)

```sh
sh scripts/studio-preview.sh start
```

Or use `just studio-preview start`. This launches **this same Studio**, not a second preview app.
The first run installs missing managed prerequisites under ignored `.studio-dev/tools/`: Node
24.22.0 if the installed Node is too old, Corepack 0.36.0, pnpm 10.17.1, Rust 1.94.0, and
wasm-tools 1.254.0. Have a native C/C++ compiler, npm, curl, tar/xz, and SHA-256 utilities available.
The Linux helper supports glibc and musl; Node's musl archive comes from the Node project's
unofficial-builds service, with its published SHA-256 manifest checked before extraction.
Only the `pump` CLI and chart author/runtime components are built, then the exact web lockfile.
It does not install just, Docker, provider credentials, or a DIM runtime. Existing package-client
mirror settings are honored; this workspace's DIM mirror plugin is currently unconfigured.

The server binds **127.0.0.1:4173** directly in the workspace. The helper waits for `/health`, asks
`dim-expose --name studio --port 4173 --ingress shared` for the workspace route, and checks its real
HTTPS response before printing the URL. Pending approval prints the exact route ID, not a guessed
working link. Only the operator can approve routes. Exposure failure leaves the protected local
process running so it can be inspected and retried.

**Sign in:** the public preview uses the browser's HTTP Basic authentication dialog. Username is
`studio`. The owner-only file **`.studio-dev/password`** contains `studio:<password>`; read it
privately on your workstation, not in shared logs or screenshots. No secret is placed in a URL,
argument, or printed command output. In public mode, sign-in protects static files, all API reads,
audio, uploads, edits, native operations, and agent endpoints, including loopback requests.
Session/CSRF and revision checks still apply. Part defaults to off in public mode; inherited
provider secrets do not enable it. Explicit workspace DIM opt-in is described below.
The public server and its native children receive only allowlisted runtime settings, and public
startup does not load `web/.env`. Set a custom data directory with `STUDIO_DATA` in the launcher's
environment; local `--local` mode retains normal `.env` and provider behavior.
Only process readiness is available without sign-in. HTTPS is terminated by the approved ingress;
the app accepts only its configured public origin (including the ingress's exact forwarded host)
and local origins, not arbitrary forwarded hostnames.

```sh
sh scripts/studio-preview.sh status
sh scripts/studio-preview.sh restart
sh scripts/studio-preview.sh stop
```

`start` reuses the same healthy service; `restart` rebuilds and replaces only the owned process.
PID/start-time identity and an instance readiness nonce prevent stale state from killing an unrelated
process. A lock prevents concurrent lifecycle commands. Logs are `.studio-dev/studio.log`; process
state and the credential stay in private `.studio-dev/`. These are separate from saved projects and
audio in `.pump-studio/`, which stop/restart never clears. Back up `.pump-studio/` for valuable work.
Restarting clears in-memory browser sessions and proposals, not saved chart/audio data.

Outside DIM, use **`sh scripts/studio-preview.sh start --local`** and open the printed localhost URL.
This does not call DIM or enable public sign-in/Part restrictions; keep the local port private.
The original cross-platform foreground workflow below is also unchanged.

### Foreground local workflow

First install the [native build prerequisites](build.md). The web application additionally needs
**Node.js 24.22.0 or newer**, required by Part, and Corepack for the pinned pnpm `10.17.1` package
manager. This does not change the older CLI/gateway's Node 24 requirement. If your Node installation
does not include Corepack, install it using its official instructions or `npm install --global corepack`.

From the repository root, in Linux or Windows Git Bash:

```sh
just build
just studio-install
just studio-build
just studio
```

Open **http://127.0.0.1:4173**. `just studio` serves both the built frontend and the API. It is
separate from the legacy v1 gateway started by `just serve` on port 3000; that gateway is unchanged.
The new service binds to loopback, not all network interfaces. Stop it with Ctrl+C.

The first start creates a four-hold editable demo with a four-second metronome and 120-to-150 BPM
change. It is explicitly an **uncertified draft**, not a release certificate. Saved work survives
server restarts in `.pump-studio/`; a later start does not overwrite an existing project with the demo.

| Command | Purpose |
| --- | --- |
| `just studio-install` | Install the exact web lockfile |
| `just studio-build` | Build browser assets and the Node server |
| `just studio` | Serve the production build on localhost:4173 |
| `just studio-check` | Strict TypeScript and Biome checks |
| `just studio-test` | Shared-model, HTTP, persistence, native integration, and Part runtime tests |
| `just studio-dev-server` | Watch the TypeScript API server |
| `just studio-dev` | Run Vite on port 5173, proxying the API to port 4173 |

For development, run the last two commands in separate terminals. Source-server development uses
Node's experimental TypeScript transform support; the production server is bundled JavaScript.
React Grab and React Scan load only in development and can be disabled with
`VITE_DISABLE_REACT_DEVTOOLS=true`. They are not included in the production runtime path.

Without just, use `sh scripts/studio.sh install|build|check|test|start|dev|dev-server`.
The script changes to `web/` before invoking Corepack, so the package manager is selected from the
correct `package.json` rather than a global default.

## Edit and preview

- Choose **Tap**, **Hold**, **Select**, or **Erase**. Single has five lanes `DL UL C UR DR`;
  Double adds the same five lanes on the right pad. Multiple panels on the same tick are represented
  by a shared bit mask. Mode is required and fixed, not an export preference; Single rejects
  right-pad notes at the write boundary as well as hiding unavailable editing lanes.
- Set the hold tool's duration before placement. Select a note to edit its tick, panel, or duration;
  duration zero is a tap. Invalid overlap/bounds changes are rejected without deleting other notes.
- Use quantization, previous/next pages, and **Go to tick** to navigate. Arrow keys move the grid
  cursor; activating a cell performs the selected tool. The structured note list offers a text view.
- Set chart duration and tempo markers in the timing controls. BPM decimals are converted to exact
  reduced fractions, not rounded to integer microseconds. Shortening that would drop existing data
  is rejected. Audio offset is in microseconds; positive values place tick zero later in the audio.
- Use Undo/Redo, then **Save** to commit the draft. Save is explicit, not automatic. The browser
  warns before leaving a dirty document. Export a JSON copy before abandoning unsaved work.
- Playback uses the actual audio element's clock. Holds stay active on `[head, tail)`; taps use a
  120 ms visual pulse after onset. Positive-offset pre-roll does not trigger contacts early.
  Playback does not move the editing cursor. Play/Pause, Stop, seek, volume, playback rate, and audio
  looping are available; media failures are shown rather than treated as successful playback.

The preview is a schematic chart audition, not StepMania rendering or physical-safety validation.
Browser timing is floating-point playback timing; the native renderer retains exact supported
timing when exporting. No audio starts without user interaction.

Use **Segment** in the bottom transport to audition only part of the loaded music. Enter start and
end in **audio seconds**, then choose **Play segment**. The end must be after the start and within
the actual media duration. Playback pauses at that end, or repeats only the interval when **Loop
selected segment** is checked. This is independent of the transport's whole-song Loop preference.
The existing offset/tempo projection continues to drive the chart and playfield. Stop, ordinary
chart seeking, or **Clear segment** exits interval mode; replacing/reloading audio resets it.
The Segment dialog is also available from the mobile Preview tab.

**Preview lookahead** controls the visible future audio-time window, not a generation algorithm.
Use the numeric field or slider for 0.1–12 seconds in 0.05-second steps, including 0.25 or 0.5
seconds. Temporary invalid text does not replace the last valid projection with a broken clock.

## Rule projects and the component library

### Visual fixed-note and automatic-range authoring

Use a saved project's **Edit grid** action to open `/projects/<project-id>/edit`. This grid edits
the project's executable source, not the active saved chart result. Click an empty cell to place
a tap; click an occupied tap or any part of a hold to remove that lane's demand. Drag vertically
within a lane to create a hold, releasing at its tail. Cancellation does not commit a partial
gesture. Other lanes of a chord remain untouched.

Every editor placement reserves one UCS cell per lane/tick, including the hold-tail cell. A new
onset cannot share that tail cell, and invalid overlapping gestures leave the previous notes intact.
Playback still treats hold activity as half-open; the stricter editing rule reflects UCS encoding.

Hybrid rules (`hybrid_regions_v1`, schema version 2) combine literal `fixed_notes` and named
automatic regions. Region names and patterned backgrounds remain visible while scrolling through
their ranges, including when their first row is above the viewport. Automatic ranges own all lanes
over `[start_tick, end_tick)` and cannot overlap fixed cells or each other. Their generated hold
tails must end before the range's exclusive end. Edit the region's rules instead of drawing fixed
notes inside it. There is no silent note deletion, clipping, or resampling to conceal conflicts.

Generation creates an independent chart result and stores a read-only snapshot of region names and
bounds as origin metadata. Later project edits do not relabel old results. Existing version-1
weighted-cycle projects remain valid; conversion to hybrid authoring is an explicit action, and
the new region-local sampling algorithm may produce different notes for the same seed. Within
version 2, changing a region name, an unrelated fixed note, another region, or the tail duration
does not reshuffle an unchanged region's choices.

New projects use the selected song's original UCS ZIP timing where available: exact grid,
piecewise tempo, signed offset, and original duration, not the current Root editor's timing.
Appending a tail extends duration without reconstructing or rounding that imported prefix; a new
tempo segment is added at the former end only when a different tail BPM is requested.

The editor uses a bounded continuous virtual scroll surface rather than 48-tick page replacement.
Tempo boundaries change the media-clock-to-tick projection without restarting the scroll position.
Note colors repeat **blue, red, yellow, red, blue** for each five-lane pad. Left/right identity is
also stated in labels rather than relying on color.

Open **Projects and library** to create a real rule project. Select a background song and explicitly
choose **Single** or **Double**; leaving mode unselected cannot create a project. That song and mode
are immutable for the project. Use another project when either must change.

Projects store editable timing, an evaluation contract, and bounded generation rules. The
`weighted_cycle_v1` rule repeats a pattern of weighted choices on a tick grid between an inclusive
start and exclusive end. A choice contains a panel mask, hold duration, and positive weight; mask
zero is a rest and cannot have hold duration. These are real inputs to the native generator, not
a descriptive prompt or a copy of the current chart.

Save rules with their project revision, then generate using a 64-character lowercase hexadecimal
seed. Generation materializes the selected song's current audio binding, generates actual notes,
runs the native finite assessment, and checks UCS representability. It creates a **new chart
result** without replacing the open editor chart. Inspect the result and explicitly open it.
An assessment rejection is displayed honestly; generated drafts carry no verified-bundle
certificate and are not official difficulty ratings or safety guarantees.

Publish a project's **timing**, **evaluation**, or **generator** component into the library, then
apply that component to another project. Applying copies its payload and records its source
project/component revisions. It does not create a hidden mutable link: later source edits do not
rewrite another project or an already generated chart. Incompatible timing or Single/Double masks
are rejected rather than clamped or truncated. Imported existing charts remain result documents;
migration never invents generation rules from their note arrays.

Projects and library components have stable IDs and revision-checked writes. Conflicts require
rereading the current record instead of silently overwriting it. The song/chart/archive catalog
remains available separately under **Songs and charts**.

### Verify project authoring and agent writes

With the managed preview running, from `web/`:

```sh
STUDIO_PROJECTS_QA=1 node --experimental-transform-types tests/browser/projects-api.mjs
node --experimental-transform-types tests/browser/projects-ui.mjs
STUDIO_LIVE_AGENT=1 node --experimental-transform-types tests/browser/project-agent-live.mjs
```

These checks use temporary rule projects, components, and generated charts, preserve the original
active chart, and remove only their own temporary records. Do not edit the shared workspace
concurrently. The API check covers required mode, stale writes, component compatibility, and actual
native Single/Double generation. The UI check covers result opening, five/ten lanes, small exact
lookahead, unsaved-rule cancellation, reuse, and phone layouts. The opt-in agent check spends real
model calls and verifies `list_songs`, `read_chart`, `read_project`, a permitted `write_project`, and
readback of the persisted rule change. Evidence remains ignored under `web/artifacts/`.

## Audio, chart documents, and export

The file dialog accepts WAV, OGG, or MP3 audio up to 32 MiB. Browser codec support still determines
whether it can play a particular file; the native pipeline binds audio bytes but does not decode
or certify their codec. Replacing audio does not silently invent a new tempo map or rewrite notes.

Legacy chart-document JSON contains notes, timing, an evaluation contract, mode, and the expected audio digest.
To import a chart document, select both its JSON and the matching audio. The server validates their digest
and commits them together. Replacement imports/audio are disabled while a local draft is dirty.
JSON export can preserve the current draft, including edits that have not yet been saved.

**Download SSC ZIP** uses the saved revision and the native `export-edited-ssc` command. The ZIP
contains only fixed entries:

```text
chart.ssc
music.wav                 # or music.ogg / music.mp3
edited-export.json
project.json
```

`edited-export.json` records `source: "user_edited"` and `certification.status: "none"`. It never
borrows a source bundle's signature, candidate identity, or certificate for a changed chart.
The original verified-bundle `export-ssc` command remains separate and unchanged.

SSC export enforces the [existing bounded format profile](chart-v2.md#stepmania-and-outfox-ssc-export):
exact 48-row-per-beat positions, representable timing decimals, and no hold-tail/new-onset collision
in the same cell. Titles/artists are printable ASCII within the current exporter limit. Unsupported
charts produce an error instead of silent rounding. See [StepMania setup](stepmania.md) to play
the resulting songs in a real engine.

## Songs, charts, and retained archives

Open **Songs and charts** in the toolbar. This is the Studio's durable song manager, not a
requirement to arrange downloads or files manually outside the app:

- Search the public **Pump Pro+** catalogue by title, artist, or CS code, then **Download** a
  result. This is a third-party source, not the official PIU service. A direct CS-code download
  is also available. Requests accept only fixed public source URLs and never forward Studio
  credentials. Network/source failures are reported without changing the open chart.
- Select a retained original ZIP, choose its chart(s) and music, and **Import as song**. This
  creates a separate library song without replacing the open project. Original ZIPs can be
  downloaded again or removed independently of the imported song.
- Select a song to create Single/Double charts, import another UCS against that song's music,
  open, duplicate, rename, or delete charts. Create song starts a new blank chart with optional
  audio. Audio replacement updates all charts belonging to that song, not unrelated songs.
- **Download saved song ZIP** exports its saved UCS charts, shared music, and library metadata.
  It does not include unsaved editor changes or confer certification. The last song and a song's
  only chart are protected; delete the song instead of leaving it without charts.
- Switching the open chart or replacing its audio offers **Save and continue**, discard, or
  cancel when the editor has unsaved changes. Metadata-only management does not replace the
  browser draft. Revision conflicts preserve that draft and require refreshing the library.

**Chart previews** opens `/previews`. Choose a stored song and chart to exercise the reusable
scrolling player, physical pads, read-only timeline, transport, and UI primitives. The player uses
that song's actual stored audio, tempo map, offset, taps, and holds. **First note** seeks without
autoplay. A song without audio explicitly disables playback; no silent substitute is supplied.
`/previews?chart=<chart-id>` links directly to a stored chart without switching the Studio's active
project. Native timing is retained even when the real audio is shorter than the chart's blank tail.

The song/chart catalog is bounded to 64 songs, 128 charts, and 32 retained archives. ZIP decompression uses
the same limits described below. Private imported examples, music, ZIPs, recovery data, and browser
evidence stay in ignored local storage and are not repository fixtures or redistributed assets.

### Library browser verification

With the managed preview running, from `web/`:

```sh
node --experimental-transform-types tests/browser/library-workflows.mjs
STUDIO_LIBRARY_CHART_ID=<stored-chart-id> node --experimental-transform-types tests/browser/library-preview.mjs
STUDIO_LIVE_LIBRARY=1 STUDIO_SAMPLE_UCS_FILE=/absolute/path/to/private-example.ucs \
  node --experimental-transform-types tests/browser/library-live-source.mjs
```

The first creates and removes only a temporary song and restores the prior active chart. Do not
edit the shared Studio concurrently. The second checks real audio/first-note/hold behavior and all
five component views at desktop, tablet, and phone widths without changing the active project.
The opt-in public-source check downloads CS839 and retains its imported song and supplied private
example as separate charts for inspection. It verifies the downloaded package/music hashes and
native chart/timing equality. It does not bundle or commit the example or music. Browser evidence
is ignored under `web/artifacts/`; credentials and CSRF tokens are never printed.

## UCS transfer and visualization

Use **UCS transfer** in the toolbar to download the saved chart as real Format 1 UCS or import a
UCS file. Export uses the chart's fixed **Single** or **Double** mode; it cannot change that mode.
Single rejects right-pad notes rather than dropping them. Save or undo local edits first; exports never silently
omit visible unsaved notes.

Import accepts optional replacement audio. Omitting it keeps current project audio; this is not a
claim that an arbitrary song matches that audio. Import commits chart/timing and audio atomically,
with revision protection. It preserves title, artist, and the current evaluation contract, rejecting
incompatible contract bounds rather than changing them silently. An imported chart cannot silently
change the current chart's mode; use the song's chart-import workflow for a separate result.

The same grid, physical pads, and media transport visualize imported UCS. **Follow audio** pages
the bounded timeline from the real audio clock without moving the editing cursor. Selecting or
paging the editor disables follow until you enable it again. Beat, active BPM, song time, and signed
offset provide timing context. Display remains at native one-tick resolution even with coarse edit
snapping, so existing off-grid taps and hold endpoints never disappear. The audio clock is clamped
to real media duration, even if a chart is longer than the selected audio.

See [UCS format profile, exactness limits, native commands, references, and tests](ucs.md).

### Downloaded UCS ZIP with bundled music

In **UCS transfer**, choose a file under **UCS song ZIP**. Select **Chart from ZIP** and **Music
from ZIP**, then click **Import selected ZIP files**. A single chart or music file is selected
automatically; multiple candidates require an explicit choice. Nested folders and UTF-8 filenames
are supported. The selected chart and WAV/OGG/MP3 replace the current project together under the
existing revision guard. ZIP import never silently pairs a chart with unrelated current audio.
After **Audio ready**, use Segment to audition the imported music.

Archives are read in the browser, never unpacked into server-selected paths. Limits are 64 MiB ZIP
input, 128 entries, 32 chart/music files, 16 MiB per UCS, 32 MiB per audio file, and 48 MiB combined
decompressed song data. Actual streamed byte counts and CRCs are checked, not just declared sizes.
Encrypted, ZIP64, split-volume, unsafe/ambiguous-path, and unsupported-compression archives are
rejected without changing the saved document. Stored and DEFLATE entries are supported. Raw UCS
import with optional separately chosen audio remains available; UCS export is still a plain `.ucs`.

## Native assessment and generation

Assessment runs the existing Rust finite execution/intent/difficulty model. Accepted/rejected is
relative to that declared contract, **not an official PUMP rating or a guarantee of human safety**.
Assessment and export use the saved revision; save local edits first.

The older demo seed generator runs the real author/runtime WASM pipeline and returns a proposal.
It does not replace the chart automatically. That bundled generator is compatible only with the demo's music
profile; replacing audio or changing that profile can return `profile_mismatch`. Manual editing,
assessment, agent chart proposals, and edited SSC export remain available for other projects.
The demo has two retained variants, not an unlimited music generator. Rule-project generation is
the separate native `generate-rules` path described above; it works from the project's declared
timing/rules for the selected song and does not claim exhaustive bundle certification. The existing
SSC renderer is Double-only; Single charts use UCS rather than being mislabeled as `pump-double`.

If the native CLI/components are missing, the studio can still open and edit its source-backed
demo. Native operations show unavailable status. Run `just build` and restart the studio to use
generation, evaluation, and export. Windows selects `dist/pump.exe`, Linux selects `dist/pump`.

## Configure a real model provider

Without provider configuration, the editor remains fully usable and the agent panel truthfully
shows that no provider is configured. No canned assistant is substituted.

### Existing DIM workspace connection

Use the operator-provisioned workspace connection rather than creating or copying an account key:

```sh
STUDIO_AGENT_PROVIDER=dim STUDIO_AGENT_MODEL=gpt-6.1-sol sh scripts/studio-preview.sh restart
```

This deliberately enables model use behind the existing protected HTTPS Studio. The server reads
the owner-only `~/.config/dim/llm-router.json` connection file and authenticates catalog discovery.
`DIM_LLM_ROUTER_CONNECTION_FILE` can select another operator-provisioned private connection file.
Do not paste its contents into commands, prompts, project files, or logs. The launcher retains only
the provider selection, model ID, and optional connection-file path across ordinary restarts;
it never copies the bearer token into its state or loads `web/.env` in public mode.

The Agent panel shows the actual catalog and each route's `chat` or `responses` API. The selected
model must be in the current catalog; the server refreshes discovery for each run. A catalog entry
does not guarantee chart-tool suitability, especially for image models. Choose a tool-capable text
model. Missing credentials/catalog access leaves editing available and displays an actionable
unavailable state, not a fake response. Disable model use with:

```sh
STUDIO_AGENT_PROVIDER=off sh scripts/studio-preview.sh restart
```

### Standalone provider

For the foreground/local workflow, copy `web/.env.example` to ignored `web/.env`, configure a
tool-capable endpoint, and restart:

```dotenv
PART_ENDPOINT=https://api.openai.com/v1/chat/completions
PART_MODEL=your-tool-capable-model
PART_API_KEY=your-server-secret
PART_API=chat
```

`PART_ENDPOINT` is the **complete API URL**, not just a base URL. `PART_API=chat` (the default)
selects Chat Completions; `PART_API=responses` selects a complete `/v1/responses` endpoint with
stateless `store:false` requests. Both use the real pinned Part adapters. For a local
compatible server, use its complete endpoint, model name, and omit `PART_API_KEY` if it requires no
authentication. Credentials and endpoints are configured only on the server; never put secrets
in `VITE_*` variables, project JSON, or prompts. `web/.env` and `.env.local` are ignored by Git.

When you send a prompt, Part may send chart/timing/metadata and tool results to the configured
provider. Audio file bytes are not sent to the model. Each run works against an immutable snapshot
of the saved document and has these scoped tools:

- `read_document`: inspect the frozen chart project.
- `evaluate_chart`: obtain the native assessment for that snapshot.
- `generate_variant`: invoke compatible native demo generation.
- `validate_ucs`: validate native UCS export of the frozen snapshot in Single or Double mode.
- `propose_chart`: create a validated replacement chart and optional complete timing/music object
  for human review, preserving audio identity.

The agent also has actual project/component tools: `list_projects`, `read_project`,
`create_project`, `write_project`, `generate_project`, `list_components`, `read_component`,
`publish_component`, and `apply_component`. `list_songs` discovers actual background-song IDs and
`read_chart` inspects an existing or newly generated result. Reads use real saved records rather than a frozen
chart disguised as a project. Select **Allow project and library writes** before starting a run
to grant `projects_and_components` access for that run; older clients and unchecked runs default
to read-only. The model cannot grant itself access. Writes persist typed rule/component data with
revision checks, and generation creates a separate result chart. Tool receipts name actual IDs
and revisions; natural-language claims alone are not evidence of a saved change.

There are no shell, arbitrary filesystem, repository, or provider-configuration tools. Authorized
project-rule writes do not implicitly replace the saved chart document. **Apply** for chart proposals
remains an explicit user action, and revision checks
reject stale proposals. Undo after applying produces a new local draft; save it to restore that
version on the server. Reject removes only the proposal, without saving the document. The panel
shows note/timing change summaries and retains apply/reject decisions for the run. A failed action
keeps its prompt/proposal available for recovery.

The model's prose summary is non-authoritative. The review card identifies its base revision and
owning run and shows the canonical before/after changes, including exact note masks/hold lengths,
offsets, tempo, grid, duration, and reference accents. Long exact values scroll without dropping
changes. At most four pending proposals belong to one run, and at most sixteen belong to the
browser session across all revisions. Review or reject pending proposals before creating more.

Cancel aborts the local run, provider transport, and associated native work. It prevents later
proposal writes but does not retroactively discard proposals already created. Remote provider
billing/cancellation semantics remain the provider's responsibility. SSE reconnect/snapshot
recovery does not resend the original prompt. Refresh restores the active or latest terminal run,
bounded tool input/result previews, final text, and safe errors. These are operational events, not
private chain-of-thought. History is in-memory and browser-session scoped, not durable or recoverable
after a server restart or loss of the browser session cookie. Saved chart and audio survive.

Runs have a 120-second deadline, at most eight model invocations and sixteen tool dispatches.
Tool previews are capped at 8 KiB, retained text at 64 KiB, and event replay at 512 records; a replay
gap falls back to the canonical snapshot. The panel reports tool readiness separately, including
demo-profile restrictions on native generation.
Text limits are UTF-8 byte limits on both snapshots and wire/replay events; individual deltas are
capped at 8 KiB, and truncation is disclosed. Retained snapshots remain readable if their live
runtime record is evicted; proposal decisions retain their originating run even when another run
is currently displayed.

### Opt-in real-provider browser smoke

With the managed DIM-backed preview running:

```sh
STUDIO_LIVE_AGENT=1 node web/tests/browser/agent-live.mjs
```

This spends real model calls, checks native tools and proposal review, briefly applies a chart/timing
change, and restores the original project/audio with revision protection. Do not edit the shared
project concurrently. Private recovery copies and redacted receipts/screenshots stay in ignored
`web/artifacts/`. The ordinary automated tests use wire-level fixtures, not live credentials.

## State and local trust boundary

- One durable workspace holds the song/chart catalog, active chart document, generation projects,
  and reusable component library. Project revisions protect rule writes independently from the
  active document/catalog revisions; a conflict preserves the browser draft. Older documents and
  version-2 catalogs migrate to the version-3 envelope while preserving IDs, notes, timing, and audio.
  Missing legacy mode is normalized explicitly at migration/import, never silently defaulted when
  creating a new rule project. No rules are synthesized from imported note data.
- Audio and original ZIPs are stored by SHA-256 under `.pump-studio/audio/` and
  `.pump-studio/archives/`; content is checked before use. Metadata and the active project publish
  together through one atomic `document.json` replacement after asset validation.
  Keep this directory private and back it up if the saved songs matter. Do not run multiple
  independent studio server processes against the same data directory.
- Browser sessions, run history, and proposals are in memory and disappear when the server restarts.
  Saved project/audio persist. Refreshing a page does not restart a provider request.
- The API requires session/CSRF credentials and exact configured Host/Origin checks. It accepts chart
  data and uploads, never arbitrary native executable paths or provider URLs. This is a local
  single-user tool, not an authenticated public multi-user service.
- Operator settings include `STUDIO_PORT` (default 4173), `STUDIO_DATA` (private data directory),
  and `STUDIO_REPO_ROOT` (checkout root). Normal startup through just needs neither path override.
- The preview helper additionally owns `STUDIO_PUBLIC_ORIGIN`, `STUDIO_PASSWORD_FILE`, and
  `STUDIO_INSTANCE_ID`. Do not set a public origin without an owner-only credential file or expose
  the unguarded foreground/local mode. `.dim/repos.yml` remains declarative policy only; changing
  repository files never approves ingress or installs operator policy.
- Imports use safe JavaScript integers, at most 10,000 notes and 4,096 tempo segments. Native
  formats supporting larger integer values do not imply that the browser can represent them.

## Testing the Part integration without credentials

`just studio-test` includes a scripted **HTTP model fixture**. It drives the actual Part agent,
provider adapter, fetch transport, tool dispatcher, proposal, and cancellation paths. It does not
mock the Part runtime itself and does not claim to test a paid/live LLM.

For an explicitly test-only browser session, start the fixture in one terminal:

```sh
cd web
corepack pnpm fixture:provider
```

Then start a separate studio data set with test configuration in another terminal:

```sh
PART_ENDPOINT=http://127.0.0.1:4199/v1/chat/completions \
PART_MODEL=pump-studio-fixture \
STUDIO_DATA="/path/to/disposable/studio-data" just studio
```

The fixture returns scripted chart proposals, not intelligent language-model answers. Do not use
it as evidence of external model quality. The repository verification covers real native commands,
HTTP behavior, browser editing/playback, and the Part tool loop; actual provider credentials and
a physical Windows browser/MSVC environment were not available in this workspace.
