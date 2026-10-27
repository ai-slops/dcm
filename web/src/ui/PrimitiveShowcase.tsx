import {
  AlertTriangle,
  Check,
  LoaderCircle,
  Pause,
  Play,
  Save,
  Settings,
  Trash2,
} from "lucide-react"

import { Badge, Button, Field, IconButton, Panel, ToolChip } from "./primitives.tsx"

export function PrimitiveShowcase() {
  return (
    <main className="showcase">
      <header className="showcase__header">
        <div>
          <span className="mono showcase__eyebrow">COMPONENT HARNESS</span>
          <h1>PUMP instrument primitives</h1>
        </div>
        <Badge tone="success">
          <Check aria-hidden="true" size={12} /> Responsive state review
        </Badge>
      </header>
      <PrimitiveStateHarness />
    </main>
  )
}

export function PrimitiveStateHarness() {
  return (
    <div className="showcase__grid primitive-state-harness">
      <Panel title="Button states" action={<Badge>Application controls</Badge>}>
        <div className="showcase__stack">
          <div className="cluster">
            <Button variant="primary" icon={<Save aria-hidden="true" size={15} />}>
              Primary
            </Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon={<Trash2 aria-hidden="true" size={15} />}>
              Destructive
            </Button>
          </div>
          <div className="cluster">
            <Button aria-busy="true" icon={<LoaderCircle aria-hidden="true" size={15} />}>
              Saving
            </Button>
            <Button disabled>Disabled</Button>
            <IconButton label="Play" icon={<Play aria-hidden="true" size={15} />} />
            <IconButton
              label="Pause selected"
              icon={<Pause aria-hidden="true" size={15} />}
              selected
            />
            <IconButton
              label="Settings disabled"
              icon={<Settings aria-hidden="true" size={15} />}
              disabled
            />
          </div>
        </div>
      </Panel>
      <Panel title="Tool and status states">
        <div className="showcase__stack">
          <div className="cluster">
            <ToolChip pressed>Selected tool</ToolChip>
            <ToolChip pressed={false}>Available tool</ToolChip>
            <ToolChip pressed={false} disabled>
              Disabled tool
            </ToolChip>
          </div>
          <div className="cluster">
            <Badge>Neutral</Badge>
            <Badge tone="info">Information</Badge>
            <Badge tone="success">
              <Check aria-hidden="true" size={12} /> Ready
            </Badge>
            <Badge tone="warning">
              <AlertTriangle aria-hidden="true" size={12} /> No audio
            </Badge>
            <Badge tone="error">Error</Badge>
            <Badge tone="stale">Stale</Badge>
          </div>
        </div>
      </Panel>
      <Panel title="Field states">
        <div className="showcase__fields">
          <Field label="Default field" help="Visible helper text">
            <input defaultValue="Editable value" />
          </Field>
          <Field label="Read-only field">
            <input defaultValue="Stored value" readOnly />
          </Field>
          <Field label="Disabled field" help="Unavailable for this state">
            <input defaultValue="Unavailable" disabled />
          </Field>
          <Field label="Invalid field" help="Enter a valid timing value">
            <input aria-invalid="true" defaultValue="Invalid" />
          </Field>
        </div>
      </Panel>
      <Panel title="Selection controls">
        <div className="showcase__fields">
          <Field label="Quantization">
            <select defaultValue="1/4">
              <option>1/4</option>
              <option>1/8</option>
              <option>1/16</option>
            </select>
          </Field>
          <Field label="Instruction">
            <textarea defaultValue="Describe a scoped chart change." />
          </Field>
        </div>
      </Panel>
    </div>
  )
}
