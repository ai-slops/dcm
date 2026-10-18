import type { NativeNote, StudioProjectV1 } from "../../shared/index.ts"
import type { PanelIndex } from "../domain/editor.ts"
import { Field, Panel, ToolChip } from "./primitives.tsx"
import type { EditorTool } from "./studio-types.ts"
import { laneLabels } from "./studio-types.ts"
import { TimingEditor } from "./TimingEditor.tsx"

const laneIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const

function finiteInputValue(input: HTMLInputElement, fallback: number): number {
  return Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : fallback
}

type InspectorProps = {
  readonly project: StudioProjectV1
  readonly tool: EditorTool
  readonly tick: number
  readonly lane: PanelIndex
  readonly holdTicks: number
  readonly selectedDemand: NativeNote | undefined
  readonly validationError: string
  readonly setTool: (tool: EditorTool) => void
  readonly setHoldTicks: (ticks: number) => void
  readonly updateSelection: (tick: number, lane: PanelIndex, holdTicks: number) => void
  readonly replaceProject: (project: StudioProjectV1) => void
}

export function Inspector(props: InspectorProps) {
  const selected = props.selectedDemand
  const selectedTick = selected?.tick ?? props.tick
  const selectedHoldTicks = selected?.hold_ticks ?? 0
  return (
    <Panel title="Chart tools" className="rail-panel">
      <div className="inspector-stack">
        <div className="cluster">
          {(["tap", "hold", "select", "erase"] as const).map((item) => (
            <ToolChip key={item} pressed={props.tool === item} onClick={() => props.setTool(item)}>
              {item}
            </ToolChip>
          ))}
        </div>
        <Field label="Hold tool duration" help="Ticks used for the next hold.">
          <input
            className="mono"
            min="1"
            type="number"
            value={props.holdTicks}
            onChange={(event) =>
              props.setHoldTicks(
                Math.max(1, finiteInputValue(event.currentTarget, props.holdTicks)),
              )
            }
          />
        </Field>
        <Field label="Selected tick">
          <input
            className="mono"
            max={props.project.chart.span_ticks - Math.max(1, selectedHoldTicks)}
            min="0"
            type="number"
            value={selectedTick}
            onChange={(event) =>
              props.updateSelection(
                finiteInputValue(event.currentTarget, selectedTick),
                props.lane,
                selectedHoldTicks,
              )
            }
          />
        </Field>
        <Field label="Selected lane">
          <select
            value={props.lane}
            onChange={(event) => {
              const nextLane = laneIndices[event.currentTarget.selectedIndex] ?? props.lane
              props.updateSelection(selectedTick, nextLane, selectedHoldTicks)
            }}
          >
            {laneLabels.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Selected duration" help="Use 0 for a tap.">
          <input
            className="mono"
            disabled={selected === undefined}
            min="0"
            type="number"
            value={selectedHoldTicks}
            onChange={(event) =>
              props.updateSelection(
                selectedTick,
                props.lane,
                Math.max(0, finiteInputValue(event.currentTarget, selectedHoldTicks)),
              )
            }
          />
        </Field>
        <Field label="Artist">
          <input
            value={props.project.artist}
            onChange={(event) =>
              props.replaceProject({ ...props.project, artist: event.target.value })
            }
          />
        </Field>
        <Field label="Audio offset" help="Microseconds. Positive starts the chart later.">
          <input
            className="mono"
            type="number"
            value={props.project.music.offset_micros}
            onChange={(event) =>
              props.replaceProject({
                ...props.project,
                music: {
                  ...props.project.music,
                  offset_micros: finiteInputValue(
                    event.currentTarget,
                    props.project.music.offset_micros,
                  ),
                },
              })
            }
          />
        </Field>
        <TimingEditor project={props.project} replaceProject={props.replaceProject} />
        {props.validationError === "" ? null : (
          <p className="field-error" role="alert">
            Edit rejected: {props.validationError}
          </p>
        )}
      </div>
    </Panel>
  )
}
