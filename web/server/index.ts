import { serve } from "@hono/node-server"

import { createStudioApp } from "./app.ts"
import { loadConfig } from "./config.ts"

const config = loadConfig(process.env)
const studio = await createStudioApp(config)

serve(
  {
    fetch: studio.app.fetch,
    hostname: "127.0.0.1",
    port: config.port,
  },
  (info) => process.stdout.write(`PUMP Studio listening on http://127.0.0.1:${info.port}\n`),
)
