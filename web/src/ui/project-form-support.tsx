import type { BaseUcsRef } from "../../shared/beat.ts"
import type { SongId } from "../../shared/library.ts"
import type { UcsMode } from "../../shared/project.ts"
import { Field } from "./primitives.tsx"
import { emptyBeatHybridRulesJson } from "./project-form.ts"

export type ProjectFormFingerprintInput = {
  readonly name: string
  readonly songId: SongId | ""
  readonly mode: UcsMode | ""
  readonly chartArtist: string
  readonly baseSource: BaseUcsRef | null
  readonly timing: string
  readonly evaluation: string
  readonly rules: string
}

export function projectFormFingerprint(input: ProjectFormFingerprintInput): string {
  return JSON.stringify(input)
}

export function emptyBeatProjectFormJson() {
  return { timing: "", evaluation: "", rules: emptyBeatHybridRulesJson() } as const
}

export function ProjectJsonField(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <div className="project-json-field">
      <Field label={props.label}>
        <textarea
          className="mono"
          rows={8}
          spellCheck={false}
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      </Field>
    </div>
  )
}
