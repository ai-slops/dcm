import {
  BaseRevisionRequestSchema,
  ChartProposalSchema,
  GenerationRequestSchema,
  type StudioProjectV1,
} from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import { parseJson } from "../http.ts"
import { exportFilename } from "../native/service.ts"
import type { Services, StudioApp } from "../types.ts"

export function registerNativeRoutes(app: StudioApp, services: Services): void {
  app.post("/api/v1/evaluations", async (context) => {
    const request = await parseJson(context, BaseRevisionRequestSchema)
    const document = currentAtRevision(services, request.base_revision)
    return context.json(await services.native.evaluate(document.project))
  })

  app.post("/api/v1/generations", async (context) => {
    const request = await parseJson(context, GenerationRequestSchema)
    const document = currentAtRevision(services, request.base_revision)
    const chart = await services.native.generate(
      document.project,
      services.store.audio(),
      request.seed,
    )
    const session = context.get("session")
    const proposal = ChartProposalSchema.parse({
      id: services.sessions.proposalId(),
      base_revision: document.revision,
      source: "native_generate",
      summary: `Native candidate for seed ${request.seed.slice(0, 8)}`,
      chart,
    })
    session.proposals.set(proposal.id, proposal)
    return context.json(proposal)
  })

  app.post("/api/v1/exports", async (context) => {
    const request = await parseJson(context, BaseRevisionRequestSchema)
    const document = currentAtRevision(services, request.base_revision)
    const archive = await services.native.export(document.project, services.store.audio())
    return new Response(Uint8Array.from(archive).buffer, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${exportFilename(document.project)}"`,
        "content-length": String(archive.byteLength),
      },
    })
  })

  app.post("/api/v1/proposals/:id/apply", async (context) => {
    const request = await parseJson(context, BaseRevisionRequestSchema)
    const session = context.get("session")
    const proposal = session.proposals.get(context.req.param("id"))
    if (proposal === undefined)
      throw new StudioError(404, "proposal_not_found", "Proposal was not found")
    if (proposal.base_revision !== request.base_revision) {
      throw new StudioError(409, "proposal_stale", "Proposal was created for another revision")
    }
    const current = currentAtRevision(services, request.base_revision)
    const project: StudioProjectV1 = { ...current.project, chart: proposal.chart }
    const saved = await services.store.save(request.base_revision, project)
    session.proposals.delete(proposal.id)
    return context.json(saved)
  })

  app.delete("/api/v1/proposals/:id", (context) => {
    const removed = context.get("session").proposals.delete(context.req.param("id"))
    if (!removed) throw new StudioError(404, "proposal_not_found", "Proposal was not found")
    return context.body(null, 204)
  })
}

function currentAtRevision(services: Services, revision: number) {
  const document = services.store.document()
  if (document.revision !== revision) {
    throw new StudioError(409, "revision_conflict", "Document revision is stale", document.revision)
  }
  return document
}
