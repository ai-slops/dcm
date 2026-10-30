import { useEffect, useState } from "react"

import { formatOffsetMilliseconds, parseOffsetMilliseconds } from "../domain/offset-milliseconds.ts"
import { Field } from "./primitives.tsx"

export function OffsetMillisecondsField(props: {
  readonly offsetMicros: number
  readonly disabled?: boolean
  readonly onChange: (offsetMicros: number) => void
}) {
  const [draft, setDraft] = useState(() => formatOffsetMilliseconds(props.offsetMicros))
  const [error, setError] = useState("")
  useEffect(() => {
    setDraft(formatOffsetMilliseconds(props.offsetMicros))
    setError("")
  }, [props.offsetMicros])

  function commit(): void {
    const parsed = parseOffsetMilliseconds(draft)
    if (parsed.kind === "invalid") {
      setError(parsed.message)
      return
    }
    setError("")
    props.onChange(parsed.offsetMicros)
  }

  return (
    <div className="timeline__offset">
      <Field label="Audio offset (ms)">
        <input
          className="mono"
          disabled={props.disabled}
          inputMode="decimal"
          aria-invalid={error === "" ? undefined : true}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit()
            }
          }}
        />
      </Field>
      {error === "" ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
