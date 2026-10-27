import { Download, FilePlus2, Music2, Upload } from "lucide-react"
import { useEffect, useState } from "react"
import type { Revision, UcsMode } from "../../shared/index.ts"
import type { LibraryChart, LibrarySnapshot, LibrarySong, SongId } from "../../shared/library.ts"
import type { LibraryCommand } from "../../shared/library-commands.ts"
import { LibraryChartList } from "./LibraryChartList.tsx"
import { LibrarySongList } from "./LibrarySongList.tsx"
import { fallbackChartId, songCharts } from "./library-workflow.ts"
import { Button } from "./primitives.tsx"

type SongFileInput = {
  readonly songId: SongId
  readonly file: File
}

type ChartImportInput = SongFileInput & { readonly name: string }

type LibrarySongManagerProps = {
  readonly busy: boolean
  readonly documentRevision: Revision
  readonly library: LibrarySnapshot
  readonly selectedSongId: SongId | undefined
  readonly onSelectSong: (songId: SongId) => void
  readonly onCommand: (command: LibraryCommand) => void
  readonly onReplaceAudio: (input: SongFileInput) => void
  readonly onImportChart: (input: ChartImportInput) => void
  readonly onDownloadSong: (song: LibrarySong) => void
}

type DeleteTarget =
  | { readonly kind: "chart"; readonly chart: LibraryChart }
  | { readonly kind: "song"; readonly song: LibrarySong }

export function LibrarySongManager(props: LibrarySongManagerProps) {
  const song = props.library.songs.find((item) => item.id === props.selectedSongId)
  const charts = songCharts(props.library, song?.id)
  const activeChart = props.library.charts.find(
    (chart) => chart.id === props.library.active_chart_id,
  )
  const [title, setTitle] = useState("")
  const [artist, setArtist] = useState("")
  const [chartName, setChartName] = useState("New chart")
  const [chartMode, setChartMode] = useState<UcsMode | "">("")
  const [importName, setImportName] = useState("Imported UCS")
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  useEffect(() => {
    setTitle(song?.title ?? "")
    setArtist(song?.artist ?? "")
    setDeleteTarget(null)
  }, [song])

  function confirmDelete(): void {
    if (deleteTarget?.kind === "chart") {
      const active = deleteTarget.chart.id === props.library.active_chart_id
      props.onCommand({
        type: "delete_chart",
        library_revision: props.library.revision,
        chart_id: deleteTarget.chart.id,
        ...(active ? { base_revision: props.documentRevision } : {}),
        ...(active
          ? { fallback_chart_id: fallbackChartId(props.library, undefined, deleteTarget.chart.id) }
          : {}),
      })
    }
    if (deleteTarget?.kind === "song") {
      const active = activeChart?.song_id === deleteTarget.song.id
      props.onCommand({
        type: "delete_song",
        library_revision: props.library.revision,
        song_id: deleteTarget.song.id,
        ...(active ? { base_revision: props.documentRevision } : {}),
        ...(active
          ? { fallback_chart_id: fallbackChartId(props.library, deleteTarget.song.id) }
          : {}),
      })
    }
    setDeleteTarget(null)
  }

  return (
    <section className="library-section" aria-labelledby="songs-heading">
      <div className="library-section__heading">
        <h3 id="songs-heading">Songs and charts</h3>
        <p className="status-copy">Select a song to manage its saved charts and audio.</p>
      </div>
      <LibrarySongList
        activeSongId={activeChart?.song_id}
        library={props.library}
        selectedSongId={song?.id}
        onSelect={props.onSelectSong}
      />
      {song === undefined ? (
        <p className="status-copy">No song selected.</p>
      ) : (
        <div className="library-song-detail">
          <form
            className="library-form"
            onSubmit={(event) => {
              event.preventDefault()
              props.onCommand({
                type: "rename_song",
                library_revision: props.library.revision,
                song_id: song.id,
                title,
                artist,
              })
            }}
          >
            <div className="library-form__grid">
              <label>
                Title
                <input required value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label>
                Artist
                <input
                  required
                  value={artist}
                  onChange={(event) => setArtist(event.target.value)}
                />
              </label>
            </div>
            <div className="cluster">
              <Button type="submit" disabled={props.busy}>
                Rename song
              </Button>
              <Button
                type="button"
                icon={<Download size={15} />}
                disabled={props.busy}
                onClick={() => props.onDownloadSong(song)}
              >
                Download saved song ZIP
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={props.busy || props.library.songs.length === 1}
                onClick={() => setDeleteTarget({ kind: "song", song })}
              >
                Delete song
              </Button>
            </div>
            {props.library.songs.length === 1 ? (
              <p className="status-copy">The library must keep at least one song.</p>
            ) : null}
          </form>
          <label className="file-action">
            Replace song audio
            <input
              type="file"
              accept=".wav,.ogg,.mp3,audio/wav,audio/ogg,audio/mpeg"
              disabled={props.busy}
              onChange={(event) => {
                const file = event.target.files?.item(0)
                if (file !== null && file !== undefined)
                  props.onReplaceAudio({ songId: song.id, file })
              }}
            />
          </label>
          <form
            className="library-inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (chartMode === "") return
              props.onCommand({
                type: "new_chart",
                library_revision: props.library.revision,
                base_revision: props.documentRevision,
                song_id: song.id,
                name: chartName,
                mode: chartMode,
              })
            }}
          >
            <input
              aria-label="New chart name"
              required
              value={chartName}
              onChange={(event) => setChartName(event.target.value)}
            />
            <select
              aria-label="New chart mode"
              required
              value={chartMode}
              onChange={(event) => {
                if (event.target.value === "Single") setChartMode("Single")
                if (event.target.value === "Double") setChartMode("Double")
              }}
            >
              <option value="">Choose mode</option>
              <option value="Single">Single · 5 lanes</option>
              <option value="Double">Double · 10 lanes</option>
            </select>
            <Button type="submit" icon={<FilePlus2 size={15} />} disabled={props.busy}>
              New chart
            </Button>
          </form>
          <form
            className="library-inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              const file = new FormData(event.currentTarget).get("chart")
              if (file instanceof File && file.size > 0) {
                props.onImportChart({ songId: song.id, name: importName, file })
              }
            }}
          >
            <input
              aria-label="Imported chart name"
              required
              value={importName}
              onChange={(event) => setImportName(event.target.value)}
            />
            <label className="library-file-button">
              <Upload size={15} /> UCS file
              <input name="chart" required type="file" accept=".ucs" disabled={props.busy} />
            </label>
            <Button type="submit" icon={<Music2 size={15} />} disabled={props.busy}>
              Import chart
            </Button>
          </form>
          <LibraryChartList
            busy={props.busy}
            charts={charts}
            documentRevision={props.documentRevision}
            library={props.library}
            onCommand={props.onCommand}
            onDelete={(chart) => setDeleteTarget({ kind: "chart", chart })}
          />
          {props.library.charts.length === 1 ? (
            <p className="status-copy">The library must keep at least one chart.</p>
          ) : null}
        </div>
      )}
      {deleteTarget === null ? null : (
        <div className="library-confirm" role="alertdialog" aria-label="Confirm deletion">
          <p>
            Delete{" "}
            {deleteTarget.kind === "song" ? deleteTarget.song.title : deleteTarget.chart.name}? This
            cannot be undone.
          </p>
          <div className="cluster">
            <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" disabled={props.busy} onClick={confirmDelete}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
