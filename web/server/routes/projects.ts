import { ProjectCommandSchema } from "../../shared/project-commands.ts"
import { ComponentIdSchema, GenerationProjectIdSchema } from "../../shared/project-identities.ts"
import { parseJson } from "../http.ts"
import type { Services, StudioApp } from "../types.ts"

export function registerProjectRoutes(app: StudioApp, services: Services): void {
  app.get("/api/v1/projects", (context) => context.json(services.projects.list()))
  app.get("/api/v1/projects/:id", (context) =>
    context.json(services.projects.read(GenerationProjectIdSchema.parse(context.req.param("id")))),
  )
  app.get("/api/v1/components/:id", (context) =>
    context.json(services.projects.component(ComponentIdSchema.parse(context.req.param("id")))),
  )
  app.post("/api/v1/projects/actions", async (context) => {
    const command = await parseJson(context, ProjectCommandSchema)
    return context.json(await services.projects.command(command, context.req.raw.signal))
  })
}
