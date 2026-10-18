import { Download } from "lucide-react"
import { useState } from "react"

import type { CurrentDocument, Revision, StudioProjectV1 } from "../../shared/index.ts"
import { StudioProjectV1Schema } from "../../shared/index.ts"
import { studioApi } from "../api/client.ts"
import { ActionDialog } from "./ActionDialog.tsx"
import { downloadBlob, errorMessage } from "./action-utils.ts"
import { Button } from "./primitives.tsx"

type FileActionsProps = {
  readonly csrfToken: string
  readonly dirty: boolean
  readonly open: boolean
  readonly project: StudioProjectV1
  readonly revision: Revision
  readonly onClose: () => void
  readonly onDocument: (document: CurrentDocument) => void
  readonly onStatus: (status: string) => void
}

export function FileActionsDialog(props: FileActionsProps) {
  const [busy, setBusy] = useState<"audio" | "import" | null>(null)

  async function uploadAudio(file: File): Promise<void> {
    setBusy("audio")
    props.onStatus("Uploading audio")
    try {
      props.onDocument(await studioApi.uploadAudio(props.csrfToken, props.revision, file))
      props.onStatus("Audio uploaded")
    } catch (error) {
      props.onStatus(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function importProject(projectFile: File, audioFile: File): Promise<void> {
    setBusy("import")
    props.onStatus("Importing")
    try {
      const project = StudioProjectV1Schema.parse(JSON.parse(await projectFile.text()))
      props.onDocument(
        await studioApi.importProject(props.csrfToken, props.revision, project, audioFile),
      )
      props.onStatus("Imported")
      props.onClose()
    } catch (error) {
      props.onStatus(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const replacementEnabled = !props.dirty && busy === null
  return (
    <ActionDialog
      open={props.open}
      busy={busy !== null}
      title="Project files"
      onClose={props.onClose}
    >
      <div className="action-dialog__body">
        {props.dirty && (
          <p className="status-copy" role="status">
            Save or undo your changes before replacing audio or importing a project.
          </p>
        )}
        <label className="file-action">
          Replace audio
          <input
            type="file"
            accept="audio/wav,audio/ogg,audio/mpeg"
            disabled={!replacementEnabled}
            onChange={(event) => {
              const file = event.target.files?.item(0)
              if (file !== null && file !== undefined) void uploadAudio(file)
            }}
          />
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!replacementEnabled) return
            const data = new FormData(event.currentTarget)
            const project = data.get("project")
            const audio = data.get("audio")
            if (project instanceof File && audio instanceof File) void importProject(project, audio)
          }}
        >
          <label className="file-action">
            Project JSON
            <input
              required
              name="project"
              type="file"
              accept="application/json,.json"
              disabled={!replacementEnabled}
            />
          </label>
          <label className="file-action">
            Matching audio
            <input
              required
              name="audio"
              type="file"
              accept="audio/wav,audio/ogg,audio/mpeg"
              disabled={!replacementEnabled}
            />
          </label>
          <Button type="submit" disabled={!replacementEnabled}>
            {busy === "import" ? "Importing" : "Import pair"}
          </Button>
        </form>
        <Button
          icon={<Download size={15} />}
          disabled={busy !== null}
          onClick={() =>
            downloadBlob(
              new Blob([`${JSON.stringify(props.project, null, 2)}\n`], {
                type: "application/json",
              }),
              "project.json",
            )
          }
        >
          Export project JSON
        </Button>
      </div>
    </ActionDialog>
  )
}
