import { useState } from "react"

import type {
  ChartProposal,
  EvaluationResponse,
  Revision,
  StudioProjectV1,
} from "../../shared/index.ts"
import { studioApi } from "../api/client.ts"
import { ActionDialog } from "./ActionDialog.tsx"
import { downloadBlob, errorMessage } from "./action-utils.ts"
import { Button } from "./primitives.tsx"

type NativeActionsProps = {
  readonly csrfToken: string
  readonly dirty: boolean
  readonly nativeMessage: string
  readonly nativeReady: boolean
  readonly open: boolean
  readonly project: StudioProjectV1
  readonly revision: Revision
  readonly onClose: () => void
  readonly onProposal: (proposal: ChartProposal) => void
}

function evaluationText(evaluation: EvaluationResponse): string {
  const summary = evaluation.summary
  const prefix = `${summary.accepted ? "Accepted" : "Rejected"} by ${summary.label}; ${summary.rejection_count} rejection(s)${summary.uncalibrated ? "; difficulty uncalibrated" : ""}.`
  const details = evaluation.raw_native.rejections.slice(0, 3).map((item) => item.explanation)
  return details.length === 0 ? prefix : `${prefix}\n${details.join("\n")}`
}

export function NativeActionsDialog(props: NativeActionsProps) {
  const [seed, setSeed] = useState(() => "0".repeat(64))
  const [busy, setBusy] = useState<"evaluate" | "export" | "generate" | null>(null)
  const [result, setResult] = useState<{
    readonly revision: Revision
    readonly text: string
  } | null>(null)
  const persisted = !props.dirty
  const currentResult = !props.dirty && result?.revision === props.revision ? result.text : ""

  async function runNative(
    action: "evaluate" | "export" | "generate",
    operation: () => Promise<void>,
  ): Promise<void> {
    setBusy(action)
    const busyText =
      action === "evaluate" ? "Evaluating" : action === "generate" ? "Generating" : "Exporting"
    setResult({ revision: props.revision, text: `${busyText} persisted revision...` })
    try {
      await operation()
    } catch (error) {
      setResult({ revision: props.revision, text: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <ActionDialog
      open={props.open}
      busy={busy !== null}
      title="Native tools"
      onClose={props.onClose}
    >
      <div className="action-dialog__body">
        <p className="status-copy">{props.nativeMessage}</p>
        <label>
          64-character seed
          <input
            value={seed}
            maxLength={64}
            disabled={busy !== null}
            onChange={(event) => setSeed(event.target.value.toLowerCase())}
          />
        </label>
        <div className="cluster">
          <Button
            disabled={!persisted || !props.nativeReady || seed.length !== 64 || busy !== null}
            onClick={() =>
              void runNative("generate", async () => {
                const proposal = await studioApi.generate(props.csrfToken, {
                  base_revision: props.revision,
                  seed,
                })
                props.onProposal(proposal)
                setResult({
                  revision: props.revision,
                  text: "Generated a review-only proposal. It was not applied.",
                })
              })
            }
          >
            {busy === "generate" ? "Generating" : "Generate proposal"}
          </Button>
          <Button
            disabled={!persisted || !props.nativeReady || busy !== null}
            onClick={() =>
              void runNative("evaluate", async () => {
                const evaluation = await studioApi.evaluate(props.csrfToken, {
                  base_revision: props.revision,
                })
                setResult({ revision: props.revision, text: evaluationText(evaluation) })
              })
            }
          >
            {busy === "evaluate" ? "Evaluating" : "Evaluate"}
          </Button>
          <Button
            disabled={
              !persisted ||
              !props.nativeReady ||
              props.project.audio_asset.byte_length === 0 ||
              busy !== null
            }
            onClick={() =>
              void runNative("export", async () => {
                const blob = await studioApi.exportZip(props.csrfToken, {
                  base_revision: props.revision,
                })
                downloadBlob(blob, "pump-studio-export.zip")
                setResult({ revision: props.revision, text: "SSC ZIP downloaded." })
              })
            }
          >
            {busy === "export" ? "Exporting" : "Download SSC ZIP"}
          </Button>
        </div>
        {!persisted && <p className="status-copy">Save the draft before native operations.</p>}
        {currentResult !== "" && <output className="operation-result">{currentResult}</output>}
      </div>
    </ActionDialog>
  )
}
