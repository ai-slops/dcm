import { timingSafeEqual } from "node:crypto"

import { serveStatic } from "@hono/node-server/serve-static"
import { type Context, Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { bodyLimit } from "hono/body-limit"
import { compress } from "hono/compress"
import { getCookie, setCookie } from "hono/cookie"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { AgentRuns } from "./agent/runs.ts"
import type { StudioConfig } from "./config.ts"
import { loadDemo } from "./demo.ts"
import { StudioError } from "./errors.ts"
import { JSON_LIMIT, MULTIPART_LIMIT } from "./http.ts"
import { NativeService } from "./native/service.ts"
import { registerAgentRoutes } from "./routes/agent.ts"
import { registerDocumentRoutes } from "./routes/document.ts"
import { registerNativeRoutes } from "./routes/native.ts"
import { registerUcsRoutes } from "./routes/ucs.ts"
import { SessionStore } from "./sessions.ts"
import { StudioStore } from "./store.ts"
import type { Services, StudioApp, StudioEnv } from "./types.ts"

const SESSION_COOKIE = "pump_studio_session"

export async function createStudioApp(
  config: StudioConfig,
): Promise<Services & { readonly app: StudioApp }> {
  const demo = await loadDemo(config.repoRoot)
  const store = await StudioStore.open(config.dataRoot, demo.document, demo.audio)
  const sessions = new SessionStore()
  const native = new NativeService(config.repoRoot, config.dataRoot)
  const runs = new AgentRuns({ configuration: config.part, store, native })
  const services: Services = { config, store, sessions, native, runs }
  const app = new Hono<StudioEnv>()

  app.use("*", async (context, next) => {
    const host = context.req.header("host") ?? new URL(context.req.url).host
    const publicProxy =
      config.publicAccess !== undefined &&
      context.req.header("x-forwarded-host") === new URL(config.publicAccess.origin).host &&
      context.req.header("x-forwarded-proto") === "https"
    if (!config.allowedHosts.has(host) && !publicProxy)
      throw new StudioError(403, "host_denied", "Host is not allowed")
    const origin = context.req.header("origin")
    if (origin !== undefined && !config.allowedOrigins.has(origin)) {
      throw new StudioError(403, "origin_denied", "Origin is not allowed")
    }
    const length = Number(context.req.header("content-length") ?? 0)
    if (context.req.header("content-type")?.startsWith("application/json") && length > JSON_LIMIT) {
      throw new StudioError(413, "body_too_large", "JSON body exceeds 8 MiB")
    }
    await next()
  })
  app.get("/health", (context) =>
    context.json({
      service: "pump-studio",
      ready: true,
      instance: config.instanceId,
    }),
  )
  if (config.publicAccess !== undefined) {
    app.use("*", async (context, next) => {
      context.header("Cache-Control", "private, no-store")
      context.header("X-Robots-Tag", "noindex, nofollow")
      await next()
      context.header("Cache-Control", "private, no-store")
    })
    app.use(
      "*",
      basicAuth({
        username: "studio",
        password: config.publicAccess.password,
        realm: "PUMP Studio",
      }),
    )
  }
  app.use(
    "/api/v1/*",
    bodyLimit({
      maxSize: MULTIPART_LIMIT,
      onError: (context) =>
        context.json(
          { error: { code: "body_too_large", message: "Request body exceeds its limit" } },
          413,
        ),
    }),
  )
  app.use("/api/v1/*", async (context, next) => {
    let session = sessions.get(getCookie(context, SESSION_COOKIE))
    if (context.req.path === "/api/v1/bootstrap") {
      session ??= sessions.create()
      setCookie(context, SESSION_COOKIE, session.id, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
        secure: config.publicAccess !== undefined || new URL(context.req.url).protocol === "https:",
      })
    } else if (session === undefined) {
      throw new StudioError(403, "session_required", "Bootstrap the browser session first")
    }
    if (session !== undefined) context.set("session", session)
    if (session !== undefined && requiresCsrf(context.req.method, context.req.path)) {
      if (!tokensEqual(context.req.header("x-csrf-token"), session.csrfToken)) {
        throw new StudioError(403, "csrf_invalid", "CSRF token is missing or invalid")
      }
    }
    await next()
  })

  app.get("/api/v1/bootstrap", async (context) => {
    const session = context.get("session")
    const readiness = await native.readiness()
    return context.json({
      document: store.document(),
      csrf_token: session.csrfToken,
      session_id: session.id,
      native: readiness,
      agent: {
        configured: config.part !== undefined,
        provider: config.part === undefined ? null : "openai-compatible",
        model: config.part?.model ?? null,
      },
      proposals: [...session.proposals.values()],
      active_run:
        session.activeRunId === undefined ? null : (session.runs.get(session.activeRunId) ?? null),
    })
  })
  registerDocumentRoutes(app, services)
  registerNativeRoutes(app, services)
  registerUcsRoutes(app, services)
  registerAgentRoutes(app, services)

  app.use("/assets/*", compress({ encoding: "gzip" }))
  app.use("/assets/*", async (context, next) => {
    await next()
    context.header("Cache-Control", "public, max-age=31536000, immutable")
  })
  app.use("/fonts/*", async (context, next) => {
    await next()
    context.header("Cache-Control", "public, max-age=604800")
  })
  app.use("/", compress({ encoding: "gzip" }))
  app.use("/index.html", compress({ encoding: "gzip" }))
  app.use("/*", serveStatic({ root: config.clientRoot }))
  app.get("/*", serveStatic({ root: config.clientRoot, path: "index.html" }))
  app.onError((error, context) => errorResponse(error, context))
  return { app, ...services }
}

function requiresCsrf(method: string, path: string): boolean {
  return method !== "GET" || path.endsWith("/events")
}

function tokensEqual(received: string | undefined, expected: string): boolean {
  if (received === undefined) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

function errorResponse(error: Error, context: Context) {
  if (error instanceof HTTPException) return error.getResponse()
  if (error instanceof StudioError) {
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.currentRevision === undefined
            ? {}
            : { current_revision: error.currentRevision }),
        },
      },
      error.status,
    )
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return context.json(
      { error: { code: "invalid_request", message: "Request did not match the API contract" } },
      400,
    )
  }
  return context.json({ error: { code: "internal_error", message: "Internal server error" } }, 500)
}
