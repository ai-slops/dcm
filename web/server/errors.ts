import type { ContentfulStatusCode } from "hono/utils/http-status"

export class StudioError extends Error {
  override readonly name = "StudioError"

  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly currentRevision?: number,
  ) {
    super(message)
  }
}

export function invalidRequest(message: string): StudioError {
  return new StudioError(400, "invalid_request", message)
}
