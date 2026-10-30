import { beatOutputContextFor } from "../../shared/beat-output.ts"
import {
  BaseRevisionRequestSchema,
  ChartProposalSchema,
  type CurrentDocument,
  GenerationRequestSchema,
  MAX_SESSION_PROPOSALS,
} from "../../shared/index.ts"
import { StudioError } from "../errors.ts"
import { parseJson } from "../http.ts"
import { NativeDocumentUnsupportedError, nativeDocumentFor } from "../native/beat-document.ts"
import { exportFilename } from "../native/service.ts"
import type { Services, StudioApp } from "../types.ts"
import { applyProposalSource } from "./proposal-timing.ts"

export function registerNativeRoutes(app: StudioApp, services: Services): void {
  app.post("/api/v1/evaluations", async (context) => {
    const request = await parseJson(context, BaseRevisionRequestSchema)
    const document = currentAtRevision(services, request.base_revision)
    return context.json(await services.native.evaluate(nativeProject(document)))
  })

  app.post("/api/v1/generations", async (context) => {
    const request = await parseJson(context, GenerationRequestSchema)
    const document = currentAtRevision(services, request.base_revision)
    const native = nativeProject(document)
    const chart = await services.native.generate(native, services.store.audio(), request.seed)
    const session = context.get("session")
    if (session.proposals.size >= MAX_SESSION_PROPOSALS)
      throw new StudioError(
        409,
        "proposal_limit",
        "Review pending proposals before generating more",
      )
    const proposal = ChartProposalSchema.parse({
      id: services.sessions.proposalId(),
      base_revision: document.revision,
      source: "native_generate",
      summary: `Native candidate for seed ${request.seed.slice(0, 8)}`,
      chart,
      before: { chart: native.chart, music: native.music },
    })
    session.proposals.set(proposal.id, proposal)
    return context.json(proposal)
  })

  app.post("/api/v1/exports", async (context) => {
    const request = await parseJson(context, BaseRevisionRequestSchema)
    const document = currentAtRevision(services, request.base_revision)
    const native = nativeProject(document)
    const archive = await services.native.export(native, services.store.audio())
    return new Response(Uint8Array.from(archive).buffer, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${exportFilename(native)}"`,
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
    const project = applyProposalSource(current.project, proposal, beatOutputContextFor(current))
    const saved = await services.store.save(request.base_revision, project)
    session.proposals.delete(proposal.id)
    services.runs.recordDecision(session, proposal.run_id, {
      id: proposal.id,
      status: "applied",
      revision: saved.revision,
      summary: proposal.summary,
    })
    return context.json(saved)
  })

  app.delete("/api/v1/proposals/:id", (context) => {
    const session = context.get("session")
    const proposal = session.proposals.get(context.req.param("id"))
    if (proposal === undefined)
      throw new StudioError(404, "proposal_not_found", "Proposal was not found")
    session.proposals.delete(proposal.id)
    services.runs.recordDecision(session, proposal.run_id, {
      id: proposal.id,
      status: "rejected",
      summary: proposal.summary,
    })
    return context.body(null, 204)
  })
}

function nativeProject(document: CurrentDocument) {
  try {
    return nativeDocumentFor(document.project, beatOutputContextFor(document))
  } catch (error) {
    if (error instanceof NativeDocumentUnsupportedError)
      throw new StudioError(422, error.capability.code, error.message)
    throw error
  }
}

export function currentAtRevision(services: Services, revision: number) {
  const document = services.store.document()
  if (document.revision !== revision) {
    throw new StudioError(409, "revision_conflict", "Document revision is stale", document.revision)
  }
  return document
}
