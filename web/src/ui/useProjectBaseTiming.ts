import { useCallback, useRef, useState } from "react"

import type { BaseUcsRef } from "../../shared/beat.ts"
import type { BeatChartDocument } from "../../shared/beat-projects.ts"
import type { SongId } from "../../shared/library.ts"
import type { BaseTimingSourceOption } from "./ProjectBaseTimingPicker.tsx"
import { beatTemplateJson, emptyBeatHybridRulesJson } from "./project-form.ts"

type ProjectJson = {
  readonly timing: string
  readonly evaluation: string
  readonly rules: string
}

export function useProjectBaseTiming(input: {
  readonly initial: ProjectJson & { readonly baseSource: BaseUcsRef | null }
  readonly onLoadBase: (songId: SongId, source: BaseUcsRef) => Promise<BeatChartDocument>
  readonly onLoadBaseSources: (songId: SongId) => Promise<readonly BaseTimingSourceOption[]>
}) {
  const [baseSource, setBaseSource] = useState(input.initial.baseSource)
  const [timing, setTiming] = useState(input.initial.timing)
  const [evaluation, setEvaluation] = useState(input.initial.evaluation)
  const [rules, setRules] = useState(input.initial.rules)
  const [options, setOptions] = useState<readonly BaseTimingSourceOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const generation = useRef(0)

  const reset = useCallback(
    (next: ProjectJson & { readonly baseSource: BaseUcsRef | null }): void => {
      generation.current += 1
      setBaseSource(next.baseSource)
      setTiming(next.timing)
      setEvaluation(next.evaluation)
      setRules(next.rules)
      setOptions([])
      setLoading(false)
      setError("")
    },
    [],
  )

  function loadSources(songId: SongId): void {
    const request = ++generation.current
    setBaseSource(null)
    setTiming("")
    setEvaluation("")
    setRules(emptyBeatHybridRulesJson())
    setOptions([])
    setLoading(true)
    setError("")
    void input.onLoadBaseSources(songId).then(
      (sources) => {
        if (request !== generation.current) return
        setOptions(sources)
        setLoading(false)
      },
      (caught: unknown) => {
        if (request !== generation.current) return
        setError(caught instanceof Error ? caught.message : "Base timing discovery failed")
        setLoading(false)
      },
    )
  }

  function loadBase(songId: SongId, option: BaseTimingSourceOption): void {
    const request = ++generation.current
    setBaseSource(option.ref)
    setTiming("")
    setEvaluation("")
    setRules(emptyBeatHybridRulesJson())
    setLoading(true)
    setError("")
    void input.onLoadBase(songId, option.ref).then(
      (template) => {
        if (request !== generation.current) return
        const json = beatTemplateJson(template)
        setTiming(json.timing)
        setEvaluation(json.evaluation)
        setRules(json.rules)
        setLoading(false)
      },
      (caught: unknown) => {
        if (request !== generation.current) return
        setError(caught instanceof Error ? caught.message : "Base timing loading failed")
        setLoading(false)
      },
    )
  }

  return {
    baseSource,
    error,
    evaluation,
    loadBase,
    loadSources,
    loading,
    options,
    reset,
    rules,
    setError,
    setEvaluation,
    setRules,
    setTiming,
    timing,
  } as const
}
