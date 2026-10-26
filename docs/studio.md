# PUMP Chart Studio

Chart Studio is a local web editor for the ten-panel PUMP model. It combines direct tap/hold
editing, audio-clock playback, native assessment and SSC export, and an approval-gated agent
implemented with `@slop-lab/part` and `@slop-lab/part-plugins`, both pinned to `0.1.0`.
There is no Docker requirement for the normal workflow.

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
Session/CSRF and revision checks still apply. Part is disabled in this mode even if provider
environment variables exist; preview never needs or borrows the workspace's agent-router credentials.
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

- Choose **Tap**, **Hold**, **Select**, or **Erase**. The ten lanes are left `DL UL C UR DR`, then
  right `DL UL C UR DR`. Multiple panels on the same tick are represented by a shared bit mask.
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

## Audio, projects, and export

The file dialog accepts WAV, OGG, or MP3 audio up to 32 MiB. Browser codec support still determines
whether it can play a particular file; the native pipeline binds audio bytes but does not decode
or certify their codec. Replacing audio does not silently invent a new tempo map or rewrite notes.

Project JSON contains chart, timing, read-only evaluation contract, and the expected audio digest.
To import a project, select both its JSON and the matching audio. The server validates their digest
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

## UCS transfer and visualization

Use **UCS transfer** in the toolbar to download the saved chart as real Format 1 UCS or import a
UCS file. Choose **Single** (left five lanes) or **Double** (all ten) explicitly. Single export rejects
right-pad notes rather than dropping them. Save or undo local edits first; exports never silently
omit visible unsaved notes.

Import accepts optional replacement audio. Omitting it keeps current project audio; this is not a
claim that an arbitrary song matches that audio. Import commits chart/timing and audio atomically,
with revision protection. It preserves title, artist, and the current evaluation contract, rejecting
incompatible contract bounds rather than changing them silently. Mode is a persisted export preference.
Changing mode creates a draft edit: close the dialog, Save, and reopen it before downloading.

The same grid, physical pads, and media transport visualize imported UCS. **Follow audio** pages
the bounded timeline from the real audio clock without moving the editing cursor. Selecting or
paging the editor disables follow until you enable it again. Beat, active BPM, song time, and signed
offset provide timing context. Display remains at native one-tick resolution even with coarse edit
snapping, so existing off-grid taps and hold endpoints never disappear. The audio clock is clamped
to real media duration, even if a chart is longer than the selected audio.

See [UCS format profile, exactness limits, native commands, references, and tests](ucs.md).

## Native assessment and generation

Assessment runs the existing Rust finite execution/intent/difficulty model. Accepted/rejected is
relative to that declared contract, **not an official PUMP rating or a guarantee of human safety**.
Assessment and export use the saved revision; save local edits first.

Seed generation runs the real author/runtime WASM pipeline and returns a proposal. It does not
replace the project automatically. The bundled generator is compatible only with the demo's music
profile; replacing audio or changing that profile can return `profile_mismatch`. Manual editing,
assessment, agent chart proposals, and edited SSC export remain available for other projects.
The demo has two retained variants, not an unlimited music generator.

If the native CLI/components are missing, the studio can still open and edit its source-backed
demo. Native operations show unavailable status. Run `just build` and restart the studio to use
generation, evaluation, and export. Windows selects `dist/pump.exe`, Linux selects `dist/pump`.

## Configure a real model provider

Without provider configuration, the editor remains fully usable and the agent panel truthfully
shows that no provider is configured. No canned assistant is substituted.

Copy `web/.env.example` to the ignored `web/.env`, configure an OpenAI-compatible tool-calling
endpoint, and restart the server:

```dotenv
PART_ENDPOINT=https://api.openai.com/v1/chat/completions
PART_MODEL=your-tool-capable-model
PART_API_KEY=your-server-secret
```

`PART_ENDPOINT` is the **complete Chat Completions URL**, not just a base URL. The initial adapter
supports OpenAI-compatible APIs, not an arbitrary provider's unrelated HTTP schema. For a local
compatible server, use its complete endpoint, model name, and omit `PART_API_KEY` if it requires no
authentication. Credentials and endpoints are configured only on the server; never put secrets
in `VITE_*` variables, project JSON, or prompts. `web/.env` and `.env.local` are ignored by Git.

When you send a prompt, Part may send chart/timing/metadata and tool results to the configured
provider. Audio file bytes are not sent to the model. Each run works against an immutable snapshot
of the saved document and has these scoped tools:

- `read_document`: inspect the frozen chart project.
- `evaluate_chart`: obtain the native assessment for that snapshot.
- `generate_variant`: invoke compatible native demo generation.
- `propose_chart`: create a validated replacement chart for human review.

There are no shell, arbitrary filesystem, repository, or provider-configuration tools. Agent tools
never directly change the saved document. **Apply** is an explicit user action, and revision checks
reject stale proposals. Undo after applying produces a new local draft; save it to restore that
version on the server. A failed action keeps its prompt/proposal available for recovery.

Cancel aborts the local run, provider transport, and associated native work. It prevents later
proposal writes but does not retroactively discard proposals already created. Remote provider
billing/cancellation semantics remain the provider's responsibility. SSE reconnect/snapshot
recovery does not resend the original prompt.

## State and local trust boundary

- One durable project is shared by this local server instance. Revisions prevent browser tabs or
  agent proposals from silently overwriting newer saves; a conflict preserves the browser draft.
- Audio is stored by SHA-256 under `.pump-studio/audio/`; stored content is checked on reload.
  Keep this directory private and back it up if the saved project matters. Do not run multiple
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
