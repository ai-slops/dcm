import type { ChartProposal, NativeMusic, NativeNote } from "../../shared/index.ts"

type ChangedField = {
  readonly label: string
  readonly before: string
  readonly after: string
}

function noteValue(note: NativeNote): string {
  return `tick=${note.tick} mask=${note.panel_mask} hold_ticks=${note.hold_ticks}`
}

function noteChanges(
  before: readonly NativeNote[],
  after: readonly NativeNote[],
): { readonly added: readonly NativeNote[]; readonly removed: readonly NativeNote[] } {
  const beforeKeys = new Set(before.map(noteValue))
  const afterKeys = new Set(after.map(noteValue))
  return {
    added: after.filter((note) => !beforeKeys.has(noteValue(note))),
    removed: before.filter((note) => !afterKeys.has(noteValue(note))),
  }
}

function tempoValue(music: NativeMusic): string {
  return music.tempo
    .map(
      (segment) =>
        `start_tick=${segment.start_tick} micros_per_beat=${segment.micros_per_beat.numerator}/${segment.micros_per_beat.denominator}`,
    )
    .join("\n")
}

function accentsValue(music: NativeMusic): string {
  return music.reference_accents.length === 0 ? "(none)" : music.reference_accents.join(", ")
}

function hashValue(music: NativeMusic): string {
  return music.audio_sha256.map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function addChangedField(
  fields: ChangedField[],
  label: string,
  before: string | number,
  after: string | number,
): void {
  const beforeValue = String(before)
  const afterValue = String(after)
  if (beforeValue !== afterValue) fields.push({ label, before: beforeValue, after: afterValue })
}

function changedFields(proposal: ChartProposal): readonly ChangedField[] {
  if (proposal.before === undefined) return []
  const fields: ChangedField[] = []
  addChangedField(
    fields,
    "Chart grid (ticks_per_beat)",
    proposal.before.chart.ticks_per_beat,
    proposal.chart.ticks_per_beat,
  )
  addChangedField(
    fields,
    "Chart span (ticks)",
    proposal.before.chart.span_ticks,
    proposal.chart.span_ticks,
  )
  const afterMusic = proposal.music ?? proposal.before.music
  addChangedField(
    fields,
    "Music grid (ticks_per_beat)",
    proposal.before.music.ticks_per_beat,
    afterMusic.ticks_per_beat,
  )
  addChangedField(
    fields,
    "Duration (ticks)",
    proposal.before.music.duration_ticks,
    afterMusic.duration_ticks,
  )
  addChangedField(
    fields,
    "Offset (microseconds)",
    proposal.before.music.offset_micros,
    afterMusic.offset_micros,
  )
  addChangedField(fields, "Tempo", tempoValue(proposal.before.music), tempoValue(afterMusic))
  addChangedField(
    fields,
    "Reference accents",
    accentsValue(proposal.before.music),
    accentsValue(afterMusic),
  )
  addChangedField(fields, "Audio SHA-256", hashValue(proposal.before.music), hashValue(afterMusic))
  return fields
}

function ExactValues({ value }: { readonly value: string }) {
  return <pre className="proposal-diff__values">{value}</pre>
}

export function ProposalDiff({ proposal }: { readonly proposal: ChartProposal }) {
  if (proposal.before === undefined) {
    return (
      <p className="proposal-diff__unavailable">
        Exact before snapshot unavailable. The summary is not sufficient to verify this change.
      </p>
    )
  }

  const notes = noteChanges(proposal.before.chart.notes, proposal.chart.notes)
  const fields = changedFields(proposal)
  return (
    <section className="proposal-diff" aria-label="Canonical exact change preview">
      <strong>Canonical exact change preview</strong>
      <div className="proposal-diff__scroll">
        <section>
          <h4>Removed note demands ({notes.removed.length})</h4>
          <ExactValues
            value={notes.removed.length === 0 ? "(none)" : notes.removed.map(noteValue).join("\n")}
          />
        </section>
        <section>
          <h4>Added note demands ({notes.added.length})</h4>
          <ExactValues
            value={notes.added.length === 0 ? "(none)" : notes.added.map(noteValue).join("\n")}
          />
        </section>
        <section>
          <h4>Changed chart and music fields ({fields.length})</h4>
          {fields.length === 0 ? (
            <ExactValues value="(none)" />
          ) : (
            fields.map((field) => (
              <div className="proposal-diff__field" key={field.label}>
                <h5>{field.label}</h5>
                <span>Before</span>
                <ExactValues value={field.before} />
                <span>After</span>
                <ExactValues value={field.after} />
              </div>
            ))
          )}
        </section>
      </div>
    </section>
  )
}
