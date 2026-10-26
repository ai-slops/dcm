import { useCallback, useEffect, useRef, useState } from "react"

import type { Bootstrap, ChartProposal, Revision } from "../../shared/index.ts"
import { studioApi } from "../api/client.ts"
import { errorMessage } from "./action-utils.ts"

type RefreshedBootstrap = {
  readonly bootstrap: Bootstrap
  readonly refreshError: string
  readonly accept: (bootstrap: Bootstrap) => void
  readonly refresh: () => Promise<void>
}

export function useRefreshedBootstrap(
  initial: Bootstrap,
  revision: Revision,
  onProposal: (proposal: ChartProposal) => void,
): RefreshedBootstrap {
  const [bootstrap, setBootstrap] = useState(initial)
  const [refreshError, setRefreshError] = useState("")
  const previousRevision = useRef(revision)

  const accept = useCallback(
    (next: Bootstrap) => {
      for (const proposal of next.proposals ?? []) onProposal(proposal)
      setBootstrap(next)
      setRefreshError("")
    },
    [onProposal],
  )

  const refresh = useCallback(async () => {
    try {
      accept(await studioApi.bootstrap())
    } catch (error) {
      setRefreshError(`Runtime status refresh failed. ${errorMessage(error)}`)
    }
  }, [accept])

  useEffect(() => {
    if (previousRevision.current === revision) return
    previousRevision.current = revision
    void refresh()
  }, [refresh, revision])

  return { accept, bootstrap, refresh, refreshError }
}
