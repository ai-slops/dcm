import type { CurrentDocument, EvaluationResponse, NativeChart } from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import type { StudioSession } from "../sessions.ts"
import type { AudioRecord, StudioStore } from "../store.ts"
import { createPartRuntime, type PartRuntimeFactory } from "./part-runtime.ts"
import { RunRecord } from "./run-record.ts"

const MAX_SESSION_RUNS = 32
const MAX_RETAINED_RUNS = 256

export type AgentConfiguration = {
  readonly endpoint: URL
  readonly model: string
  readonly apiKey?: string
}

export type NativeOperations = {
  readonly evaluate: (
    project: CurrentDocument["project"],
    signal?: AbortSignal,
  ) => Promise<EvaluationResponse>
  readonly generate: (
    project: CurrentDocument["project"],
    audio: AudioRecord,
    seed: string,
    signal?: AbortSignal,
  ) => Promise<NativeChart>
}

export type AgentRunsDependencies = {
  readonly configuration: AgentConfiguration | undefined
  readonly store: StudioStore
  readonly native: NativeOperations
  readonly createRuntime?: PartRuntimeFactory
  readonly deadlineMs?: number
}

export class AgentRuns {
  readonly #records = new Map<string, RunRecord>()
  readonly #dependencies: AgentRunsDependencies

  constructor(dependencies: AgentRunsDependencies) {
    this.#dependencies = dependencies
  }

  start(session: StudioSession, document: CurrentDocument, prompt: string) {
    const configuration = this.#dependencies.configuration
    if (configuration === undefined) {
      throw new StudioError(
        503,
        "agent_unconfigured",
        "Set PART_ENDPOINT and PART_MODEL to configure the agent",
      )
    }
    if (session.activeRunId !== undefined) {
      throw new StudioError(409, "agent_active", "This browser session already has an active run")
    }
    const record = new RunRecord({
      session,
      document,
      audio: this.#dependencies.store.audio(),
      prompt,
      configuration,
      native: this.#dependencies.native,
      createRuntime: this.#dependencies.createRuntime ?? createPartRuntime,
      deadlineMs: this.#dependencies.deadlineMs ?? 120_000,
      onTerminal: () => this.#prune(session),
    })
    this.#records.set(record.snapshot.id, record)
    session.runs.set(record.snapshot.id, record.snapshot)
    session.activeRunId = record.snapshot.id
    this.#prune(session)
    record.begin()
    return record.snapshot
  }

  get(session: StudioSession, id: string): RunRecord {
    const record = this.#records.get(id)
    if (record === undefined || record.session !== session) {
      throw new StudioError(404, "run_not_found", "Agent run was not found")
    }
    return record
  }

  #prune(session: StudioSession): void {
    pruneMap(session.runs, MAX_SESSION_RUNS, (id) => id !== session.activeRunId)
    pruneMap(this.#records, MAX_RETAINED_RUNS, (_id, record) => record.terminal)
  }
}

function pruneMap<Value>(
  values: Map<string, Value>,
  maximum: number,
  removable: (id: string, value: Value) => boolean,
): void {
  for (const [id, value] of values) {
    if (values.size <= maximum) return
    if (removable(id, value)) values.delete(id)
  }
}
