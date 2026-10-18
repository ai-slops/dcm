import { AlertTriangle, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"

import type { BootstrapLoadResult } from "../bootstrap.ts"
import { PrimitiveShowcase } from "./PrimitiveShowcase.tsx"
import { Button } from "./primitives.tsx"
import { Studio } from "./Studio.tsx"

type LoadState = { readonly kind: "loading" } | BootstrapLoadResult

export function App({
  bootstrapLoad,
}: {
  readonly bootstrapLoad: Promise<BootstrapLoadResult> | null
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const showcase =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has("showcase")

  useEffect(() => {
    if (bootstrapLoad === null) return
    let active = true
    void bootstrapLoad.then((result) => {
      if (active) setState(result)
    })
    return () => {
      active = false
    }
  }, [bootstrapLoad])

  if (showcase) return <PrimitiveShowcase />
  if (state.kind === "ready") return <Studio bootstrap={state.bootstrap} />
  if (state.kind === "loading") {
    return (
      <div className="empty-state" role="status">
        Loading saved studio project...
      </div>
    )
  }
  return (
    <main className="empty-state">
      <AlertTriangle aria-hidden="true" size={28} />
      <h1>Studio server unavailable</h1>
      <p>{state.message}. Start the local API, then reconnect. No demo data has been invented.</p>
      <Button
        variant="primary"
        icon={<RefreshCw size={15} />}
        onClick={() => window.location.reload()}
      >
        Reconnect
      </Button>
    </main>
  )
}
