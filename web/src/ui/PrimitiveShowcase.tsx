import { AlertTriangle, Check, Pause, Play, Save, Settings, Trash2 } from "lucide-react"

import { Badge, Button, Field, IconButton, Panel, ToolChip } from "./primitives.tsx"

const showcaseCells = Array.from({ length: 30 }, (_, index) => `cell-${index + 1}`)

export function PrimitiveShowcase() {
  return (
    <main className="showcase">
      <header className="showcase__header">
        <div>
          <span className="mono showcase__eyebrow">COMPONENT HARNESS</span>
          <h1>PUMP instrument primitives</h1>
        </div>
        <Badge tone="success">
          <Check size={12} /> Responsive state review
        </Badge>
      </header>
      <div className="showcase__grid">
        <Panel title="Controls" action={<Badge>Default</Badge>}>
          <div className="showcase__stack">
            <div className="cluster">
              <Button variant="primary" icon={<Save size={15} />}>
                Save draft
              </Button>
              <Button>Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger" icon={<Trash2 size={15} />}>
                Discard
              </Button>
              <Button disabled>Unavailable</Button>
            </div>
            <div className="cluster">
              <IconButton label="Play" icon={<Play size={15} />} />
              <IconButton label="Pause" icon={<Pause size={15} />} selected />
              <IconButton label="Settings" icon={<Settings size={15} />} />
              <ToolChip pressed>Tap</ToolChip>
              <ToolChip pressed={false}>Hold</ToolChip>
              <ToolChip pressed={false}>Erase</ToolChip>
            </div>
            <div className="cluster">
              <Badge tone="success">
                <Check size={12} /> Saved
              </Badge>
              <Badge tone="warning">
                <AlertTriangle size={12} /> No audio
              </Badge>
              <Badge tone="error">Runtime unavailable</Badge>
              <Badge tone="stale">Proposal stale</Badge>
            </div>
          </div>
        </Panel>
        <Panel title="Fields">
          <div className="showcase__fields">
            <Field label="Document title" help="Printable ASCII, up to 256 characters">
              <input defaultValue="Feedback demo" />
            </Field>
            <Field label="Quantization">
              <select defaultValue="1/4">
                <option>1/4</option>
                <option>1/8</option>
                <option>1/16</option>
              </select>
            </Field>
            <Field label="Agent instruction">
              <textarea defaultValue="Reduce crossover load in measures 8-12." />
            </Field>
          </div>
        </Panel>
        <Panel title="Timeline cell">
          <div className="mini-grid">
            {showcaseCells.map((cell, index) => (
              <button
                aria-label={`Example cell ${index + 1}`}
                className={`mini-cell ${index % 7 === 0 ? "mini-cell--left" : ""} ${index % 11 === 0 ? "mini-cell--right" : ""}`}
                key={cell}
                type="button"
              />
            ))}
          </div>
        </Panel>
        <Panel title="Proposal">
          <article className="proposal">
            <div className="proposal__head">
              <strong>Rebalance crossover phrase</strong>
              <Badge>Agent</Badge>
            </div>
            <p>Replaces 6 demands across ticks 128-192. Preview before applying.</p>
            <div className="cluster">
              <Button variant="primary">Apply</Button>
              <Button>Preview</Button>
              <Button variant="ghost">Discard</Button>
            </div>
          </article>
        </Panel>
      </div>
    </main>
  )
}
