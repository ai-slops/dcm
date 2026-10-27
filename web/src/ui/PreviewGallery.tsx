import { AlertTriangle, ExternalLink, Library } from "lucide-react"
import { useEffect, useState } from "react"

import {
  ChartIdSchema,
  type LibraryChartDocument,
  type LibrarySnapshot,
} from "../../shared/library.ts"
import { libraryApi } from "../api/library-client.ts"
import { PreviewGalleryDocument } from "./PreviewGalleryDocument.tsx"
import { Button } from "./primitives.tsx"

type GalleryState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly library: LibrarySnapshot }

export function PreviewGallery() {
  const [state, setState] = useState<GalleryState>({ kind: "loading" })
  useEffect(() => {
    let active = true
    void libraryApi.list().then(
      (library) => active && setState({ kind: "ready", library }),
      (error: unknown) =>
        active &&
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Library loading failed",
        }),
    )
    return () => {
      active = false
    }
  }, [])
  if (state.kind === "loading")
    return <main className="empty-state">Loading stored library...</main>
  if (state.kind === "error") {
    return (
      <main className="empty-state">
        <AlertTriangle aria-hidden="true" size={28} />
        <h1>Preview library unavailable</h1>
        <p>{state.message}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </main>
    )
  }
  if (state.library.charts.length === 0) {
    return (
      <main className="empty-state">
        <Library aria-hidden="true" size={28} />
        <h1>No stored charts</h1>
        <p>Add a song and chart in Studio Library before opening the player gallery.</p>
        <a className="button button--primary" href="/">
          Open Studio Library
        </a>
      </main>
    )
  }
  return <LoadedPreviewGallery library={state.library} />
}

function LoadedPreviewGallery({ library }: { readonly library: LibrarySnapshot }) {
  const queryChart = ChartIdSchema.safeParse(
    new URLSearchParams(window.location.search).get("chart"),
  )
  const initialChart =
    (queryChart.success
      ? library.charts.find((chart) => chart.id === queryChart.data)
      : undefined) ?? library.charts.find((chart) => chart.id === library.active_chart_id)
  const [chartId, setChartId] = useState(initialChart?.id ?? library.charts[0]?.id)
  const [document, setDocument] = useState<LibraryChartDocument | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    if (chartId === undefined) return
    let active = true
    setDocument(null)
    setError("")
    void libraryApi.chart(chartId).then(
      (value) => active && setDocument(value),
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Chart loading failed")
      },
    )
    return () => {
      active = false
    }
  }, [chartId])
  const selectedChart = library.charts.find((chart) => chart.id === chartId)
  const songs = library.songs.filter((song) =>
    library.charts.some((chart) => chart.song_id === song.id),
  )
  return (
    <main className="preview-gallery">
      <header className="preview-gallery__header">
        <div>
          <span className="mono preview-gallery__eyebrow">COMPONENT PREVIEW</span>
          <h1>Stored chart player</h1>
          <p>Real library timing, native holds, and the selected song audio asset.</p>
        </div>
        <a className="button button--secondary" href="/">
          <ExternalLink aria-hidden="true" size={15} />
          <span>Studio Library</span>
        </a>
      </header>
      <section className="preview-gallery__selectors" aria-label="Library selection">
        <label>
          Song
          <select
            aria-label="Gallery song"
            value={selectedChart?.song_id ?? ""}
            onChange={(event) => {
              const next = library.charts.find(
                (chart) => chart.song_id === event.currentTarget.value,
              )
              if (next !== undefined) selectChart(next.id, setChartId)
            }}
          >
            {songs.map((song) => (
              <option key={song.id} value={song.id}>
                {song.title} — {song.artist}
              </option>
            ))}
          </select>
        </label>
        <label>
          Chart
          <select
            aria-label="Gallery chart"
            value={chartId ?? ""}
            onChange={(event) => {
              const next = library.charts.find((chart) => chart.id === event.currentTarget.value)
              if (next !== undefined) selectChart(next.id, setChartId)
            }}
          >
            {library.charts
              .filter((chart) => chart.song_id === selectedChart?.song_id)
              .map((chart) => (
                <option key={chart.id} value={chart.id}>
                  {chart.name} · {chart.mode}
                </option>
              ))}
          </select>
        </label>
      </section>
      {error === "" ? null : <p className="preview-gallery__error">{error}</p>}
      {document === null ? (
        <div className="empty-state" role="status">
          Loading selected chart...
        </div>
      ) : (
        <PreviewGalleryDocument
          key={`${document.chart.id}:${document.song.audio.sha256}`}
          document={document}
          library={library}
        />
      )}
    </main>
  )
}

function selectChart(
  chartId: LibrarySnapshot["charts"][number]["id"],
  setChartId: (chartId: LibrarySnapshot["charts"][number]["id"]) => void,
): void {
  setChartId(chartId)
  const url = new URL(window.location.href)
  url.searchParams.set("chart", chartId)
  window.history.replaceState(null, "", url)
}
