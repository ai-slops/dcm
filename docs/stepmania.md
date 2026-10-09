# First StepMania playtest

This guide takes you from no StepMania installation to two generated **Pump Double** test songs.
No custom theme, noteskin, pad, account, network server, or generator plugin is required.
The initial test uses a keyboard and the bundled Pump noteskin.

## 1. Choose where each program runs

There are two separate programs:

| Program | Where to run it | Requirements |
| --- | --- | --- |
| This repository's generator | Linux, or a Linux environment under Windows WSL2 | Docker, Node.js 24, repository checkout |
| StepMania | Your graphical desktop | Graphics/audio support; Windows or compatible Linux recommended for this baseline |

The built `dist/pump` is a **Linux executable**, not a Windows `.exe` or macOS application. On
Windows, run the generator in WSL2 with Docker Desktop's WSL integration, then copy its output to
native Windows StepMania. A remote workspace can generate the files instead: transfer the prepared
directory to your desktop. StepMania does not need Rust, Docker, Node.js, or the generator to play
an already exported song.

Prerequisite installers: [Docker](https://docs.docker.com/get-started/get-docker/),
[Node.js](https://nodejs.org/en/download), and, for Windows generation,
[WSL](https://learn.microsoft.com/en-us/windows/wsl/install).
Check `docker version` and `node --version` before building.
For the optional `just` command runner and LF checkout recovery on Windows, see
[build and checkout instructions](build.md). The direct script commands below still work.

## 2. Install genuine StepMania

The compatibility baseline is **StepMania 5.0.12**, the release linked by the
[official download page](https://www.stepmania.com/download/). Do not accidentally download only
GitHub's source-code archive. Select the platform asset on the
[5.0.12 release page](https://github.com/stepmania/stepmania/releases/tag/v5.0.12).
This is a legacy engine; modern OS compatibility is not guaranteed.

### Windows desktop

1. Download `StepMania-5.0.12-win32.exe` from that release page.
2. Follow the [official installation guide](https://github.com/stepmania/stepmania/wiki/Install-Guide).
   It requires the Visual C++ 2015 **x86** runtime, including on 64-bit Windows. Obtain the runtime
   from Microsoft, not a DLL download website. Microsoft's
   [supported redistributables page](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)
   explains the applicable x86 runtime packages.
3. Install to a writable location such as `C:\Games\StepMania 5`, rather than `Program Files`.
4. Launch StepMania once, confirm that its window and sound work, then exit. This creates the user
   data directory. If Windows reports missing runtime DLLs, resolve the runtime installation before
   trying generated songs. Do not disable OS security protections to install it.

### Linux desktop

1. Download `StepMania-5.0.12-Linux.tar.gz` from the same official release.
2. Extract it into a writable directory. For example, in the directory containing the download:

   ```sh
   tar -tzf StepMania-5.0.12-Linux.tar.gz
   tar -xzf StepMania-5.0.12-Linux.tar.gz
   ```

3. Open the extracted application directory and launch its `stepmania` executable from a desktop
   terminal. Preserve the adjacent `Themes`, `NoteSkins`, and other application folders.
4. If the old binary cannot load its shared libraries, consult the official
   [Linux build guide](https://github.com/stepmania/stepmania/wiki/Compiling-StepMania-Linux)
   and [dependencies](https://github.com/stepmania/stepmania/wiki/Linux-Dependencies), or use the
   Windows baseline. Package names and binary compatibility depend on the distribution. This
   repository does not install legacy libraries or claim a tested Linux game build.

Launch the application once and exit before copying songs. A headless server or Docker build
container is not a substitute for a desktop with working graphics and audio.

### macOS

The official download page warns that this release does **not** run on macOS 10.15 Catalina or
newer. Do not treat its old `.dmg` as a supported modern-macOS installer. Use a Windows/Linux
desktop for this baseline. OutFox is a separate engine and would need a separate compatibility
test; it is not silently substituted here.

## 3. Generate the test pack

From this repository on Linux/WSL2:

```sh
./scripts/build.sh
node scripts/prepare-stepmania.mjs --help
node scripts/prepare-stepmania.mjs --out bundle/stepmania-playtest
```

If `dist/` was already built from the current checkout, skip the build. The output directory must
not already exist. Choose a new name for each run instead of overwriting an installed song.
The command generates a four-second metronome, compiles a verified v2 source bundle, and exports
both retained variants with real WASM generation and history exclusion:

```text
stepmania-playtest/
  README.txt
  preparation.json
  source/
    chart.bundle/             # retained source artifacts for replay
    music.wav
  Songs/
    PUMP Generated/
      01-Taps/
        chart.ssc
        music.wav
        replay.json
      02-Holds/
        chart.ssc
        music.wav
        replay.json
```

The two song titles are `PUMP Generated Taps` and `PUMP Generated Holds`. Both use `pump-double`,
the **Edit difficulty label**, and meter **1 as an uncalibrated placeholder**. Edit is a chart
difficulty, not a requirement to enter the chart editor. These are short functional smoke tests,
not full-length songs or skill recommendations.

To transfer the complete pack from a remote generator machine, archive it using the OS tools:

```sh
tar -czf bundle/stepmania-playtest.tar.gz -C bundle/stepmania-playtest .
```

Download/copy that archive to your desktop and extract it. Alternatively transfer the entire
directory. Never copy only `chart.ssc`: the adjacent audio is required. Retain `source/` and
`preparation.json` outside the game for reproducibility.

## 4. Put the songs where StepMania reads them

Use the appropriate **5.0.12 user-data** location:

| Desktop OS | Songs directory |
| --- | --- |
| Windows | `%APPDATA%\StepMania 5\Songs\` |
| Linux | `~/.stepmania-5.0/Songs/` |
| Legacy supported macOS | `~/Library/Application Support/StepMania 5/Songs/` |

Copy the **`PUMP Generated` group directory** from the pack's `Songs/` into the destination
`Songs/`. The final path must be `Songs/PUMP Generated/01-Taps/chart.ssc`, not
`Songs/Songs/PUMP Generated/...` or `Songs/01-Taps/chart.ssc`. If the group already exists,
use a new group name or back up the old copy instead of merging blindly.

On Windows, press Win+R and enter `%APPDATA%\StepMania 5` to open the correct folder. From WSL,
`explorer.exe bundle/stepmania-playtest` opens the generated folder for copying; the game itself
still runs on the Windows desktop. On Linux, enable hidden files in your file manager to find
`.stepmania-5.0`.

Optional development shortcut: with StepMania **closed**, back up its `Save/Preferences.ini`
under the user-data directory. Add your absolute pack `Songs/` path to the existing
`AdditionalSongFolders` preference in `[Options]`, preserving other entries:

```ini
AdditionalSongFolders=C:/PumpTests/stepmania-playtest/Songs
```

Use forward slashes on Windows and comma-separated paths for multiple roots. On Linux use an
absolute path such as `/home/alex/projects/pump/bundle/stepmania-playtest/Songs`, not `~`.
Do not both copy and register the same songs. Restart StepMania after changing this preference.
The helper never edits preferences automatically.

Portable installations use a different user root: the official wiki documents `Portable.ini`
in the installation directory and content under its `Save/Songs/`. Keep the default non-portable
layout for the first test. StepMania 5.1 also uses different user-folder names; see the
[user-data reference](https://github.com/stepmania/stepmania/wiki/User-Data-Locations).

## 5. Select Pump Double and configure the keyboard

1. Start StepMania. In Options, find **Select Game** / **Game** and select **pump**. Menu grouping
   varies with the theme. If the option is unavailable, exit, back up `Save/Preferences.ini`, and
   set the existing `[Options]` preference `CurrentGame=pump`, then restart.
2. Select **Config Key/Joy Mappings** and bind the five Pump buttons on both controller columns.
   Double is one player using both sets of five inputs, not two-player Versus or Routine.
   A suggested temporary keyboard layout is:

   | Panel/button | Left pad / controller 1 | Right pad / controller 2 |
   | --- | --- | --- |
   | DownLeft | Z | V |
   | UpLeft | Q | R |
   | Center | S | G |
   | UpRight | E | Y |
   | DownRight | C | N |

   These are suggested bindings, not engine defaults. Keep separate menu navigation bindings
   (arrows, Enter, Escape). Use **Test Input** to check all ten bindings and simultaneous presses;
   inexpensive keyboards may have rollover/ghosting limitations.
3. Use Home/free play rather than coin-operated setup. Start a normal game as one player and
   select **Double** style. Do not select Dance, Single, Half-Double, Versus, or Routine.
4. Choose the `PUMP Generated` group, one of the two titles, and its **Edit** chart. Stock 5.0.12
   collects playable Edit charts for the selected song; changing the difficulty label is not
   necessary. If a custom theme filters them, return to the bundled theme.
5. Open player options when selecting the song (press Start again when prompted). For the initial
   check use rate 1.0, a readable speed such as 1x, and no Mirror, Shuffle, NoHolds, or other note
   transforms. Set Fail to Off if available so missed keys do not interrupt inspection. Autoplay
   can help inspect rendering, but it is not input-device or human-playability validation.

## 6. Noteskin and theme setup

**No additional skin is required.** Keep the bundled theme and Pump `default` noteskin initially.
The 5.0.12 source includes Pump `default` and `simple`, among other skins. The noteskin changes
arrow/hold appearance; a theme changes the menus. Neither generates this project's charts.

To try a custom skin later:

1. Obtain a noteskin explicitly compatible with **StepMania 5.0.x Pump**, not Dance or another
   engine's skin format. Use a trusted source; skins can contain Lua code.
2. Extract its actual skin folder under `<user-data>/NoteSkins/pump/<skin-name>/`. Avoid an extra
   wrapper directory. Do not overwrite the bundled `default` skin.
3. Restart, then choose that skin in player options / NoteSkins. If it fails or is absent, return
   to `default` and check game-type/version compatibility.

Custom themes are optional and go under `<user-data>/Themes/<theme-name>/`, selected through
Appearance Options / Theme. Do not add a theme until the two smoke tests work with the default.
This guide does not require or endorse a third-party theme or skin download.

## 7. What to verify in the game

- Both songs appear, with ten Pump receptors and the expected left/right panel positions.
- Taps: four simultaneous DL+center pairs on the left pad, at ticks 0, 4, 8, 12.
- Holds: left UpLeft at ticks 0 and 16, right UpRight at ticks 8 and 24; each lasts four ticks.
- At four ticks per beat, the chart changes from 120 BPM to 150 BPM at beat 4. Expected audio
  times are beat 0 at 0.1 s, beat 4 at 2.1 s, and beat 8 at 3.7 s. The WAV lasts four seconds.
- Holds have distinct heads/bodies/tails. Keep the key pressed through each tail.
- Turn down volume before starting; this is a click-track fixture. Device/audio latency is not
  encoded into the chart. Do not rewrite its offset just to compensate for one machine's latency.

The Taps variant intentionally has a trailing rest. StepMania may finish gameplay based on the
last playable note rather than the exact model span; `replay.json` preserves that span. Use the
Holds variant to inspect the BPM transition. Record engine version, OS, selected theme/noteskin,
audio device, and any loading or timing problem before changing settings.

## 8. Generate another seed or your own bundle

```sh
node scripts/prepare-stepmania.mjs --out bundle/stepmania-next \
  --seed 0101010101010101010101010101010101010101010101010101010101010101

node scripts/prepare-stepmania.mjs --out bundle/my-playtest \
  --bundle /path/to/chart.bundle --audio /path/to/bound-music.wav \
  --title "My chart" --artist "My artist"
```

The demo has only two retained candidates, so new seeds do not create unlimited new musical
patterns. Custom mode exports one candidate; repeated `--history <candidate-id>` options use the
same exclusion/fallback semantics as `pump chart generate`. The helper does not author arbitrary
patterns from audio. Modify/rebuild a Rust author or use the package compilation workflow in
[chart-v2.md](chart-v2.md), then pass its bundle and **exact bound audio** here.

Titles/artists must satisfy the exporter's ASCII/escaping limits. Audio is limited to 32 MiB and
WAV/OGG/MP3 extensions; no audio decoding is certified. The helper performs integrity and semantic
reproduction checks, but does not supply a trusted publisher key. Use direct
`pump chart export-ssc ... --trusted-key <public-key>` when publisher authentication is required.
Never keep private signing keys inside a bundle directory you copy or distribute.

Restart StepMania to discover a new song. For changes to the selected existing song, the
documented Music Select shortcut is Ctrl+Shift+R. F2 reloads theme-related resources, not a general
replacement for song discovery. Keep originals outside the game: saving from StepMania's editor
can rewrite SSC data and invalidate the replay descriptor's recorded file hash.

## Troubleshooting and integration boundary

| Symptom | First checks |
| --- | --- |
| Song missing | Correct user root; group/song nesting; restart; Pump **Double** selected |
| Only four arrows / generated Dance chart | Wrong game/style or engine autogen; use the original Pump Double chart, not converted steps |
| No sound | `music.wav` beside SSC; OS output/volume; test the WAV independently |
| Constant timing shift | Audio device latency/global calibration; do not randomly alter source OFFSET |
| Skin errors | Revert to bundled Pump `default`; check 5.0.x Pump compatibility |
| Generator cannot execute | Linux binary needs Linux/WSL; run `./scripts/build.sh`; check Node 24 and Docker |
| Output already exists | Use a fresh `--out`; existing files are deliberately preserved |
| Export rejects timing/cell | Consult [SSC constraints](chart-v2.md#stepmania-and-outfox-ssc-export); no silent rounding is performed |

StepMania documents **Lua themes and noteskins**, but no standard procedural-generator plugin SDK
was identified in this baseline. Theme Lua is not a portable external Rust/WASM execution API.
The supported integration is therefore ordinary SSC/audio files in Songs folders (optionally
`AdditionalSongFolders`), not an injected plugin, live stream, or runtime code patch. Steam/network
multiplayer and the project's v1 HTTP gateway are not required.

## Evidence and upstream references

The helper was executed against the real CLI for demo and custom bundles. Tests compare candidate
identity, exact replay data, copied audio/SSC hashes, and rejection/no-clobber behavior. The export
format is independently tested with simfile 2.1.1. **The StepMania GUI was not launched here**:
desktop installation, rendering, sound, and physical input remain the checklist above. The official
release API lists all three installers; this environment's attempt to download the Linux asset
returned HTTP 404, so installer extraction and execution were not verified here.

- [Official downloads](https://www.stepmania.com/download/) and [release assets](https://api.github.com/repos/stepmania/stepmania/releases/tags/v5.0.12)
- [Installation guide](https://github.com/stepmania/stepmania/wiki/Install-Guide)
- [User-data paths and AdditionalSongFolders](https://github.com/stepmania/stepmania/wiki/User-Data-Locations)
- [Game modes](https://github.com/stepmania/stepmania/wiki/Supported-Game-Modes)
- [Keyboard shortcuts](https://github.com/stepmania/stepmania/wiki/Key-Bindings-and-combinations)
- [Bundled Pump noteskins](https://github.com/stepmania/stepmania/tree/v5.0.12/NoteSkins/pump) and [noteskin documentation](https://github.com/stepmania/stepmania/wiki/Noteskins)
- [Theme system](https://github.com/stepmania/stepmania/wiki/Theming)
- [Selected-song difficulty list](https://github.com/stepmania/stepmania/blob/v5.0.12/src/DifficultyList.cpp) and [playable steps](https://github.com/stepmania/stepmania/blob/v5.0.12/src/SongUtil.cpp)
- [CurrentGame startup preference](https://github.com/stepmania/stepmania/blob/v5.0.12/src/StepMania.cpp) and [menu labels](https://github.com/stepmania/stepmania/blob/v5.0.12/Themes/_fallback/Languages/en.ini)
