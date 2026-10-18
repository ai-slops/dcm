import { Redo2, Save, Undo2 } from "lucide-react"

import type {
  Bootstrap,
  ChartProposal,
  CurrentDocument,
  StudioProjectV1,
} from "../../shared/index.ts"
import { Badge, Button, IconButton } from "./primitives.tsx"
import { StudioActions } from "./StudioActions.tsx"

type DocumentToolbarProps = {
  readonly bootstrap: Bootstrap
  readonly project: StudioProjectV1
  readonly revision: CurrentDocument["revision"]
  readonly dirty: boolean
  readonly status: string
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly setProject: (project: StudioProjectV1) => void
  readonly undo: () => void
  readonly redo: () => void
  readonly save: () => Promise<void>
  readonly onDocument: (document: CurrentDocument) => void
  readonly onProposal: (proposal: ChartProposal) => void
  readonly onStatus: (status: string) => void
}

export function DocumentToolbar(props: DocumentToolbarProps) {
  const saveLabel = props.status === "Saving" ? "Saving" : props.dirty ? "Save" : "Saved"
  return (
    <header className="document-toolbar">
      <div className="brand">
        <span className="brand__mark">P</span>
        <strong>PUMP Studio</strong>
      </div>
      <input
        aria-label="Document title"
        className="document-title"
        value={props.project.title}
        onChange={(event) => props.setProject({ ...props.project, title: event.target.value })}
      />
      <Badge tone="warning">Uncertified draft</Badge>
      <div className="toolbar-actions">
        <IconButton
          label="Undo"
          icon={<Undo2 size={15} />}
          disabled={!props.canUndo}
          onClick={props.undo}
        />
        <IconButton
          label="Redo"
          icon={<Redo2 size={15} />}
          disabled={!props.canRedo}
          onClick={props.redo}
        />
        <Button
          className="save-button"
          variant="primary"
          icon={<Save size={15} />}
          aria-label={saveLabel}
          disabled={!props.dirty || props.status === "Saving"}
          onClick={() => void props.save()}
        >
          {saveLabel}
        </Button>
        <StudioActions
          bootstrap={props.bootstrap}
          project={props.project}
          revision={props.revision}
          dirty={props.dirty}
          onDocument={props.onDocument}
          onProposal={props.onProposal}
          onStatus={props.onStatus}
        />
      </div>
    </header>
  )
}
