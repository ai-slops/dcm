import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import type { BootstrapLoadResult } from "./bootstrap.ts"
import { App } from "./ui/App.tsx"

class MissingStudioRootError extends Error {
  override readonly name = "MissingStudioRootError"
}

export function renderApp(bootstrapLoad: Promise<BootstrapLoadResult> | null): void {
  const root = document.getElementById("root")
  if (root === null) throw new MissingStudioRootError("PUMP Studio root element is missing")

  createRoot(root).render(
    <StrictMode>
      <App bootstrapLoad={bootstrapLoad} />
    </StrictMode>,
  )
}
