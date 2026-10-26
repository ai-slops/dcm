import { Download, Upload } from "lucide-react"
import { useEffect, useState } from "react"

import type { CurrentDocument, Revision, StudioProjectV1, UcsMode } from "../../shared/index.ts"
import { studioApi } from "../api/client.ts"
import { ActionDialog } from "./ActionDialog.tsx"
import { downloadBlob, errorMessage } from "./action-utils.ts"
import { Button } from "./primitives.tsx"

type UcsActionsProps = {
  readonly csrfToken: string
  readonly dirty: boolean
  readonly open: boolean
  readonly project: StudioProjectV1
  readonly revision: Revision
  readonly onClose: () => void
  readonly onDocument: (document: CurrentDocument) => void
  readonly onStatus: (status: string) => void
}

export function UcsActionsDialog(props: UcsActionsProps) {
  const [busy, setBusy] = useState<"import" | "export" | null>(null)
  const [mode, setMode] = useState<UcsMode>(props.project.ucs_mode ?? "Double")
  const [error, setError] = useState("")

  useEffect(() => setMode(props.project.ucs_mode ?? "Double"), [props.project.ucs_mode])

  async function importUcs(chart: File, audio?: File): Promise<void> {
    setBusy("import")
    setError("")
    props.onStatus("Importing UCS")
    try {
      const document = await studioApi.importUcs(props.csrfToken, {
        baseRevision: props.revision,
        chart,
        ...(audio === undefined ? {} : { audio }),
      })
      props.onDocument(document)
      props.onStatus("UCS imported")
      props.onClose()
    } catch (caught) {
      const message = errorMessage(caught)
      setError(message)
      props.onStatus(message)
    } finally {
      setBusy(null)
    }
  }

  async function exportUcs(): Promise<void> {
    setBusy("export")
    setError("")
    props.onStatus("Exporting UCS")
    try {
      const blob = await studioApi.exportUcs(props.csrfToken, {
        base_revision: props.revision,
        mode,
      })
      const filename = `${
        props.project.title
          .trim()
          .replaceAll(/[^A-Za-z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "pump-chart"
      }.ucs`
      downloadBlob(blob, filename)
      props.onStatus("UCS downloaded")
    } catch (caught) {
      const message = errorMessage(caught)
      setError(message)
      props.onStatus(message)
    } finally {
      setBusy(null)
    }
  }

  const replacementEnabled = !props.dirty && busy === null
  const exportEnabled = !props.dirty && busy === null
  return (
    <ActionDialog
      open={props.open}
      busy={busy !== null}
      title="UCS transfer"
      onClose={props.onClose}
    >
      <div className="action-dialog__body ucs-dialog">
        <section className="ucs-dialog__section" aria-labelledby="ucs-import-heading">
          <div>
            <h3 id="ucs-import-heading">Import UCS</h3>
            <p className="status-copy">
              Native import replaces chart and timing. Omit audio to keep the current project audio.
            </p>
          </div>
          {props.dirty && (
            <p className="status-copy" role="status">
              Save or undo your changes before importing UCS.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!replacementEnabled) return
              const data = new FormData(event.currentTarget)
              const chart = data.get("chart")
              const audio = data.get("audio")
              if (!(chart instanceof File) || chart.size === 0) return
              void importUcs(chart, audio instanceof File && audio.size > 0 ? audio : undefined)
            }}
          >
            <label className="file-action">
              UCS chart
              <input
                required
                name="chart"
                type="file"
                accept=".ucs"
                disabled={!replacementEnabled}
              />
            </label>
            <label className="file-action">
              Optional replacement audio
              <input
                name="audio"
                type="file"
                accept=".wav,.ogg,.mp3,audio/wav,audio/ogg,audio/mpeg"
                disabled={!replacementEnabled}
              />
            </label>
            <Button type="submit" icon={<Upload size={15} />} disabled={!replacementEnabled}>
              {busy === "import" ? "Importing UCS" : "Import UCS"}
            </Button>
          </form>
        </section>
        <section className="ucs-dialog__section" aria-labelledby="ucs-export-heading">
          <div>
            <h3 id="ucs-export-heading">Export UCS</h3>
            <p className="status-copy">
              Single exports the left five panels. Double exports all ten panels. Audio is never
              included.
            </p>
          </div>
          {props.dirty && (
            <p className="status-copy" role="status">
              Save your changes before exporting UCS.
            </p>
          )}
          <fieldset className="ucs-mode">
            <legend>Chart mode</legend>
            {(["Single", "Double"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="ucs-mode"
                  value={value}
                  checked={mode === value}
                  disabled={busy !== null}
                  onChange={() => setMode(value)}
                />
                {value}
              </label>
            ))}
          </fieldset>
          <Button
            icon={<Download size={15} />}
            disabled={!exportEnabled}
            onClick={() => void exportUcs()}
          >
            {busy === "export" ? "Exporting UCS" : "Download UCS"}
          </Button>
        </section>
        {error === "" ? null : (
          <p className="operation-result operation-result--error" role="alert">
            {error}
          </p>
        )}
        <p className="status-copy">
          Uncertified draft. UCS transfer makes no in-engine or safety claim.
        </p>
      </div>
    </ActionDialog>
  )
}
