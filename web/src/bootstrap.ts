import type { Bootstrap } from "../shared/api.ts"
import { ApiRoutes } from "../shared/routes.ts"
import { http } from "./api/http.ts"

export type BootstrapLoadResult =
  | { readonly kind: "ready"; readonly bootstrap: Bootstrap }
  | { readonly kind: "error"; readonly message: string }

export function startBootstrap(): Promise<BootstrapLoadResult> {
  const bootstrap = Promise.all([http.get(ApiRoutes.bootstrap), import("../shared/api.ts")]).then(
    ([response, { BootstrapSchema }]) =>
      response.json().then((body) => BootstrapSchema.parse(body)),
  )

  return bootstrap.then(
    (value) => ({ kind: "ready", bootstrap: value }),
    (error: unknown) => ({
      kind: "error",
      message: error instanceof Error ? error.message : "Studio bootstrap failed",
    }),
  )
}
