import { useState } from "react"

import type {
  BeatChartDocument,
  ChartProposal,
  EvaluationResponse,
  NativeCapability,
  Revision,
} from "../../shared/index.ts"
import {
  nativeEvaluationExtentCapability,
  projectBeatChartNative,
  resolveChartOutputTiming,
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
  readonly project: BeatChartDocument
  readonly revision: Revision
  readonly onClose: () => void
  readonly onOpenProjects: () => void
  readonly onOpenUcs: () => void
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
  const single = props.project.mode === "Single"
  const chart = {
    mode: props.project.mode,
    timing: props.project.timing,
    notes: props.project.notes,
  }
  const projection = projectBeatChartNative(chart, digestBytes(props.project.audio_sha256))
  const outputTiming = resolveChartOutputTiming(chart)
  const evaluationCapability =
    outputTiming === null || outputTiming.duration === null
      ? null
      : nativeEvaluationExtentCapability(props.project.evaluation_contract, outputTiming.duration)
  const capability =
    projection.kind === "unsupported" ? projection.capability : evaluationCapability
  const nativeCapable = projection.kind === "supported" && capability === null
  const capabilityMessage = capability === null ? "" : nativeCapabilityMessage(capability)
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
        {capabilityMessage === "" ? null : (
          <p className="status-copy" role="status">
            {capabilityMessage} Editing and direct UCS export remain available.
          </p>
        )}
        {single ? (
          <p className="status-copy">
            Single charts do not use legacy proposal generation or Pump Double SSC ZIP export. Use a
            Single rule project to generate charts, or export this chart through UCS transfer.
          </p>
        ) : (
          <label>
            64-character seed
            <input
              value={seed}
              maxLength={64}
              disabled={busy !== null}
              onChange={(event) => setSeed(event.target.value.toLowerCase())}
            />
          </label>
        )}
        <div className="cluster">
          {single ? (
            <>
              <Button onClick={props.onOpenProjects}>Projects and library</Button>
              <Button onClick={props.onOpenUcs}>UCS transfer</Button>
            </>
          ) : (
            <Button
              disabled={
                !persisted ||
                !props.nativeReady ||
                !nativeCapable ||
                seed.length !== 64 ||
                busy !== null
              }
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
          )}
          <Button
            disabled={!persisted || !props.nativeReady || !nativeCapable || busy !== null}
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
          {single ? null : (
            <Button
              disabled={
                !persisted ||
                !props.nativeReady ||
                !nativeCapable ||
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
          )}
        </div>
        {!persisted && <p className="status-copy">Save the draft before native operations.</p>}
        {currentResult !== "" && <output className="operation-result">{currentResult}</output>}
      </div>
    </ActionDialog>
  )
}

function digestBytes(digest: string): readonly number[] {
  return Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16),
  )
}

function nativeCapabilityMessage(capability: NativeCapability): string {
  switch (capability.code) {
    case "native_duration_unresolved":
      return "Set a concrete duration before native evaluation, generation, or export."
    case "native_grid_unsupported":
      return `Exact native projection requires ${capability.required_tpb} ticks per beat; the native limit is ${capability.limit}.`
    case "native_limit_unsupported":
      return `Exact native ${capability.field} ${capability.value} exceeds the limit ${capability.limit}.`
    case "native_evaluation_extent_unsupported":
      return capability.message
  }
}
