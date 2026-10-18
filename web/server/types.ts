import type { Hono } from "hono"
import type { AgentRuns } from "./agent/runs.ts"
import type { StudioConfig } from "./config.ts"
import type { NativeService } from "./native/service.ts"
import type { SessionStore, StudioSession } from "./sessions.ts"
import type { StudioStore } from "./store.ts"

export type StudioEnv = { Variables: { session: StudioSession } }
export type StudioApp = Hono<StudioEnv>
export type Services = {
  readonly config: StudioConfig
  readonly store: StudioStore
  readonly sessions: SessionStore
  readonly native: NativeService
  readonly runs: AgentRuns
}
