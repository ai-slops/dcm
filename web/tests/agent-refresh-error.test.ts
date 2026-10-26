import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { BootstrapSchema } from "../shared/index.ts"
import { AgentPanel } from "../src/ui/AgentPanel.tsx"
import { repoRoot } from "./support/paths.ts"

it("exposes runtime refresh failure with a visible alert", async () => {
  const demo = await loadDemo(repoRoot)
  const bootstrap = BootstrapSchema.parse({
    document: demo.document,
    csrf_token: "fixture-csrf",
    session_id: "fixture-session",
    native: { ready: true, message: "ready" },
    agent: { configured: false, provider: null, model: null },
  })
  const message = "Fixture runtime status refresh failed"
  const markup = renderToStaticMarkup(
    createElement(AgentPanel, {
      bootstrap,
      dirty: false,
      revision: bootstrap.document.revision,
      proposals: [],
      runtimeError: message,
      onProposal: () => undefined,
      onBootstrap: () => undefined,
      apply: async () => undefined,
      discard: async () => undefined,
    }),
  )
  expect(markup).toContain('role="alert"')
  expect(markup).toContain(message)
})
