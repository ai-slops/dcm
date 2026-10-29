import { Music2, SkipForward } from "lucide-react"
import { useMemo, useState } from "react"

import type { LibraryChartDocument, LibrarySnapshot } from "../../shared/library.ts"
import { libraryApi } from "../api/library-client.ts"
import { canControlPlayback } from "./audio-playback-state.ts"
import { browserAudioPlaybackEnvironmentFor } from "./audioPlaybackEnvironment.ts"
import { PrimitiveStateHarness } from "./PrimitiveShowcase.tsx"
import { Badge, Button, Panel, ToolChip } from "./primitives.tsx"
import { PlayfieldPads, Preview } from "./StudioPanels.tsx"
import { Timeline } from "./Timeline.tsx"
import { Transport } from "./Transport.tsx"
import {
  type AudioPlaybackController,
  useAudioPlaybackSource,
  usePlaybackSnapshot,
} from "./useAudioPlayback.ts"

const galleryViews = ["player", "timeline", "pads", "transport", "primitives"] as const
type GalleryView = (typeof galleryViews)[number]

export function PreviewGalleryDocument({
  document,
  library,
}: {
  readonly document: LibraryChartDocument
  readonly library: LibrarySnapshot
}) {
  const [view, setView] = useState<GalleryView>("player")
  const hasAudio = document.song.audio.byte_length > 0
  const environment = useMemo(
    () => browserAudioPlaybackEnvironmentFor(() => libraryApi.songAudio(document.song.id)),
    [document.song.id],
  )
  const sourceKey = `${document.chart.id}:${document.song.audio.sha256}`
  const playback = useAudioPlaybackSource(document.project, {
    key: sourceKey,
    environment,
    hasAudio,
  })
  const archive = library.archives.find((candidate) => candidate.id === document.song.archive_id)
  const provenanceUrl =
    archive?.source_url?.startsWith("https://") || archive?.source_url?.startsWith("http://")
      ? archive.source_url
      : undefined
  return (
    <>
      <section className="preview-gallery__meta">
        <div>
          <Music2 aria-hidden="true" size={18} />
          <span>
            <strong>{document.song.title}</strong>
            <small>{document.song.artist}</small>
          </span>
        </div>
        <Badge tone={hasAudio ? "success" : "warning"}>
          {hasAudio ? `${document.song.audio.format.toUpperCase()} audio` : "Audio missing"}
        </Badge>
        <span className="mono">SHA {document.song.audio.sha256.slice(0, 12)}</span>
        {provenanceUrl === undefined ? (
          <span className="preview-gallery__provenance">
            {archive?.name ?? "Locally stored song"}
          </span>
        ) : (
          <a
            aria-label={`Source provenance URL: ${provenanceUrl}`}
            className="preview-gallery__provenance"
            href={provenanceUrl}
            rel="noreferrer"
            target="_blank"
          >
            {provenanceUrl}
          </a>
        )}
        <FirstNoteButton playback={playback} firstBeat={document.project.notes[0]?.at} />
      </section>
      {!hasAudio ? (
        <p className="preview-gallery__missing">
          This song has no stored audio. Playback stays disabled.{" "}
          <a href="/">Add audio in Songs and charts.</a>
        </p>
      ) : null}
      <nav className="preview-gallery__views" aria-label="Preview components">
        {galleryViews.map((name) => (
          <ToolChip key={name} pressed={view === name} onClick={() => setView(name)} type="button">
            {name}
          </ToolChip>
        ))}
      </nav>
      <Panel
        title={`${document.chart.name} · ${document.chart.mode}`}
        className="preview-gallery__player"
      >
        {view === "player" ? (
          <Preview
            notes={document.project.notes}
            timing={document.project.timing}
            mode={document.chart.mode}
            playback={playback}
          />
        ) : null}
        {view === "pads" ? (
          <PlayfieldPads
            notes={document.project.notes}
            timing={document.project.timing}
            playback={playback}
            mode={document.chart.mode}
          />
        ) : null}
        {view === "timeline" ? (
          <div className="preview-gallery__timeline">
            <Timeline
              notes={document.project.notes}
              timing={document.project.timing}
              mode={document.project.mode}
              playback={playback}
              {...(document.chart.generated_from === undefined
                ? {}
                : { automaticRegions: document.chart.generated_from.automatic_regions })}
              readOnly
              onRowsPerMeasureChange={() => undefined}
              onToggleTap={() => undefined}
              onPlaceHold={() => undefined}
            />
          </div>
        ) : null}
        {view === "transport" ? <Transport project={document.project} playback={playback} /> : null}
        {view === "primitives" ? <PrimitiveStateHarness /> : null}
      </Panel>
      {view === "transport" ? null : <Transport project={document.project} playback={playback} />}
    </>
  )
}

function FirstNoteButton({
  playback,
  firstBeat,
}: {
  readonly playback: AudioPlaybackController
  readonly firstBeat: { readonly numerator: number; readonly denominator: number } | undefined
}) {
  const snapshot = usePlaybackSnapshot(playback)
  const enabled = firstBeat !== undefined && canControlPlayback(snapshot.status)
  return (
    <Button
      icon={<SkipForward aria-hidden="true" size={15} />}
      disabled={!enabled}
      onClick={() => {
        if (firstBeat === undefined) return
        playback.seekBeatPosition(firstBeat.numerator / firstBeat.denominator)
      }}
    >
      First note
    </Button>
  )
}
