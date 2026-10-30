import { Download, Upload } from "lucide-react"
import { useState } from "react"
import type { LibraryArchive, LibrarySnapshot } from "../../shared/library.ts"
import type { LibraryCommand } from "../../shared/library-commands.ts"
import { LibraryCatalogSearch } from "./LibraryCatalogSearch.tsx"
import { Button } from "./primitives.tsx"

type ArchiveImport = {
  readonly archive: LibraryArchive
  readonly audioName: string
  readonly chartNames: readonly string[]
  readonly title: string
  readonly artist: string
}

type LibraryArchiveManagerProps = {
  readonly busy: boolean
  readonly library: LibrarySnapshot
  readonly onCommand: (command: LibraryCommand) => void
  readonly onDownloadSource: (code: string) => void
  readonly onUpload: (file: File) => void
  readonly onDownloadOriginal: (archive: LibraryArchive) => void
  readonly onImport: (input: ArchiveImport) => void
}

export function LibraryArchiveManager(props: LibraryArchiveManagerProps) {
  const [code, setCode] = useState("CS839")
  const [selected, setSelected] = useState<LibraryArchive | null>(null)
  const [audioName, setAudioName] = useState("")
  const [chartNames, setChartNames] = useState<readonly string[]>([])
  const [title, setTitle] = useState("")
  const [deleteArchive, setDeleteArchive] = useState<LibraryArchive | null>(null)

  function selectArchive(archive: LibraryArchive): void {
    setSelected(archive)
    setAudioName(archive.audio_names.length === 1 ? (archive.audio_names[0] ?? "") : "")
    setChartNames(archive.chart_names)
    setTitle(archive.name.replace(/\.zip$/i, ""))
  }

  return (
    <section className="library-section" aria-labelledby="archives-heading">
      <div className="library-section__heading">
        <h3 id="archives-heading">Original archives</h3>
        <p className="status-copy">
          Download public Pump Pro packages or upload a ZIP. Pump Pro is a public community source,
          not an official PUMP service.
        </p>
      </div>
      <LibraryCatalogSearch busy={props.busy} onDownload={props.onDownloadSource} />
      <form
        className="library-inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          props.onDownloadSource(code)
        }}
      >
        <label>
          CS code
          <input
            required
            pattern="CS[0-9]{3,4}"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </label>
        <Button type="submit" icon={<Download size={15} />} disabled={props.busy}>
          Download public Pump Pro archive
        </Button>
      </form>
      <label className="file-action">
        Upload original ZIP
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={props.busy}
          onChange={(event) => {
            const file = event.target.files?.item(0)
            if (file !== null && file !== undefined) props.onUpload(file)
          }}
        />
      </label>
      <ul className="library-archive-list" aria-label="Staged original archives">
        {props.library.archives.length === 0 ? (
          <li className="status-copy">No original archives saved.</li>
        ) : (
          props.library.archives.map((archive) => (
            <li key={archive.id}>
              <article className="library-archive-row" data-archive-id={archive.id}>
                <button type="button" onClick={() => selectArchive(archive)}>
                  <strong>{archive.name}</strong>
                  <small>
                    {archive.chart_names.length} chart(s) · {archive.byte_length.toLocaleString()}{" "}
                    bytes
                  </small>
                </button>
                <div className="cluster">
                  <Button
                    icon={<Download size={15} />}
                    disabled={props.busy}
                    onClick={() => props.onDownloadOriginal(archive)}
                  >
                    Download original ZIP
                  </Button>
                  <Button
                    variant="danger"
                    disabled={props.busy}
                    onClick={() => setDeleteArchive(archive)}
                  >
                    Delete archive
                  </Button>
                </div>
              </article>
            </li>
          ))
        )}
      </ul>
      {deleteArchive === null ? null : (
        <div className="library-confirm" role="alertdialog" aria-label="Delete original archive">
          <p>Delete {deleteArchive.name}? Imported songs and charts are not removed.</p>
          <div className="cluster">
            <Button onClick={() => setDeleteArchive(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={props.busy}
              onClick={() => {
                props.onCommand({
                  type: "delete_archive",
                  library_revision: props.library.revision,
                  archive_id: deleteArchive.id,
                })
                setDeleteArchive(null)
              }}
            >
              Delete archive
            </Button>
          </div>
        </div>
      )}
      {selected === null ? null : (
        <form
          className="library-archive-import"
          onSubmit={(event) => {
            event.preventDefault()
            if (audioName === "" || chartNames.length === 0) return
            props.onImport({
              archive: selected,
              audioName,
              chartNames,
              title,
              artist: "Unspecified",
            })
          }}
        >
          <div className="library-section__heading">
            <h3>Import {selected.name}</h3>
            <p className="status-copy">
              Choose one bundled audio file and one or more charts. Staging does not change the
              active document.
            </p>
          </div>
          <fieldset>
            <legend>Bundled audio</legend>
            {selected.audio_names.map((name) => (
              <label key={name}>
                <input
                  required
                  type="radio"
                  name="archive-audio"
                  checked={audioName === name}
                  onChange={() => setAudioName(name)}
                />
                {name}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Charts</legend>
            {selected.chart_names.map((name) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={chartNames.includes(name)}
                  onChange={(event) =>
                    setChartNames(
                      event.target.checked
                        ? [...chartNames, name]
                        : chartNames.filter((item) => item !== name),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </fieldset>
          <div className="library-form__grid">
            <label>
              Audio label
              <input required value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          </div>
          <Button
            type="submit"
            variant="primary"
            icon={<Upload size={15} />}
            disabled={props.busy || audioName === "" || chartNames.length === 0}
          >
            Import as song
          </Button>
        </form>
      )}
    </section>
  )
}
