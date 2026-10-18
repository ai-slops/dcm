import { useEffect, useRef, useState } from "react"

import type { AgentRunSnapshot, Bootstrap, ChartProposal, Revision } from "../../shared/index.ts"
import { streamAgentEvents, studioApi } from "../api/client.ts"
import { errorMessage } from "./action-utils.ts"
import { type AgentActivity, appendAgentEvent, initialAgentActivity } from "./agent-events.ts"

type AgentRunController = {
  readonly actionError: string
  readonly activity: readonly AgentActivity[]
  readonly busy: string | null
  readonly disconnected: boolean
  readonly run: AgentRunSnapshot | null
  readonly running: boolean
  readonly cancel: () => Promise<void>
  readonly reconnect: () => void
  readonly setActionError: (message: string) => void
  readonly start: (prompt: string) => Promise<boolean>
}

export function useAgentRun(
  bootstrap: Bootstrap,
  revision: Revision,
  onProposal: (proposal: ChartProposal) => void,
): AgentRunController {
  const initialRun = bootstrap.active_run ?? null
  const [run, setRun] = useState<AgentRunSnapshot | null>(initialRun)
  const [activity, setActivity] = useState<readonly AgentActivity[]>(() =>
    initialRun === null ? [] : initialAgentActivity(initialRun.id, initialRun.prompt),
  )
  const [actionError, setActionError] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [disconnected, setDisconnected] = useState(false)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const lastSequenceRef = useRef(initialRun?.last_sequence ?? 0)
  const abortRef = useRef<AbortController | null>(null)
  const running = run?.status === "queued" || run?.status === "running"
  const runId = run?.id
  const connectionKey = `${runId ?? "idle"}:${reconnectAttempt}`

  useEffect(() => {
    if (!running || runId === undefined) return
    const abort = new AbortController()
    abortRef.current = abort
    let active = true

    async function restoreSnapshot(): Promise<void> {
      if (runId === undefined || !active) return
      try {
        const snapshot = await studioApi.agentSnapshot(runId)
        const refreshed = await studioApi.bootstrap()
        if (!active) return
        for (const proposal of refreshed.proposals ?? []) onProposal(proposal)
        setRun(snapshot)
        setDisconnected(snapshot.status === "queued" || snapshot.status === "running")
      } catch (error) {
        if (!active) return
        setDisconnected(true)
        setActionError(`Agent stream disconnected. ${errorMessage(error)}`)
      }
    }

    async function follow(): Promise<void> {
      if (runId === undefined) return
      try {
        for await (const event of streamAgentEvents({
          csrfToken: bootstrap.csrf_token,
          runId,
          lastSequence: lastSequenceRef.current,
          signal: abort.signal,
        })) {
          if (!active || event.sequence <= lastSequenceRef.current) continue
          lastSequenceRef.current = event.sequence
          setActivity((current) => appendAgentEvent(current, event))
          if (event.type === "proposal") onProposal(event.proposal)
          if (event.type === "status" && event.status === "running") {
            setRun((current) => (current === null ? null : { ...current, status: "running" }))
          }
          if (
            event.type === "completed" ||
            event.type === "error" ||
            (event.type === "status" && event.status === "cancelled")
          ) {
            const refreshed = await studioApi.bootstrap()
            if (!active) return
            for (const proposal of refreshed.proposals ?? []) onProposal(proposal)
          }
          if (event.type === "completed" || event.type === "error") {
            setRun((current) =>
              current === null
                ? null
                : {
                    ...current,
                    status: event.type === "completed" ? "completed" : "failed",
                    last_sequence: event.sequence,
                  },
            )
          }
          if (event.type === "status" && event.status === "cancelled") {
            setRun((current) =>
              current === null
                ? null
                : { ...current, status: "cancelled", last_sequence: event.sequence },
            )
          }
        }
        if (active && !abort.signal.aborted) await restoreSnapshot()
      } catch (error) {
        if (!active || abort.signal.aborted) return
        setActionError(`Agent stream disconnected. ${errorMessage(error)}`)
        await restoreSnapshot()
      }
    }

    void connectionKey
    void follow()
    return () => {
      active = false
      abort.abort()
    }
  }, [bootstrap.csrf_token, connectionKey, onProposal, runId, running])

  async function start(prompt: string): Promise<boolean> {
    if (busy !== null) return false
    const submittedPrompt = prompt.trim()
    setBusy("start")
    setActionError("")
    try {
      const next = await studioApi.startAgent(bootstrap.csrf_token, {
        base_revision: revision,
        prompt: submittedPrompt,
      })
      lastSequenceRef.current = next.last_sequence
      setActivity(initialAgentActivity(next.id, submittedPrompt))
      setRun(next)
      setDisconnected(false)
      return true
    } catch (error) {
      setActionError(errorMessage(error))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function cancel(): Promise<void> {
    if (run === null || busy !== null) return
    setBusy("cancel")
    setActionError("")
    try {
      const cancelled = await studioApi.cancelAgent(bootstrap.csrf_token, run.id)
      setRun(cancelled)
      abortRef.current?.abort()
      setDisconnected(false)
    } catch (error) {
      setActionError(`Cancel failed. ${errorMessage(error)}`)
    } finally {
      setBusy(null)
    }
  }

  return {
    actionError,
    activity,
    busy,
    cancel,
    disconnected,
    reconnect: () => {
      setDisconnected(false)
      setActionError("")
      setReconnectAttempt((current) => current + 1)
    },
    run,
    running,
    setActionError,
    start,
  }
}
