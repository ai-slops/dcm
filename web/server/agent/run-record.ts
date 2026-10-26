import {
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  type AgentStreamEvent,
  type CurrentDocument,
  MAX_SESSION_PROPOSALS,
} from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import type { StudioSession } from "../sessions.ts"
import type { AudioRecord } from "../store.ts"
import type {
  PartOutcome,
  PartRun,
  PartRuntime,
  PartRuntimeFactory,
  ProposalInput,
} from "./part-runtime.ts"
import { buildAgentProposal } from "./proposal.ts"
import { safeFailure, safeProviderCode, safeProviderMessage } from "./run-errors.ts"
import { type EventPayload, RunEvents } from "./run-events.ts"
import type { AgentConfiguration, NativeOperations } from "./runs.ts"

const MAX_PROPOSALS = 4

type RunDependencies = {
  readonly session: StudioSession
  readonly document: CurrentDocument
  readonly audio: AudioRecord
  readonly prompt: string
  readonly configuration: AgentConfiguration | undefined
  readonly resolveConfiguration?: ((modelId?: string) => Promise<AgentConfiguration>) | undefined
  readonly modelId?: string | undefined
  readonly native: NativeOperations
  readonly createRuntime: PartRuntimeFactory
  readonly deadlineMs: number
  readonly onTerminal: () => void
}

export class RunRecord {
  readonly session: StudioSession
  readonly document: CurrentDocument
  #completion: Promise<void> = Promise.resolve()
  #terminal = false
  #cancelRequested = false
  #partRun: PartRun | undefined
  #runtime: PartRuntime | undefined
  #runtimeDisposed = false
  readonly #dependencies: RunDependencies
  readonly #abort = new AbortController()
  readonly #stream: RunEvents

  constructor(dependencies: RunDependencies) {
    this.#dependencies = dependencies
    this.session = dependencies.session
    this.document = dependencies.document
    const snapshot = AgentRunSnapshotSchema.parse({
      id: crypto.randomUUID(),
      base_revision: dependencies.document.revision,
      status: "queued",
      prompt: dependencies.prompt,
      last_sequence: 0,
    })
    this.#stream = new RunEvents(snapshot, (next) => this.session.runs.set(next.id, next))
    this.#publish({ type: "status", status: "queued" })
  }

  get snapshot(): AgentRunSnapshot {
    return this.#stream.snapshot
  }

  get events() {
    return this.#stream.events
  }

  get terminal(): boolean {
    return this.#terminal
  }

  begin(): void {
    this.#completion = this.#execute()
  }

  settled(): Promise<void> {
    return this.#completion
  }

  recordDecision(decision: NonNullable<AgentRunSnapshot["proposal_decisions"]>[number]): void {
    this.#stream.recordDecision(decision)
  }

  async cancel(): Promise<AgentRunSnapshot> {
    if (this.#terminal) return this.snapshot
    this.#cancelRequested = true
    this.#abort.abort("user-cancelled")
    this.#finishCancelled()
    await this.#cancelPart("user-cancelled")
    await this.#disposeRuntime()
    return this.snapshot
  }

  replay(after: number): readonly AgentStreamEvent[] {
    return this.#stream.replay(after)
  }

  subscribe(listener: (event: AgentStreamEvent | undefined) => void): () => void {
    return this.#stream.subscribe(listener)
  }

  async #execute(): Promise<void> {
    let runtime: PartRuntime | undefined
    let outcome: PartOutcome | undefined
    const timer = setTimeout(() => this.#timeout(), this.#dependencies.deadlineMs)
    try {
      const configuration =
        this.#dependencies.resolveConfiguration === undefined
          ? this.#dependencies.configuration
          : await this.#dependencies.resolveConfiguration(this.#dependencies.modelId)
      if (configuration === undefined) {
        this.#fail("agent_unconfigured", "Agent provider is not configured")
        return
      }
      const api = configuration.api ?? "chat"
      this.#stream.configure(configuration.model, api)
      const created = this.#dependencies.createRuntime({
        ...configuration,
        signal: this.#abort.signal,
        project: this.document.project,
        evaluateChart: (signal) =>
          this.#dependencies.native.evaluate(this.document.project, signal),
        generateVariant: (seed, signal) =>
          this.#dependencies.native.generate(
            this.document.project,
            this.#dependencies.audio,
            seed,
            signal,
          ),
        validateUcs: async (mode, signal) => {
          const validate = this.#dependencies.native.validateUcs
          if (validate === undefined) {
            throw new StudioError(503, "ucs_unavailable", "Native UCS validation is unavailable")
          }
          return validate(this.document.project, mode, signal)
        },
        proposeChart: (proposal, signal) => this.#propose(proposal, signal),
        onToolState: (toolId, state, detail) => {
          if (!this.#terminal) this.#publish({ type: "tool", tool_id: toolId, state, ...detail })
        },
      })
      if (!created.ok)
        return this.#fail("agent_configuration", "Agent runtime configuration failed")
      runtime = created.value
      this.#runtime = runtime
      if (this.#terminal) return
      this.#setStatus("running")
      this.#publish({ type: "status", status: "running" })
      const started = await runtime.start(this.snapshot.prompt)
      if (!started.ok) return this.#fail("agent_provider_request", "Agent provider request failed")
      this.#partRun = started.value
      if (this.#cancelRequested || this.#terminal) {
        await this.#cancelPart("cancelled-before-start")
        return
      }
      const observed = this.#observe(started.value)
      ;[outcome] = await Promise.all([started.value.done, observed])
    } catch (error) {
      if (!this.#terminal) this.#fail(...safeFailure(error))
    } finally {
      clearTimeout(timer)
      if (runtime !== undefined) await this.#disposeRuntime()
    }
    if (this.#terminal || outcome === undefined) return
    if (outcome.phase === "completed") this.#complete(outcome.text)
    else if (outcome.phase === "cancelled") this.#finishCancelled()
    else this.#fail(safeProviderCode(outcome.code), safeProviderMessage(outcome.code))
  }

  async #observe(run: PartRun): Promise<void> {
    for await (const update of run.observe()) {
      if (!this.#terminal) this.#publish({ type: "delta", text: update.text })
    }
  }

  async #propose(input: ProposalInput, signal: AbortSignal) {
    if (this.#terminal || signal.aborted)
      throw new StudioError(409, "run_cancelled", "Run is no longer active")
    await Promise.resolve()
    if (this.#terminal || signal.aborted)
      throw new StudioError(409, "run_cancelled", "Run is no longer active")
    const owned = [...this.session.proposals.values()].filter(
      (proposal) => proposal.source === "agent" && proposal.run_id === this.snapshot.id,
    )
    if (owned.length >= MAX_PROPOSALS)
      throw new StudioError(409, "proposal_limit", "Run proposal limit reached")
    if (this.session.proposals.size >= MAX_SESSION_PROPOSALS)
      throw new StudioError(409, "proposal_limit", "Review pending proposals before creating more")
    const proposal = buildAgentProposal(this.document, input, this.snapshot.id)
    this.session.proposals.set(proposal.id, proposal)
    this.#publish({ type: "proposal", proposal })
    return { proposal_id: proposal.id }
  }

  #complete(text: string): void {
    this.#terminal = true
    this.#clearActive()
    this.#setStatus("completed")
    this.#publish({ type: "completed", text })
    this.#close()
  }

  #finishCancelled(): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#clearActive()
    this.#setStatus("cancelled")
    this.#publish({ type: "status", status: "cancelled" })
    this.#close()
  }

  #fail(code = "agent_runtime_failed", message = "Agent run failed"): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#abort.abort("agent-runtime-failed")
    this.#clearActive()
    this.#setStatus("failed")
    this.#publish({ type: "error", code, message })
    this.#close()
  }

  #timeout(): void {
    if (this.#terminal) return
    this.#abort.abort("deadline")
    void this.#cancelPart("deadline")
    void this.#disposeRuntime()
    this.#terminal = true
    this.#clearActive()
    this.#setStatus("failed")
    this.#publish({ type: "error", code: "agent_timeout", message: "Agent run timed out" })
    this.#close()
  }

  async #cancelPart(reason: string): Promise<void> {
    try {
      await this.#partRun?.cancel(reason)
    } catch (error) {
      if (!this.#terminal) this.#fail(...safeFailure(error))
    }
  }

  async #disposeRuntime(): Promise<void> {
    if (this.#runtime === undefined || this.#runtimeDisposed) return
    this.#runtimeDisposed = true
    try {
      await this.#runtime.dispose()
    } catch (error) {
      if (!this.#terminal) this.#fail(...safeFailure(error))
    }
  }

  #clearActive(): void {
    if (this.session.activeRunId === this.snapshot.id) this.session.activeRunId = undefined
    this.#dependencies.onTerminal()
  }

  #setStatus(status: AgentRunSnapshot["status"]): void {
    this.#stream.setStatus(status)
  }

  #publish(payload: EventPayload): void {
    this.#stream.publish(payload)
  }

  #close(): void {
    this.#stream.close()
  }
}
