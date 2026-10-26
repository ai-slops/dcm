# PUMP Chart Studio Design System

Status: implementation contract for the first visual frontend. This document owns visual and interaction decisions. It does not define backend behavior or claim that unavailable data exists.

## 0. Research Log

- Design read: an operational creative tool for chart authors and technical reviewers, with a dark precision-instrument language. `DESIGN_VARIANCE: 5`, `MOTION_INTENSITY: 4`, `VISUAL_DENSITY: 9`.
- Embedded references: shortlisted Figma, Raycast, and Linear. Picked `taste-skill.md` plus `raycast.md`. Raycast supplies the dark blue-graphite chrome, inset edge lighting, compact keyboard-first controls, and physical key/button depth. Figma informed the shortlist because this is a creative editor, but its multicolor vocabulary would compete with ten-lane chart data. Linear was rejected as the primary source because its sparse product-management surface is too quiet for a dense timing editor.
- Operating references: read `design-system-architecture.md`, `layout-skill.md`, and `interaction-skill.md`. The layout contract uses one bounded app shell with named scroll owners. Interaction mechanics were inspected from the beui.dev `dock`, `tabs`, `drawer`, and `animated-badge` source. The unavailable `stateful` endpoint was not used.
- Designpowers: read routing, orchestration, Lane A direction, Lane C review, and Lane D handoff/debt guidance. The contract includes inclusive personas, adaptive preferences, explicit debt, and a downstream evidence gate.
- Lazyweb: ran 3 desktop queries: `music production DAW timeline piano roll editor`, `music sequencer beat grid editor inspector transport`, and `creative editor AI assistant sidebar proposals approval`. Viewed 9 returned screens from Soundtrap, Suno, Canva, Origami, Notion, Manus, and Tiptap. Harvested a stable editor shell, quiet chrome around a dense canvas, fixed transport, collapsible parameter groups, explicit empty/disabled states, contextual commands, and a dockable assistant rail. No screen, logo, copy, or branded asset is to be copied.
- Interaction evidence: beui.dev tabs use an interruptible shared indicator with a zero-motion fallback; drawer uses a scrim, Escape dismissal, scroll lock, and reduced-motion opacity fallback; dock uses a restrained active pill; animated badges swap status icon and label together. These mechanisms are adapted below, not vendored.
- UI/UX database: the required CLI was attempted, but `python3` is unavailable in the environment. The lane is recorded as skipped for that tool reason. Its documented accessibility rules still support 44px touch targets, visible labels, keyboard alternatives, tabular figures, and non-color state cues.
- Imagen concepts: skipped because no image-generation tool is available. No concept image was fabricated. This written contract is the visual source of truth.
- Product grounding: `docs/chart-v2.md` and `docs/evaluation-v2.md` were read. The interface must call results a finite-model assessment or uncalibrated rule model, never an official PUMP difficulty, human-safety guarantee, or subjective artistry score.
- Font implementation: Satoshi Variable is the unmodified official `Satoshi_Complete/Fonts/WEB/fonts/Satoshi-Variable.woff2` from `https://api.fontshare.com/v2/fonts/download/satoshi`; the archive's ITF Free Font License 2.0 is retained at `web/public/fonts/SATOSHI-LICENSE.txt`. IBM Plex Mono 400/500/600/700 is copied from the official `@ibm/plex-mono@2.5.0` npm package (`https://www.npmjs.com/package/@ibm/plex-mono`) with its SIL Open Font License 1.1 at `web/public/fonts/IBM-PLEX-LICENSE.txt`. Both families are served locally; the application makes no runtime font request to Fontshare, npm, or another CDN.

## 1. Atmosphere & Identity

PUMP Chart Studio should feel like a purpose-built rhythm instrument: dense, immediate, and trustworthy, with no marketing layer between the author and the beat grid. The room is graphite-black with cold metallic rims. Warm coral energizes the left pad and authoring actions; electric cyan identifies the second pad and live preview. The signature is the **split pulse**: the ten-lane grid, pad preview, and transport playhead share one precise coral-to-cyan timing event, so every edit visibly connects authored data to physical play.

The material is not generic glass. It is **machined graphite**: a matte blue-black fill, a one-pixel cool outer ring, an inset top sheen, an inset bottom shade, and a short tinted shadow only on floating surfaces. Grain, decorative glow, gradients behind text, and ambient animation are prohibited. Color is functional and restrained.

### Product principles

1. **Chart first.** The beat grid always owns the largest continuous area.
2. **Truth before confidence.** Show source, provider, save, runtime, and evaluation status explicitly. Never invent a metric or imply official certification.
3. **Direct manipulation first.** Tap, hold, select, erase, quantize, and inspect are visible tools. Agent commands supplement them.
4. **Review before mutation.** Agent proposals are previews with Apply and Discard. They never overwrite the chart automatically.
5. **Dense, not cryptic.** Compact controls retain labels, tooltips, focus order, and readable contrast.

### Inclusive personas

| Persona | Context | Primary task | Pass condition |
|---|---|---|---|
| Keyboard-first chart author | Expert, high-frequency editing, avoids pointer travel | Place and alter notes while maintaining timing context | Every editor action, lane, note, inspector field, transport control, and proposal decision is keyboard reachable |
| Touch and trackpad author | Tablet or compact laptop, possible temporary one-handed use | Audition, select, place, and inspect without precision tapping | Core targets are at least `--control-touch`; gestures have visible button alternatives |
| Low-vision reviewer | Uses zoom, high contrast, or screen magnification | Inspect timing, evaluation evidence, and proposal scope | UI works at 200% zoom; statuses include text/icons; focus and selection remain visible |
| Motion-sensitive reviewer | Reduced-motion preference | Follow playback and state changes without animated distraction | All spatial transitions become instant or opacity-only; playhead remains readable without trailing effects |
| New chart author | Understands rhythm but not the native pipeline | Import audio, set timing, create or generate, evaluate, export | The workflow exposes prerequisites and recovery without relying on agent chat |

## 2. Color

This product is dark-only for the first release. Dark-only is intentional for a studio surface and is not a missing theme. All implementation colors must reference these semantic tokens.

### Graphite surfaces and text

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--surface-canvas` | `#080B0F` | App background and outermost void |
| Shell | `--surface-shell` | `#0D1117` | Toolbar, transport, fixed rails |
| Panel | `--surface-panel` | `#121821` | Inspector and agent sections |
| Raised | `--surface-raised` | `#18202A` | Popovers, selected tool groups, proposal rows |
| Floating | `--surface-floating` | `#1E2834` | Modal, menu, tooltip |
| Sunken | `--surface-sunken` | `#07090C` | Beat grid field and numeric wells |
| Scrim | `--surface-scrim` | `rgb(2 5 8 / 0.72)` | Modal and drawer separation |
| Text primary | `--text-primary` | `#F4F7FA` | Main labels and values |
| Text secondary | `--text-secondary` | `#BCC6D1` | Descriptions and secondary controls |
| Text muted | `--text-muted` | `#8995A3` | Metadata; only on shell or lighter surfaces |
| Text disabled | `--text-disabled` | `#66717D` | Disabled control text with semantic disabled state |
| Border subtle | `--border-subtle` | `#202A35` | Internal dividers and minor grid boundaries |
| Border default | `--border-default` | `#2C3947` | Panel and control containment |
| Border strong | `--border-strong` | `#465669` | Hover and emphasized boundaries |

### Coral and cyan ramps

| Role | Token | Value | Usage |
|---|---|---|---|
| Coral low | `--coral-low` | `#3A1C1B` | Left-pad selected cell background |
| Coral mid | `--coral-mid` | `#C94E45` | Left-pad lane accents and note body |
| Coral primary | `--coral-primary` | `#FF7668` | Primary authoring action, left-pad active note, focus accent on authoring tools |
| Coral high | `--coral-high` | `#FFB2A9` | Left-pad hover edge and text on low coral |
| Cyan low | `--cyan-low` | `#123039` | Right-pad selected cell background |
| Cyan mid | `--cyan-mid` | `#2AA9BA` | Right-pad lane accents and note body |
| Cyan primary | `--cyan-primary` | `#55D7E7` | Right-pad active note and live playfield |
| Cyan high | `--cyan-high` | `#A9F3FA` | Right-pad hover edge and text on low cyan |

Coral is the product action accent. Cyan is a data identity for the second five-panel pad, not a competing CTA color. Primary buttons use coral. Agent Apply uses coral because it mutates the chart. Cyan may mark preview playback, right-pad lanes, links, and informational focus only.

### Semantic states

| Role | Token | Value | Required companion |
|---|---|---|---|
| Success | `--status-success` | `#6FD39A` | Check icon and status text |
| Warning | `--status-warning` | `#F1C65B` | Warning icon and reason text |
| Error | `--status-error` | `#FF6B76` | Error icon and recovery text |
| Info | `--status-info` | `#72B7FF` | Info icon or explicit label |
| Stale | `--status-stale` | `#C8A6FF` | Clock/refresh icon and `Stale` label |

### Chart-specific tokens

| Role | Token | Value | Usage |
|---|---|---|---|
| Beat line | `--grid-beat` | `#354353` | Whole-beat division |
| Measure line | `--grid-measure` | `#68798C` | Measure division with label |
| Subdivision | `--grid-subdivision` | `#1B252F` | Quantized subdivisions |
| Hover cell | `--grid-hover` | `rgb(244 247 250 / 0.08)` | Pointer/keyboard target preview |
| Selection fill | `--selection-fill` | `rgb(255 118 104 / 0.16)` | Selected range, always with outline |
| Selection outline | `--selection-outline` | `#FF9A8F` | Selection boundary |
| Playhead | `--playhead` | `#FFF0C7` | Current timing line and transport marker |
| Hold body | `--hold-fill` | `rgb(255 240 199 / 0.24)` | Hold duration, combined with pad-colored head/tail |
| Rejected pattern | `--rejected-pattern` | `repeating-linear-gradient(135deg, transparent 0 4px, rgb(255 107 118 / 0.24) 4px 6px)` | Rejected candidate overlay; not color alone |

### Color rules

- Never use color alone for lane, evaluation, save, provider, or proposal state.
- Coral and cyan text must be tested against their actual surfaces. Small text uses high-ramp values, not mid-ramp values.
- The beat grid remains neutral until data, selection, playback, or evaluation gives color a job.
- No raw hex, RGB, HSL, or named color may appear outside the token declaration layer.

## 3. Typography

### Font families

- Primary: self-hosted `Satoshi Variable` (official unmodified WOFF2, weight axis 300-900) with `font-display: swap`. Korean resolves through the host OS in this order: `Noto Sans CJK KR`, `Malgun Gothic`, `Apple SD Gothic Neo`, then `Arial`, `system-ui`, and generic `sans-serif`. Satoshi is Latin-only, so the CJK fallback is an explicit part of the implementation rather than an accidental generic fallback.
- Timing mono: self-hosted static `IBM Plex Mono` faces at 400, 500, 600, and 700 with `font-display: swap`. Use for ticks, beat positions, BPM, offsets, duration, note counts, candidate IDs, seed fragments, timestamps, and keyboard shortcuts. Korean uses the same explicit CJK OS fallback order before `ui-monospace` and generic `monospace`; CJK readability takes priority over preserving mono metrics for glyphs IBM Plex Mono does not contain.
- No serif. No Inter. No third family.

### Type scale

| Token | Size / line height | Weight | Tracking | Usage |
|---|---|---|---|---|
| `--type-title` | `20px / 26px` | 650 | `-0.01em` | Document title in toolbar |
| `--type-panel-title` | `15px / 20px` | 650 | `0` | Panel and modal heading |
| `--type-body` | `14px / 20px` | 500 | `0.01em` | Standard application text |
| `--type-body-strong` | `14px / 20px` | 650 | `0.005em` | Important row labels |
| `--type-label` | `12px / 16px` | 600 | `0.02em` | Field labels and compact controls |
| `--type-caption` | `11px / 15px` | 550 | `0.03em` | Metadata and helper text |
| `--type-pad-label` | `12px / 16px` | 700 | `0.03em` | Counter-scaled labels inside transformed playfield pads |
| `--type-mono-lg` | `18px / 22px` | 600 | `0.02em` | Main transport time and BPM |
| `--type-mono` | `13px / 18px` | 550 | `0.02em` | Tick, duration, offset, counts |
| `--type-mono-sm` | `11px / 15px` | 500 | `0.04em` | Ruler labels and candidate fragments |

### Typography rules

- All numeric data uses tabular figures. Timing columns align by decimal and never shift during playback.
- Visible body copy is never smaller than `--type-caption`; form input text is at least 16px on mobile to prevent browser zoom.
- Use sentence case. All-caps is reserved for the ten short lane labels and keyboard keycaps.
- Truncate document titles only in the toolbar, preserve the full value in the title field and accessible name.
- Status copy is factual and short: `Draft`, `Saving`, `Saved`, `No audio`, `Native runtime unavailable`, `Agent not configured`, `Proposal stale`.

## 4. Spacing & Layout

### Base scale

All visual spacing maps to this 4px scale. Intrinsic CSS mechanics such as `auto`, percentages, `minmax()`, and `clamp()` do not need tokens.

| Token | Value | Typical usage |
|---|---|---|
| `--space-0` | `0` | Reset |
| `--space-1` | `4px` | Icon-to-badge, tight grid labels |
| `--space-2` | `8px` | Compact control gap |
| `--space-3` | `12px` | Field and row padding |
| `--space-4` | `16px` | Panel padding |
| `--space-5` | `20px` | Comfortable group padding |
| `--space-6` | `24px` | Modal section separation |
| `--space-8` | `32px` | Empty-state breathing room |
| `--space-10` | `40px` | Large modal inset |

### Sizing tokens

| Token | Value | Usage |
|---|---|---|
| `--control-compact` | `32px` | Desktop dense toolbar control |
| `--control-default` | `36px` | Desktop field and button |
| `--control-touch` | `44px` | Touch and mobile minimum target |
| `--timeline-row-compact` | `34px` | Desktop timeline row |
| `--timeline-row-touch` | `44px` | Tablet, mobile, and coarse-pointer timeline row |
| `--toolbar-height` | `56px` | Desktop document toolbar |
| `--transport-height` | `64px` | Desktop bottom transport |
| `--mobile-tabs-height` | `52px` | Mobile Editor/Preview/Agent tabs |
| `--inspector-width` | `264px` | Desktop left rail |
| `--agent-width` | `360px` | Desktop right rail |
| `--preview-width` | `288px` | Desktop playfield preview pane |
| `--radius-xs` | `3px` | Grid notes and keycaps |
| `--radius-sm` | `6px` | Inputs, buttons, chips |
| `--radius-md` | `10px` | Panels, menus, proposal rows |
| `--radius-lg` | `14px` | Modals and floating surfaces |
| `--radius-pill` | `999px` | Status badges only |

### Breakpoints

| State | Width | Composition |
|---|---|---|
| Compact mobile | `< 600px` | One active tab: Editor, Preview, or Agent |
| Mobile/large phone | `600-767px` | Same tabs with roomier inspector sheets |
| Tablet | `768-1199px` | Toolbar + collapsible inspector + center studio; Agent is a drawer |
| Desktop | `1200-1599px` | Full left inspector, center studio, right Agent rail |
| Wide desktop | `>= 1600px` | Full shell; center grid gains space, side widths stay token-bound |

### Exact desktop composition

The root is a `scroll-body-shell` bounded to `100dvb` with rows `var(--toolbar-height) minmax(0, 1fr) var(--transport-height)`. The browser document does not scroll.

1. **DocumentToolbar**, fixed shell row: brand mark/name at start; editable document title; factual header badge `Uncertified draft`; centered undo/redo and save state; end cluster for import, export, and provider/runtime status.
2. **StudioBody**, bounded middle row with `min-block-size: 0`: columns `var(--inspector-width) minmax(0, 1fr) var(--agent-width)`.
3. **InspectorRail**, left: tool mode, quantization, timing configuration, selected note/range fields, generation/import actions. It owns vertical scrolling. Its panel header stays pinned.
4. **CenterStudio**, middle: above `1440px`, columns `minmax(420px, 1fr) var(--preview-width)`. From `1200-1439px`, it uses one grid-dominant column with the preview as a compact pane beneath the chart; a center-container query may switch to side-by-side only when at least `708px` is actually available. The beat grid is always the primary canvas. The preview pane shows the live ten-panel playfield and compact evaluation evidence. Both share the current tick and selection.
5. **AgentRail**, right: status header, conversation/tool-state stream, proposal queue, and anchored composer. The stream owns vertical scrolling; header and composer do not scroll.
6. **TransportBar**, fixed shell row spanning all columns: playback cluster, mono time/beat readout, scrubber, loop/range controls, BPM/tempo context, zoom, and audio state.

Only these regions scroll vertically: Inspector body, Agent stream, and any modal body that exceeds its cap. The chart canvas pans vertically by time and may pan horizontally only when browser zoom or text scaling makes ten lanes wider than its viewport. No wheel event should ambiguously move two regions.

### Center studio geometry

- Time flows top to bottom. Ten lanes run left to right in project order: left `DL UL C UR DR`, then right `DL UL C UR DR`.
- The ruler is pinned to the start edge of the grid. Measure labels and exact tick/beat values use mono type.
- Lane headers remain visible while the beat grid scrolls. Left five lanes use coral identifiers; right five use cyan identifiers. Lane headers also include `L` or `R`, so color is not the only cue.
- The Studio always visualizes the native ten-lane DCM chart. When the persisted UCS preference is Single, show the compact factual context `DCM 10 lanes · UCS Single uses left pad`; do not hide the right pad or imply Single changes the native chart model.
- New placements snap down to the selected edit grid; existing notes and every native display row remain unchanged. A snapped placement onto an occupied target is rejected rather than replacing another note. Tap is a compact head. Hold is a head, duration body, and tail. The body uses `--hold-fill`; head and tail preserve pad identity.
- The grid exposes a visible keyboard cursor, pointer hover target, selected cells/range, current playhead, and evaluation overlays as separate layers.
- The preview pane contains the physical two-pad diamond layout, current contacts, upcoming contacts, and exact current beat. It does not imitate a game skin or claim in-engine fidelity.

### Tablet composition

- Inspector collapses to a `Tools` button and opens as a left drawer no wider than `min(var(--inspector-width), 88vw)`.
- CenterStudio uses all remaining width. Preview becomes a collapsible pane beneath the chart or a `Preview` side sheet in landscape.
- Agent opens as a right drawer. Its proposal state is retained when closed.
- Transport remains fixed; secondary controls move into an overflow menu while play/pause, time, scrubber, and audio state remain visible.

### Mobile composition

- Use top-level tabs `Editor`, `Preview`, and `Agent` below the document toolbar. This avoids a fixed desktop minimum width.
- **Editor tab:** compact tool rail, ten-lane grid with pinch-independent zoom buttons, and bottom transport. Horizontal grid scrolling is allowed only inside the grid, with lane headers in the same scroll context.
- **Preview tab:** large two-pad playfield, current beat/time, compact playback and evaluation state, plus a button to return to the selected tick in Editor.
- **Agent tab:** full-height agent stream and proposals. Apply/Discard remain visible with each proposal and never hide behind the composer.
- Inspector fields open in a bottom sheet from the selected note/range or `Tools` button.
- The active tab is preserved through orientation changes. Primary content never creates page-level horizontal scroll.

### Layer scale

| Token | Level | Usage |
|---|---|---|
| `--layer-base` | `0` | Canvas and standard panels |
| `--layer-sticky` | `10` | Grid headers and pinned panel headers |
| `--layer-popover` | `30` | Menus, tooltips, command palette |
| `--layer-drawer` | `50` | Tablet/mobile drawers and sheets |
| `--layer-modal` | `70` | Modal and scrim |
| `--layer-toast` | `90` | Nonblocking status notification |

## 5. Components

### Common state contract

Every interactive primitive implements default, hover, pressed, focus-visible, disabled, busy where asynchronous, and error where input can fail.

- Hover: strengthen border or text one ramp step. Never rely on hover for meaning.
- Pressed: `translateY(1px)` or `scale(0.98)` using `--motion-press`; never change layout bounds.
- Focus-visible: use `--depth-focus-coral` for authoring actions or `--depth-focus-cyan` for grid/data controls. Both recipes include a `2px` separation from the component edge.
- Disabled: semantic `disabled` or `aria-disabled`, no pointer action, text uses `--text-disabled`, and a nearby reason or tooltip exists when the reason is not obvious.
- Busy: preserve label width when practical, show progress icon plus a text change, and announce through a polite live region.
- Errors: remain adjacent to the failed field/action and state both cause and recovery.

### Button

- **Structure:** semantic `button`, optional leading Lucide icon, one-line label, optional keycap.
- **Variants:** primary coral, secondary graphite, ghost, destructive, and proposal Apply/Discard pairing.
- **Spacing:** height `--control-default`, horizontal `--space-3`; mobile height `--control-touch`.
- **States:** common contract; primary busy states include `Saving`, `Generating`, `Evaluating`, or `Exporting` rather than a generic spinner.
- **Accessibility:** label describes the result, not the icon. Destructive actions open confirmation only when not immediately undoable.
- **Motion:** press only; async label/icon crossfade with no width jump.
- **Layout:** `cluster`; labels never wrap.

### IconButton

- **Structure:** semantic button with one Lucide icon and mandatory accessible name; tooltip repeats the label and optional shortcut.
- **Variants:** toolbar, transport, selected tool, and danger.
- **Spacing:** visual box `--control-compact`; hit target expands to `--control-touch` on touch-capable layouts.
- **States:** common contract plus `aria-pressed` for persistent tools and toggles.
- **Accessibility:** familiar icons still require labels. Do not mix icon families or strokes.
- **Motion:** active pill glides only within a grouped toolbar, following the inspected beui.dev dock mechanism. Reduced motion swaps instantly.
- **Layout:** `cluster` or tool dock.

### Field

- **Structure:** visible label, control, optional unit suffix, helper text, and inline error.
- **Variants:** text, number, select, segmented, file, seed, and read-only value.
- **Spacing:** `--space-2` between label and control; group fields with `--space-3`.
- **States:** default, hover, focus, read-only, disabled, invalid, and busy lookup.
- **Accessibility:** native input semantics; numeric units included in accessible description; invalid submit focuses the first invalid field.
- **Motion:** color/opacity only.
- **Layout:** `stack`; related tempo fields use a fieldset and legend.

### Panel

- **Structure:** header cluster, optional status/actions, bounded body, optional footer.
- **Variants:** rail, sunken grid, raised preview, floating popover, and modal section.
- **Spacing:** header `--space-3` by `--space-4`; body `--space-4`; dense rows may use `--space-3`.
- **States:** default, collapsed, loading, empty, error, and unavailable.
- **Accessibility:** heading names the region; collapsible headers are buttons with `aria-expanded` and `aria-controls`.
- **Motion:** collapse uses opacity/transform or measured shared layout, never animated raw height. Reduced motion is instant.
- **Layout:** `stack`; each scroll owner is named in Section 4.

### Tab

- **Structure:** `tablist`, labelled tabs, and associated `tabpanel`.
- **Variants:** mobile top-level and compact inspector segments.
- **Spacing:** mobile target height `--mobile-tabs-height`; compact segments use `--control-compact`.
- **States:** default, selected, hover, focus, disabled, and attention badge.
- **Accessibility:** arrow-key navigation, Home/End, `aria-selected`, and preserved panel state.
- **Motion:** shared selected indicator uses the beui.dev tabs spring mechanism; content uses a short opacity swap. Reduced motion is instant.
- **Layout:** scroll-safe `reel` if labels do not fit; no clipped focused tab.

### Badge

- **Structure:** status icon, short label, optional detail tooltip.
- **Variants:** neutral, info, success, warning, error, running, stale, and draft.
- **Spacing:** height `24px`; inline gap `--space-1`; pill radius reserved for this primitive.
- **States:** label and icon always change together. Running may pulse opacity only.
- **Accessibility:** status changes announce only when actionable or workflow-significant. Decorative repetition is prohibited.
- **Motion:** icon/label crossfade or short vertical swap based on beui.dev animated-badge; no loop under reduced motion.
- **Layout:** inline `cluster`.

### ToolChip

- **Structure:** optional icon, verb-first label, optional shortcut.
- **Variants:** `Tap`, `Hold`, `Select`, `Erase`, quantization value, and removable filter/tag.
- **Spacing:** `--control-compact` desktop; `--control-touch` mobile.
- **States:** default, selected, hover, focus, disabled. Selected has icon, text weight, and surface change.
- **Accessibility:** `aria-pressed`; direct keyboard shortcuts never override browser or assistive shortcuts.
- **Motion:** common press; selected background glides within a group only.
- **Layout:** wrapping `cluster`.

### TimelineCell

- **Structure:** semantic gridcell with lane, tick, note type, selection, and evaluation state; visual layers for subdivision, note, selection, and cursor.
- **Variants:** empty, tap, hold head/body/tail, selected, playhead intersection, accepted evidence, rejected witness, and conflict.
- **Spacing:** display rows use native ticks and the row-height token. Editing quantization never thins existing data or removes off-grid heads/tails from view.
- **States:** hover target, keyboard cursor, selected, dragging/painting, invalid preview, committed, and read-only during evaluation snapshot.
- **Accessibility:** grid has row/column counts and labels. Focused cell announces pad side, panel, beat/tick, note type, and duration. Provide a structured note-list alternative for screen-reader editing and review.
- **Motion:** note commit uses a brief opacity/scale confirmation; playhead uses transform only; reduced motion removes scale and smooth following.
- **Layout:** virtualized two-dimensional grid when needed. Focus and selected note must survive virtualization.

### PlayfieldPreview

- **Structure:** two labelled five-panel diamonds, current contact state, upcoming contact summary, and exact beat/time.
- **Variants:** idle, playing, selected-tick preview, no audio, and unavailable runtime.
- **Spacing:** pad gap `--space-4`; panel gap `--space-2` desktop and `--space-3` touch.
- **States:** contact uses fill plus inner ring; hold contact uses a duration mark; upcoming uses outline only.
- **Accessibility:** linear DOM reading order matches lane order. A text summary states current contacts and next change.
- **Motion:** contact state crossfades; no arcade flashes, bounce, or particles.
- **Layout:** `frame` within preview panel; scales without changing panel geometry.

### Transport

- **Structure:** previous/step, play/pause, stop, mono time/beat, scrubber, loop/range, tempo context, zoom, and audio/runtime state.
- **Variants:** desktop full, tablet reduced, mobile essential.
- **Spacing:** fixed shell row `--transport-height`; groups separated by `--space-4` and internal gap `--space-2`.
- **States:** stopped, playing, seeking, loop active, no audio, audio loading, and playback error.
- **Accessibility:** play/pause label reflects action; scrubber exposes min/max/current text; Space shortcut is active only when focus is not in an editable field.
- **Motion:** playhead transform follows time; play/pause icon crossfades. No waveform or fake spectrum when audio data is unavailable.
- **Layout:** fixed `cluster`; lower-priority groups enter overflow before essentials disappear.

### ProposalRow

- **Structure:** proposal title, explicit scope, factual diff summary, affected tick/lane range, source/tool state, stale indicator if applicable, preview toggle, Apply, and Discard.
- **Variants:** pending, previewing, applying, applied, discarded, stale, and failed.
- **Spacing:** `--space-3` internal; `--space-2` action gap.
- **States:** stale disables Apply and offers `Regenerate`; failed keeps proposal text and recovery. Applied and discarded are immutable history rows.
- **Accessibility:** proposal summary is navigable before actions; preview links focus the affected chart range; applying announces result without moving focus unexpectedly.
- **Motion:** preview highlight crossfades on the grid; row status morph is opacity-only under reduced motion.
- **Layout:** repeated `stack` inside Agent rail. Actions remain adjacent and never collapse into one ambiguous approval control.

### AgentRail

- **Structure:** provider/status header, cancel control while running, scrollable event stream, proposal rows, starter actions when empty, and anchored composer.
- **Variants:** unconfigured, ready, running, streaming, cancelled, proposal available, error, and offline/unavailable.
- **Spacing:** header/body/composer use `--space-4`; event groups use `--space-3`.
- **States:** never fabricate assistant replies. Show only real prompts, tool events, provider messages, errors, and proposals received from runtime data.
- **Accessibility:** provider and running state are textual; streamed updates use a throttled polite live region; Cancel is keyboard reachable and does not clear prior events.
- **Motion:** streaming indicator may pulse opacity. Drawer uses the inspected beui.dev mechanism: scrim, Escape, focus trap/return, interruptible transform, opacity-only reduced-motion fallback.
- **Layout:** desktop fixed rail with stream as sole scroll owner; tablet drawer; mobile full tab.

### Modal

- **Structure:** labelled dialog, concise description, body, validation summary, secondary action, and one primary action.
- **Variants:** audio import, JSON import, JSON export, SSC ZIP download, tempo configuration, and destructive confirmation.
- **Spacing:** `--space-6` sections; `--space-4` body; max body height uses intrinsic viewport mechanics.
- **States:** default, validating, ready, submitting, success, and error.
- **Accessibility:** modal focus trap, initial focus on heading or first field, Escape unless operation is non-cancellable, explicit close, focus return to trigger.
- **Motion:** center scale/opacity for desktop, bottom-sheet transform for mobile; opacity-only reduced motion.
- **Layout:** `imposter` above scrim; body is the only scroll owner.

### Primitive showcase gate

Before composing the studio screen, implementation must render Button, IconButton, Field, Panel, Tab, Badge, ToolChip, TimelineCell, PlayfieldPreview, Transport, ProposalRow, AgentRail, and Modal in every applicable state at 375px, 768px, and 1280px. Product-screen implementation starts only after this state harness passes visual and keyboard review.

## 6. Motion & Interaction

### Motion tokens

| Token | Value | Usage |
|---|---|---|
| `--motion-instant` | `0ms` | Reduced-motion spatial changes |
| `--motion-press` | `90ms cubic-bezier(0.2, 0.8, 0.2, 1)` | Press response |
| `--motion-micro` | `140ms cubic-bezier(0.2, 0.8, 0.2, 1)` | Hover, icon, status tint |
| `--motion-standard` | `220ms cubic-bezier(0.16, 1, 0.3, 1)` | Popover, panel content swap |
| `--motion-panel` | `320ms` interruptible spring, stiffness `340`, damping `34`, mass `0.9` | Drawer and shared tab indicator |

### Signature interaction

On note placement or playback, one timing event travels through three surfaces without decorative flourish: the TimelineCell commits, the matching physical panel gains its contact ring, and the transport playhead reaches the same time. During audio playback, holds are active on `[head time, tail time)` and taps show one documented visual pulse on `[head time, head time + 120ms)`; grouped notes combine their active contacts. Stopped selected-tick preview may show a tap only at its exact selected tick. The response uses opacity only and becomes an instant state update under reduced motion. This is the split pulse.

### Editor input model

- **Tap tool:** pointer click/tap or keyboard activation places/removes a tap at the quantized cell.
- **Hold tool:** press/drag defines head and duration; keyboard users set head, extend/shrink by quantized step, then commit. A numeric duration field is always available.
- **Select tool:** click selects one note; Shift extends; drag creates a range; keyboard arrows move the cursor and Shift+arrows extend selection.
- **Erase tool:** click/tap erases one note; drag paints erasure only after a movement threshold. Undo remains available.
- **Quantization:** visible ToolChip value; changing it affects future edits and snapping, not existing notes unless an explicit quantize command is confirmed.
- **Inspector:** selected note/range exposes exact tick, lane, duration, note type, and any evaluation witness. Values validate on blur or submit, not every keystroke.

### Global interaction rules

- Undo/redo applies to user edits and applied proposals. Discarding an unapplied proposal does not enter chart history.
- A dirty document never loses edits silently. Navigation/import that replaces it asks to save, discard, or cancel.
- Agent proposals capture the chart revision they were generated against. Any subsequent edit marks them stale. Stale proposals cannot Apply.
- Async actions show a cancellable state when the backend supports cancellation. Never show a Cancel control that cannot cancel.
- Animate only transform, opacity, and filter. Do not animate width, height, top, left, grid tracks, or scroll position through React state.
- Spatial animation is interruptible. Color/opacity transitions use timing tokens.
- `prefers-reduced-motion: reduce` disables smooth playhead following, spring travel, scale confirmation, animated panel travel, and looping status animation. The playhead may update discretely.

## 7. Depth & Surface

Depth strategy: **mixed tonal shift plus paired outer/inset edges**. This is adapted from Raycast's macOS-like chrome, but made flatter and denser for an editor.

### Surface recipes

| Token | Recipe | Usage |
|---|---|---|
| `--depth-flat` | No shadow; `--border-subtle` divider only where structure needs it | Grid, rail sections, list rows |
| `--depth-control` | Outer `0 0 0 1px rgb(255 255 255 / 0.07)`, inset top `0 1px 0 rgb(255 255 255 / 0.08)`, inset bottom `0 -1px 0 rgb(0 0 0 / 0.28)` | Buttons, chips, keycaps |
| `--depth-panel` | Outer `0 0 0 1px rgb(255 255 255 / 0.05)`, inset `0 1px 0 rgb(255 255 255 / 0.035)` | Preview and raised panels |
| `--depth-floating` | `0 16px 40px rgb(0 0 0 / 0.42)`, outer ring, inset top sheen | Menus, drawers, modal |
| `--depth-focus-coral` | `0 0 0 2px var(--surface-canvas), 0 0 0 4px var(--coral-primary)` | Authoring control focus |
| `--depth-focus-cyan` | `0 0 0 2px var(--surface-canvas), 0 0 0 4px var(--cyan-primary)` | Grid/right-pad/data focus |

### Surface rules

- Surface level changes only when the element has a real spatial role. Do not wrap every group in a card.
- Border plus inset highlight must be paired. Single heavy drop shadows are prohibited.
- Blur is reserved for modal/drawer scrims. Standard panels are opaque.
- The grid uses no box shadow. Measures, subdivisions, data, and selection create its depth.
- Rounded shape hierarchy is fixed: cells/keycaps `xs`, controls `sm`, panels `md`, modal `lg`, badges `pill`.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA. Body and control text must reach 4.5:1; large text and essential graphical boundaries must reach 3:1.
- Every action is keyboard reachable in logical visual order. Provide a skip link to the chart editor and a shortcut reference modal.
- The beat grid implements the ARIA grid pattern only if focus and announcements remain performant. A synchronized structured note list is mandatory as the screen-reader editing/review alternative.
- Color never carries pad side, selection, status, or evaluation alone. Use side labels, outlines, icons, patterns, and text.
- At 200% browser zoom, desktop may transition to tablet composition. No primary control or proposal action may disappear.
- Touch targets are at least `--control-touch`; adjacent touch targets have at least `--space-2` effective separation.
- Tablet layouts through `1199px` and any coarse-pointer environment use `--control-touch` for toolbar, transport, proposal, tool, timeline, tab, field, and dialog controls. Timeline rows use `--timeline-row-touch`; the playhead continues to derive travel from the computed row token.
- Playfield captions remain at least `--type-pad-label` after the diamond transform is applied. Inactive pads use `--text-secondary` on `--surface-sunken`; active left/right pads use their high-ramp text on low-ramp backgrounds so all caption states meet 4.5:1.
- Do not disable browser zoom or system gestures. Pinch on the editor must not be the only zoom path.
- Focus is never hidden by fixed toolbar, tabs, transport, drawers, or composer.
- Dynamic status uses restrained live regions. Playback ticks, streaming tokens, and every save keystroke are not announced. Announce state changes such as `Playback started`, `Save failed`, `Proposal ready`, and `Evaluation rejected`.
- All motion follows Section 6. No autoplay audio. Audio import does not begin playback.
- Errors state cause and recovery. `Native runtime unavailable` must explain which actions remain available.
- English UI copy uses concrete verbs and plain language. Avoid metaphors in controls and error messages.

### Cognitive accessibility

- Keep direct editing, evaluation, and agent proposal actions visually separated.
- Preserve control locations across states. Loading and empty states must not reflow the entire shell.
- Confirm replacement/import and destructive bulk changes. Make single-note edits undoable instead of repeatedly confirming.
- Show proposal scope and revision before Apply. Applied proposals enter undo history.
- Avoid simultaneous animated indicators. At most one workflow-significant looping indicator appears per region.

### Accepted debt

| ID | Item | Location | Affected users | Why accepted | Owner / exit |
|---|---|---|---|---|---|
| D-001 | Dark-only first release | Entire studio | Users requiring a light theme | The requested studio direction is explicitly dark and no UI exists yet | Revisit only after real user testing identifies a light-theme need |
| D-002 | Exact screen-reader interaction model for a virtualized ten-lane grid is not yet implementation-tested | Timeline editor | Screen-reader chart authors | This contract defines a mandatory structured note-list alternative, but implementation evidence does not yet exist | Frontend owner must test grid plus list with NVDA/VoiceOver before release; unresolved failure blocks release |

No Critical or Major accessibility issue may be added to this table as ordinary debt. It must be fixed or treated as a blocker.

## 9. Content, Workflow & Product States

### Content blocks and jobs

| Block | Job | Required content |
|---|---|---|
| Document toolbar | Navigate and establish trust | Title, `Uncertified draft`, dirty/save state, undo/redo, import/export, runtime/provider status |
| Inspector | Configure and explain | Tool, quantization, selected tick/lane/duration, title/BPM/offset/tempo map, import/generate actions |
| Beat grid | Author | Ten lanes, exact timing ruler, notes/holds, selection, playhead, evaluation overlays |
| Playfield preview | Connect chart to physical layout | Two five-panel diamonds, current/upcoming contacts, exact beat/time, no game-skin claim |
| Transport | Audition and orient | Stop/play, time/beat, scrub, loop/range, tempo, zoom, audio status |
| Agent rail | Assist without taking control | Provider state, real tool events/messages, scoped proposals, Apply/Discard, cancel and recovery |
| Evaluation view | Explain | Finite-model label, accepted/rejected/error, typed witnesses, exact evidence and scope |
| Export/import modals | Transfer safely | JSON import/export and SSC ZIP download prerequisites, validation, progress, recovery |

### Primary authoring workflow

1. Open the default demo when backend demo data is available. Do not hardcode fake note counts, duration, provider status, or evaluation metrics.
2. Import audio or continue without audio. The no-audio state keeps chart editing available and marks audition/export prerequisites clearly.
3. Set title, BPM, offset, and tempo configuration. Use the actual 120-to-150 BPM demo tempo change only when supplied by repository/backend data.
4. Choose Tap, Hold, Select, or Erase and a quantization value.
5. Edit the ten-lane chart. The inspector reflects actual tick, lane, and duration for the current selection.
6. Undo/redo freely. Dirty state changes to Saving and Saved only from real persistence events.
7. Evaluate with the native finite model when available. Present Accepted, Rejected, or Error with evidence. Never call this official difficulty or safety certification.
8. Export JSON or download an SSC ZIP only after validation. Show exact note count and duration only when computed from chart data.

### Seed generation workflow

1. `Seed generate` opens a modal or inspector group with seed and generation prerequisites.
2. A blank seed is allowed only if the API contract defines how it is generated; otherwise require the canonical value.
3. Running state shows real progress if available, otherwise an indeterminate `Generating` state and Cancel only if supported.
4. The result is a candidate preview, not an automatic replacement. Show candidate ID and actual counts when returned.
5. User chooses `Use candidate` or `Cancel`. Replacing a dirty chart requires explicit confirmation and remains undoable when technically possible.

### Agent proposal workflow

1. Unconfigured state shows `Configure agent` and names no provider until one is actually configured.
2. Running and streaming show actual provider/tool events. Do not synthesize conversational filler or fake replies.
3. Each proposal names its scope, revision, affected lanes/ticks, and concrete operation summary.
4. `Preview` highlights proposed differences without mutating chart state.
5. `Apply` is the only mutation path. It records one undoable history entry.
6. `Discard` closes the proposal without changing the chart.
7. Editing the chart after proposal creation marks it `Stale`; Apply becomes unavailable and `Regenerate` is offered.
8. Cancelled keeps completed events and labels the run `Cancelled`. Error keeps the prompt and offers a factual retry path.

### Import/export workflow

- **Audio import:** native file picker, selected filename/type/size from real file metadata, validating state, success or clear unsupported/error message. Do not expose arbitrary server paths.
- **JSON import:** preview validated title, note count, duration, tempo events, and warnings before replacing. Invalid data shows field/path-specific errors. No partial silent import.
- **JSON export:** export current chart and metadata with real dirty/save context. Filename derives from actual title with safe fallback.
- **SSC ZIP download:** label exactly `Download SSC ZIP`. Explain that export targets StepMania/OutFox, uses pump-double lane order, and is not in-engine validation. Missing audio/native CLI/runtime has a specific blocking reason.
- **UCS import:** use a dedicated `UCS transfer` dialog. Require one `.ucs` file and allow optional WAV/OGG/MP3 audio. If audio is omitted, state `Current project audio will be kept.` Import is available only for a persisted draft and accepts the returned native document as the complete chart/timing replacement.
- **UCS export:** require an explicit `Single` or `Double` selection, initially `project.ucs_mode ?? Double`. Disable export while the visible draft is dirty because the native endpoint serializes the saved revision, show `Save your changes before exporting UCS.`, and never silently omit visible edits. Single maps to the left five native panels; right-pad notes produce a clear native error. Download only the returned UCS blob with a title-derived `.ucs` filename; never package or download project audio.

- **Timeline chrome:** controls and timing context wrap within the owning pane, outside the independently scrolling chart canvas. Lane headers stick within that canvas. The app shell uses a bounded zero-minimum column so toolbar/transport actions never force content beyond the viewport.
- **Preview context:** both editor and physical-pad preview reuse the same media-clock timing readout. Read-only pad boxes stay at least `--space-6` wide at supported viewports; added mode/context copy must not shrink their labels. Checkboxes retain a compact glyph within a `--control-touch` label target.

- **UCS preference persistence:** radio changes update `project.ucs_mode` as ordinary draft metadata. Close the transfer dialog and Save before downloading; reload must retain the chosen mode. Export itself never silently mutates project metadata.

### Functional state matrix

| State | Header | Center studio | Inspector/transport | Agent/evaluation |
|---|---|---|---|---|
| Default demo | `Uncertified draft` plus actual save state | Demo notes only from real source data | Tools enabled; audio reflects actual availability | Agent/provider factual; no fake messages |
| No audio | `No audio` warning badge | Grid remains editable; preview works by tick | Play disabled or silent-preview labelled; Import audio offered | Evaluation may continue only if contract permits |
| Missing native CLI/runtime | `Native runtime unavailable` error badge | Browser-local editing remains available | Native-only generate/evaluate/export actions disabled with reasons | Agent is independent unless it depends on runtime |
| Stopped | Save state visible | Static playhead at current tick | Play action available | No streaming playback announcements |
| Playing | Save state unchanged | Playhead and preview contacts update | Pause/Stop available; exact time updates | Agent proposals remain reviewable, Apply may require stop if mutation cannot be safe |
| Dirty | `Unsaved changes` | Edits visible immediately | Save enabled; navigation guard active | Existing proposals become stale if chart revision changed |
| Saving | `Saving` with progress icon | Editing policy follows persistence contract and is explicit | Save disabled only while request is in flight | Failure announces and preserves dirty state |
| Saved | `Saved` transiently, then quiet | No visual reflow | Save returns to default | No celebratory animation |
| Evaluation accepted | Draft status remains | Evidence markers use success icon/pattern | Summary names finite-model scope | `Accepted by finite model`, never `Certified difficulty` |
| Evaluation rejected | Draft status remains | Rejected witness range highlighted with pattern | Recovery links focus affected ticks | `Rejected` with typed reason and evidence |
| Evaluation error | Draft status remains | Existing chart remains untouched | Retry if safe; error cause shown | Do not display rejected semantics for fatal errors |
| Agent unconfigured | Provider absent | Chart fully usable | No editor action disabled because of agent | Setup message and Configure action only |
| Agent running | Provider name/status real | Chart editable unless API requires snapshot lock | Cancel shown only if supported | Tool events, no invented reply |
| Agent streaming | Provider/status real | Proposed highlights only after structured proposal exists | No auto-apply | Throttled stream, accessible status |
| Agent cancelled | Stable | Chart unchanged | Retry available | Prior events retained and labelled Cancelled |
| Proposal pending | Stable | Optional preview markers | Direct tools still usable | Preview, Apply, Discard |
| Proposal stale | Stable | Old preview removed or clearly stale | Direct tools usable | Apply disabled; Regenerate and Discard |

### Copy contract

- Header badge: `Uncertified draft`.
- Assessment heading: `Finite-model assessment`.
- Difficulty descriptor: `Uncalibrated rule model`.
- Required disclaimer: `This is not an official PUMP rating or a guarantee of human safety.`
- Empty agent: `No agent activity yet. Configure a provider or ask for a scoped chart change.`
- Missing runtime: `Native runtime unavailable. Editing is available, but native generation, evaluation, and SSC export are not.`
- Stale proposal: `This proposal was created for an earlier chart revision. Regenerate it before applying.`
- Never use `AI-powered`, `magic`, `official difficulty`, `certified safe`, or invented performance claims.

### Handoff and verification gate

- The frontend worker must read this entire file before writing components.
- All visual values in implementation must resolve to tokens in Sections 2-7. New reusable values are added here first.
- Build and visually verify the primitive showcase before the product screen.
- Final visual QA must exercise 375px, 768px, and 1280px; 200% zoom; keyboard-only flow; reduced motion; no-audio; missing-runtime; dirty/saving; evaluation accepted/rejected/error; every agent state; long title; unbroken candidate ID; empty proposal list; and overflowing event stream.
- Significant implementation work closes through objective visual QA followed by design/accessibility/heuristic/persona review and the project review gate.
- The implementation handoff must cite screenshots/evidence, unresolved debt, actual data sources for visible counts/duration/provider status, and any deviation from this contract.
