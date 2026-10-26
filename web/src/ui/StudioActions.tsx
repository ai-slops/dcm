import { ArrowLeftRight, Settings, Upload, WandSparkles } from "lucide-react"
import { useState } from "react"

import type {
  Bootstrap,
  ChartProposal,
  CurrentDocument,
  Revision,
  StudioProjectV1,
} from "../../shared/index.ts"
import { ActionDialog } from "./ActionDialog.tsx"
import { FileActionsDialog } from "./FileActionsDialog.tsx"
import { NativeActionsDialog } from "./NativeActionsDialog.tsx"
import { IconButton } from "./primitives.tsx"
import { UcsActionsDialog } from "./UcsActionsDialog.tsx"

type ActionsProps = {
  readonly bootstrap: Bootstrap
  readonly project: StudioProjectV1
  readonly revision: Revision
  readonly dirty: boolean
  readonly onDocument: (document: CurrentDocument) => void
  readonly onProposal: (proposal: ChartProposal) => void
  readonly onStatus: (status: string) => void
}

type DialogName = "files" | "native" | "settings" | "ucs"

export function StudioActions(props: ActionsProps) {
  const [open, setOpen] = useState<DialogName | null>(null)
  const close = () => setOpen(null)
  return (
    <>
      <IconButton
        label="Import and audio"
        icon={<Upload size={15} />}
        onClick={() => setOpen("files")}
      />
      <IconButton
        label="Generate and export"
        icon={<WandSparkles size={15} />}
        onClick={() => setOpen("native")}
      />
      <IconButton
        label="UCS transfer"
        icon={<ArrowLeftRight size={15} />}
        onClick={() => setOpen("ucs")}
      />
      <IconButton
        label="Settings"
        icon={<Settings size={15} />}
        onClick={() => setOpen("settings")}
      />
      <FileActionsDialog
        csrfToken={props.bootstrap.csrf_token}
        dirty={props.dirty}
        open={open === "files"}
        project={props.project}
        revision={props.revision}
        onClose={close}
        onDocument={props.onDocument}
        onStatus={props.onStatus}
      />
      <NativeActionsDialog
        csrfToken={props.bootstrap.csrf_token}
        dirty={props.dirty}
        nativeMessage={props.bootstrap.native.message}
        nativeReady={props.bootstrap.native.ready}
        open={open === "native"}
        project={props.project}
        revision={props.revision}
        onClose={close}
        onProposal={props.onProposal}
      />
      <UcsActionsDialog
        csrfToken={props.bootstrap.csrf_token}
        dirty={props.dirty}
        open={open === "ucs"}
        project={props.project}
        revision={props.revision}
        onClose={close}
        onDocument={props.onDocument}
        onStatus={props.onStatus}
      />
      <ActionDialog open={open === "settings"} busy={false} title="Agent settings" onClose={close}>
        <div className="action-dialog__body">
          <p>
            This server uses an OpenAI-compatible endpoint. Credentials stay on the server and are
            never entered in this browser.
          </p>
          <pre className="settings-code">
            PART_ENDPOINT=https://api.openai.com/v1/chat/completions{"\n"}
            PART_MODEL=gpt-5.1{"\n"}PART_API_KEY=your-server-secret
          </pre>
          <p className="status-copy">
            Current: {props.bootstrap.agent.provider ?? "Not configured"} /{" "}
            {props.bootstrap.agent.model ?? "No model"}
          </p>
        </div>
      </ActionDialog>
    </>
  )
}
