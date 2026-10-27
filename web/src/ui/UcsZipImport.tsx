import { FileArchive, Upload } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { readUcsZip, type UcsArchive, type UcsArchiveEntry } from "../domain/ucs-archive.ts"
import { Button } from "./primitives.tsx"

type UcsZipImportProps = {
  readonly disabled: boolean
  readonly onImport: (chart: File, audio: File) => Promise<void>
}

function selectedEntry(
  entries: readonly UcsArchiveEntry[],
  selectedName: string,
): UcsArchiveEntry | null {
  return entries.find((entry) => entry.name === selectedName) ?? null
}

function entryContentType(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase()
  switch (extension) {
    case "ucs":
      return "text/plain"
    case "wav":
      return "audio/wav"
    case "ogg":
      return "audio/ogg"
    case "mp3":
      return "audio/mpeg"
    default:
      return "application/octet-stream"
  }
}

function archiveFile(entry: UcsArchiveEntry): File {
  return new File([entry.data], entry.name, { type: entryContentType(entry.name) })
}

export function UcsZipImport({ disabled, onImport }: UcsZipImportProps) {
  const abortRef = useRef<AbortController | null>(null)
  const [archive, setArchive] = useState<UcsArchive | null>(null)
  const [chartName, setChartName] = useState("")
  const [audioName, setAudioName] = useState("")
  const [reading, setReading] = useState(false)
  const [error, setError] = useState("")

  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  async function inspectZip(file: File): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setArchive(null)
    setChartName("")
    setAudioName("")
    setError("")
    setReading(true)
    try {
      const nextArchive = await readUcsZip(file, controller.signal)
      setArchive(nextArchive)
      setChartName(nextArchive.charts.length === 1 ? (nextArchive.charts[0]?.name ?? "") : "")
      setAudioName(nextArchive.audio.length === 1 ? (nextArchive.audio[0]?.name ?? "") : "")
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return
      if (caught instanceof Error) {
        setError(caught.message)
        return
      }
      throw caught
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setReading(false)
      }
    }
  }

  const chart = archive === null ? null : selectedEntry(archive.charts, chartName)
  const audio = archive === null ? null : selectedEntry(archive.audio, audioName)
  const canImport = !disabled && !reading && chart !== null && audio !== null

  return (
    <section className="ucs-dialog__section" aria-labelledby="ucs-zip-heading">
      <div>
        <h3 id="ucs-zip-heading">Import downloaded UCS ZIP</h3>
        <p className="status-copy">
          ZIP import requires bundled music. Choose one UCS chart and one WAV, OGG, or MP3; the
          selected music replaces current audio.
        </p>
      </div>
      <label className="file-action">
        UCS song ZIP
        <input
          name="ucs-zip"
          type="file"
          accept=".zip,application/zip"
          disabled={disabled || reading}
          onChange={(event) => {
            const file = event.currentTarget.files?.item(0)
            if (file !== null && file !== undefined) void inspectZip(file)
          }}
        />
      </label>
      {archive === null ? null : (
        <div className="ucs-zip-selection">
          <label className="file-action">
            Chart from ZIP
            <select
              aria-label="Chart from ZIP"
              value={chartName}
              disabled={disabled || reading || archive.charts.length === 0}
              onChange={(event) => setChartName(event.currentTarget.value)}
            >
              <option value="">Choose a UCS chart</option>
              {archive.charts.map((entry) => (
                <option value={entry.name} key={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="file-action">
            Music from ZIP
            <select
              aria-label="Music from ZIP"
              value={audioName}
              disabled={disabled || reading || archive.audio.length === 0}
              onChange={(event) => setAudioName(event.currentTarget.value)}
            >
              <option value="">Choose bundled music</option>
              {archive.audio.map((entry) => (
                <option value={entry.name} key={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {error === "" ? null : (
        <p className="operation-result operation-result--error" role="alert">
          {error}
        </p>
      )}
      <Button
        type="button"
        icon={archive === null ? <FileArchive size={15} /> : <Upload size={15} />}
        disabled={!canImport}
        onClick={() => {
          if (chart !== null && audio !== null)
            void onImport(archiveFile(chart), archiveFile(audio))
        }}
      >
        {reading ? "Reading ZIP" : "Import selected ZIP files"}
      </Button>
    </section>
  )
}
