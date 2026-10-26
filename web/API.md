# PUMP Studio Web Contract

Status: implementation contract for the first local web editor. The schemas in `shared/` are the
machine-readable source of truth; this file fixes transport, concurrency, and ownership details.

## Runtime and trust boundary

- Run `web` with Node.js `>=24.22.0` and pnpm `10.17.1`.
- The browser never sends a provider endpoint, model name, API key, native executable path, or
  filesystem path. The server reads provider/native configuration from trusted startup settings.
- Browser requests are same-origin. The server creates an HTTP-only session cookie and returns a
  `csrf_token` from bootstrap. Every state-changing request and the agent event stream sends that
  value as `x-csrf-token`. The event stream uses `fetch`/ky, not `EventSource`, so it can set the
  header and process non-2xx responses.
- CORS is disabled. Exact Host/Origin allowlists admit local origins and, in public mode, the
  configured HTTPS origin. For ingress that rewrites Host, only its exact configured
  `X-Forwarded-Host` plus `X-Forwarded-Proto: https` is accepted. Forwarded headers never bypass
  authentication. Part's local-mode fetch transport receives only its configured provider origin.
- No provider credential exists by default. A configured key is bound by `bearerAuth`; the key is
  never returned to the browser or accepted over HTTP.
- Public preview requires `STUDIO_PUBLIC_ORIGIN` and an owner-only `STUDIO_PASSWORD_FILE`
  containing `studio:<password>`. HTTP Basic sign-in protects every static/API/audio request,
  including loopback requests. Missing or invalid sign-in returns `401` with `WWW-Authenticate`,
  before session bootstrap. Cookies are Secure in public mode, including behind the HTTP proxy.
- Public mode disables Part even if provider settings exist. The preview launcher also uses an
  allowlisted runtime environment and does not load `web/.env`, so provider/router credentials
  are not inherited by the public server or its native children. Local mode retains `.env` setup.
- `GET /health` is the only unauthenticated route. It returns
  `{ service: "pump-studio", ready: true, instance }`, where `instance` is the launcher-owned
  `STUDIO_INSTANCE_ID` or `"foreground"`. This is process readiness, not native certification.
  It exposes no project, audio, model, credential, or filesystem data.
- UCS parsing/rendering is native (`pump-ucs` through the CLI). The server accepts only uploaded
  bytes and fixed temporary filenames, never caller-selected executable, destination, or server paths.

## Shared exports

`shared/index.ts` exports every schema and inferred type from these modules:

- `native.ts`: `Fraction`, `NativeMusic`, `NativeNote`, `NativeChart`, their schemas, numeric caps,
  and `canonicalizeChart(input)`.
- `evaluation-contract.ts`: the complete native `EvalContract` and nested schemas.
- `assessment.ts`: the complete native `NativeAssessment`, `EvaluationResponse`, and schemas.
- `project.ts`: `AudioAsset`, `StudioProjectV1`, and schemas.
- `api.ts`: `Revision`, `CurrentDocument`, `ChartProposal`, `Bootstrap`, `ApiError`, agent run/event
  types, request types, all corresponding schemas, and `ApiRoutes`.

All object schemas reject unknown keys. Every JSON integer must be a safe integer. Integers are
nonnegative except `music.offset_micros`, which is signed. Studio bounds are 1,000,000 duration
ticks, 10,000 chart notes, and 4,096 tempo segments. Fractions are positive-denominator reduced
pairs. SHA-256 is exactly 32 integer bytes. Music tempo starts at tick zero and is strictly ordered;
reference accents are strictly ordered and in range. Charts use mask `0x001..0x3ff`, canonical
`(tick, hold_ticks, panel_mask)` order, merged equal tick/duration demands, no same-panel overlap,
and exact music grid/span equality. Title and artist are 1-256 printable ASCII bytes and cannot
contain `//`, matching native SSC metadata limits.

`StudioProjectV1` is exactly:

```text
{ schema_version: 1, title, artist, music: NativeMusic, chart: NativeChart,
  evaluation_contract: EvalContract,
  audio_asset: { format: "wav" | "ogg" | "mp3", byte_length },
  ucs_mode?: "Single" | "Double" }
```

The immutable audio identity is `music.audio_sha256`; `audio_asset` records transport metadata.
An ordinary document save cannot change either audio identity or metadata. Audio/import endpoints
own those changes and verify SHA-256 from uploaded bytes.
`ucs_mode` is an export preference, not a second native layout or source certificate. Older projects
default to Double; Single uses native left-pad bits 0–4 and rejects right-pad bits at export.

## HTTP API

All JSON responses use `application/json`. Contract failures use
`{ error: { code, message, current_revision? } }`. A stale `base_revision` is `409` and includes the
current revision. Validation is `400`; missing session/CSRF is `403`; native unavailable is `503`.
Public Basic-auth failures are plain-text `401` challenges rather than JSON contract errors.
Known bounded native UCS failures are `422 ucs_rejected` with a useful format/line message;
non-UCS native stderr stays private. Exact native rational overflow is separately reported as
`422 timing_capacity_exceeded`, not a fabricated rejection assessment or a changed timing map.

| Method and path | Request | Success |
| --- | --- | --- |
| `GET /health` | none; no sign-in | process readiness JSON described above |
| `GET /api/v1/bootstrap` | none | `Bootstrap` |
| `GET /api/v1/audio` | optional single `Range: bytes=start-end` | `200` bytes or `206` with standard range headers; immutable ETag is audio SHA-256 |
| `PUT /api/v1/document` | `PutDocumentRequest` | `CurrentDocument` |
| `PUT /api/v1/audio` | multipart `base_revision` decimal + one `audio` file | `CurrentDocument` |
| `POST /api/v1/imports` | multipart `base_revision` decimal + `project` JSON part + one `audio` file | `CurrentDocument` |
| `POST /api/v1/evaluations` | `BaseRevisionRequest` | `{ summary, raw_native }` validated by `EvaluationResponseSchema` |
| `POST /api/v1/generations` | `GenerationRequest` with lowercase 64-hex seed | `ChartProposal` with source `native_generate` |
| `POST /api/v1/exports` | `BaseRevisionRequest` | `application/zip` SSC export |
| `POST /api/v1/ucs/export` | `{ base_revision, mode: "Single" \| "Double" }` | actual UCS bytes, `text/plain; charset=utf-8`, attachment filename and `x-pump-certification: none` |
| `POST /api/v1/ucs/import` | multipart `base_revision`, one `chart` UCS file, optional `audio` file | `CurrentDocument` with native parsed chart/music and persisted `ucs_mode` |
| `POST /api/v1/proposals/:id/apply` | `BaseRevisionRequest` | `CurrentDocument` |
| `DELETE /api/v1/proposals/:id` | no body | `204` |
| `POST /api/v1/agent/runs` | `AgentRunRequest` | `202 AgentRunSnapshot` |
| `GET /api/v1/agent/runs/:id/events` | `x-csrf-token`; optional `Last-Event-ID` | SSE `AgentStreamEvent` records |
| `GET /api/v1/agent/runs/:id` | none | `AgentRunSnapshot` for refresh/recovery |
| `DELETE /api/v1/agent/runs/:id` | no body | updated `AgentRunSnapshot` |

`EvaluationResponse.summary` is `{ label: "finite_model", accepted, uncalibrated,
rejection_count }`; `raw_native` retains the complete typed native assessment. It is not an official
rating or safety guarantee.

UCS import retains current title, artist, and evaluation contract. If the parsed duration cannot
retain that contract, it fails with `422 ucs_project_incompatible` without saving anything. Audio
is either supplied in the same request or explicitly reused from the current revision; native
import binds its SHA-256 and the store checks it again before atomic commit. UCS itself does not
contain audio, titles, reference accents, evaluation contracts, or certification. Imports start
with empty reference accents and remain uncertified drafts. See [the supported profile](../docs/ucs.md).
UCS files are capped at 16 MiB and audio at 32 MiB; the bounded multipart envelope allows both plus
1 MiB of overhead. Unknown/duplicate multipart fields are rejected.

Agent SSE events are a finite discriminated union with common `{ run_id, sequence }` fields:
`status`, `delta`, `tool`, `proposal`, `error`, and `completed`. Sequence starts at zero and strictly
increases per run. Reconnect resumes after `Last-Event-ID`; if retained events are unavailable, the
snapshot endpoint is authoritative. A run snapshots `base_revision`; agent output can only create a
proposal. It never mutates the document. A proposal applies only when its base revision is current.

## State and concurrency

- The server owns one current document, monotonically increasing revision, proposals, run snapshots,
  and content-addressed audio under ignored `/.pump-studio/`. Write a replacement atomically before
  publishing its revision. Serialize all mutations.
- The browser owns local draft edits and undo/redo. Save is explicit. Apply/import is disabled while
  the draft is dirty; stale proposals are never applied.
- Native generation is limited to the server demo bundle and only when current music exactly matches
  the bundle profile. A mismatch returns `409 profile_mismatch`; it does not reset or replace music.

## Part 0.1.0 integration evidence

Both Part packages are exact-pinned at `0.1.0`; release source is commit
`c85038744bfef810551984e3e9da4d447839caab`. Installed package source established these APIs:

- `createAgent` is imported from `@slop-lab/part-plugins/agent/index.js` and returns
  `Contracts.Result<Convenience.Agent>`. `generate()` returns a managed outcome; callers must check
  both Result and outcome phase. `dispose()` is explicit.
- `functionTool` is imported from `@slop-lab/part/tools.js`. It requires Part `input` and `output`
  schemas, wraps the returned value as a tool result, and defaults to read effects.
- `createOpenAICompatibleAdapter` is imported from
  `@slop-lab/part-plugins/providers/openai-compatible/index.js`. The adapter implements text and
  runtime function tools through Chat Completions JSON/SSE, not Responses, media, or hosted tools.
- `createFetchTransport({ allowedOrigins })`, `noAuth`, and `bearerAuth` come from
  `@slop-lab/part/model/index.js`. Fetch rejects non-HTTP(S), unlisted origins, redirects, unsupported
  auth bindings, and missing endpoints.
- `createAgent` additionally requires JSON Schema in `toolSchemas` for every advertised installed
  tool. The basic driver executes tool calls and supplies assistant call plus tool result to the next
  model turn.

`server/agent/part-runtime.ts` installs four scoped tools: `read_document`, `evaluate_chart`,
`generate_variant`, and `propose_chart`. They read the frozen run snapshot, invoke bounded native
operations, or create review-only proposals; they never expose shell or arbitrary file access.
The initial fixture test exercises a real HTTP read-document round trip. The full API tests also
exercise changed-chart proposals, explicit application, cancellation, failure cleanup, and SSE
catch-up without event gaps. They use no API key and no fake Part agent or transport. When event
retention is exceeded, reconnect obtains the current run status and bootstrap proposal list rather
than assuming every old text event remains available.
