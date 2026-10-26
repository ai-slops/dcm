import { HTTPError } from "ky"
import type { z } from "zod"
import type {
  AgentRunRequest,
  AgentRunSnapshot,
  AgentStreamEvent,
  BaseRevisionRequest,
  Bootstrap,
  ChartProposal,
  CurrentDocument,
  EvaluationResponse,
  GenerationRequest,
  PutDocumentRequest,
  StudioProjectV1,
  UcsExportRequest,
} from "../../shared/index.ts"
import {
  AgentRunSnapshotSchema,
  AgentStreamEventSchema,
  ApiErrorSchema,
  ApiRoutes,
  BootstrapSchema,
  ChartProposalSchema,
  CurrentDocumentSchema,
  EvaluationResponseSchema,
} from "../../shared/index.ts"
import { http } from "./http.ts"

export class StudioApiError extends Error {
  readonly code: string
  readonly status: number
  readonly currentRevision?: number

  constructor(input: {
    readonly code: string
    readonly message: string
    readonly status: number
    readonly currentRevision?: number
  }) {
    super(input.message)
    this.name = "StudioApiError"
    this.code = input.code
    this.status = input.status
    if (input.currentRevision !== undefined) this.currentRevision = input.currentRevision
  }
}

async function parseJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await response.json())
}

async function request<T>(operation: Promise<Response>, schema: z.ZodType<T>): Promise<T> {
  try {
    return await parseJson(await operation, schema)
  } catch (error) {
    return rethrowApiError(error)
  }
}

function rethrowApiError(error: unknown): never {
  if (!(error instanceof HTTPError)) throw error
  const parsed = ApiErrorSchema.safeParse(error.data)
  if (!parsed.success) throw error
  throw new StudioApiError({
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    status: error.response.status,
    ...(parsed.data.error.current_revision === undefined
      ? {}
      : { currentRevision: parsed.data.error.current_revision }),
  })
}

async function requestBlob(operation: Promise<Response>): Promise<Blob> {
  try {
    return await (await operation).blob()
  } catch (error) {
    return rethrowApiError(error)
  }
}

function mutationHeaders(csrfToken: string): Readonly<Record<string, string>> {
  return { "x-csrf-token": csrfToken }
}

export const studioApi = {
  bootstrap(): Promise<Bootstrap> {
    return request(http.get(ApiRoutes.bootstrap), BootstrapSchema)
  },
  audio(): Promise<Blob> {
    return http.get(ApiRoutes.audio).blob()
  },
  uploadAudio(csrfToken: string, baseRevision: number, audio: File): Promise<CurrentDocument> {
    const body = new FormData()
    body.set("base_revision", String(baseRevision))
    body.set("audio", audio)
    return request(
      http.put(ApiRoutes.audio, { headers: mutationHeaders(csrfToken), body }),
      CurrentDocumentSchema,
    )
  },
  importProject(
    csrfToken: string,
    baseRevision: number,
    project: StudioProjectV1,
    audio: File,
  ): Promise<CurrentDocument> {
    const body = new FormData()
    body.set("base_revision", String(baseRevision))
    body.set("project", JSON.stringify(project))
    body.set("audio", audio)
    return request(
      http.post(ApiRoutes.imports, { headers: mutationHeaders(csrfToken), body }),
      CurrentDocumentSchema,
    )
  },
  save(csrfToken: string, body: PutDocumentRequest): Promise<CurrentDocument> {
    return request(
      http.put(ApiRoutes.document, { headers: mutationHeaders(csrfToken), json: body }),
      CurrentDocumentSchema,
    )
  },
  evaluate(csrfToken: string, body: BaseRevisionRequest): Promise<EvaluationResponse> {
    return request(
      http.post(ApiRoutes.evaluations, { headers: mutationHeaders(csrfToken), json: body }),
      EvaluationResponseSchema,
    )
  },
  generate(csrfToken: string, body: GenerationRequest): Promise<ChartProposal> {
    return request(
      http.post(ApiRoutes.generations, { headers: mutationHeaders(csrfToken), json: body }),
      ChartProposalSchema,
    )
  },
  applyProposal(csrfToken: string, proposalId: string, body: BaseRevisionRequest) {
    return request(
      http.post(`${ApiRoutes.proposals}/${encodeURIComponent(proposalId)}/apply`, {
        headers: mutationHeaders(csrfToken),
        json: body,
      }),
      CurrentDocumentSchema,
    )
  },
  async discardProposal(csrfToken: string, proposalId: string): Promise<void> {
    await http.delete(`${ApiRoutes.proposals}/${encodeURIComponent(proposalId)}`, {
      headers: mutationHeaders(csrfToken),
    })
  },
  startAgent(csrfToken: string, body: AgentRunRequest): Promise<AgentRunSnapshot> {
    return request(
      http.post(ApiRoutes.agentRuns, { headers: mutationHeaders(csrfToken), json: body }),
      AgentRunSnapshotSchema,
    )
  },
  agentSnapshot(runId: string): Promise<AgentRunSnapshot> {
    return request(
      http.get(`${ApiRoutes.agentRuns}/${encodeURIComponent(runId)}`),
      AgentRunSnapshotSchema,
    )
  },
  cancelAgent(csrfToken: string, runId: string): Promise<AgentRunSnapshot> {
    return request(
      http.delete(`${ApiRoutes.agentRuns}/${encodeURIComponent(runId)}`, {
        headers: mutationHeaders(csrfToken),
      }),
      AgentRunSnapshotSchema,
    )
  },
  exportZip(csrfToken: string, body: BaseRevisionRequest): Promise<Blob> {
    return http.post(ApiRoutes.exports, { headers: mutationHeaders(csrfToken), json: body }).blob()
  },
  exportUcs(csrfToken: string, body: UcsExportRequest): Promise<Blob> {
    return requestBlob(
      http.post(ApiRoutes.ucsExport, { headers: mutationHeaders(csrfToken), json: body }),
    )
  },
  importUcs(
    csrfToken: string,
    input: { readonly baseRevision: number; readonly chart: File; readonly audio?: File },
  ): Promise<CurrentDocument> {
    const body = new FormData()
    body.set("base_revision", String(input.baseRevision))
    body.set("chart", input.chart)
    if (input.audio !== undefined) body.set("audio", input.audio)
    return request(
      http.post(ApiRoutes.ucsImport, { headers: mutationHeaders(csrfToken), body }),
      CurrentDocumentSchema,
    )
  },
}

export async function* streamAgentEvents(input: {
  readonly csrfToken: string
  readonly runId: string
  readonly lastSequence?: number
  readonly signal?: AbortSignal
}): AsyncGenerator<AgentStreamEvent> {
  const response = await http.get(
    `${ApiRoutes.agentRuns}/${encodeURIComponent(input.runId)}/events`,
    {
      headers: {
        ...mutationHeaders(input.csrfToken),
        ...(input.lastSequence === undefined
          ? {}
          : { "Last-Event-ID": String(input.lastSequence) }),
      },
      signal: input.signal,
      timeout: false,
    },
  )
  const body = response.body
  if (body === null) return
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ""
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      pending += chunk.value.replaceAll("\r\n", "\n")
      let boundary = pending.indexOf("\n\n")
      while (boundary >= 0) {
        const frame = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        const payload = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (payload.length > 0) yield AgentStreamEventSchema.parse(JSON.parse(payload))
        boundary = pending.indexOf("\n\n")
      }
    }
  } finally {
    reader.releaseLock()
  }
}
