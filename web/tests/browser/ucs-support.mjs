import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { BootstrapSchema, CurrentDocumentSchema } from "../../shared/index.ts"

export const repoRoot = fileURLToPath(new URL("../../..", import.meta.url))
export const evidenceRoot = resolve(repoRoot, "web/artifacts/ucs")
export const SINGLE_UCS_FIXTURE = [
  ":Format=1",
  ":Mode=Single",
  ":BPM=120",
  ":Delay=125",
  ":Beat=4",
  ":Split=4",
  "M.X..",
  "H....",
  "H....",
  "H....",
  ":BPM=150",
  ":Delay=0",
  ":Beat=4",
  ":Split=4",
  "H....",
  "H....",
  "W...X",
  ".....",
].join("\r\n")
mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 })

export function saveRecovery(project, audio) {
  const directory = resolve(evidenceRoot, `recovery-${randomUUID()}`)
  mkdirSync(directory, { mode: 0o700 })
  writeFileSync(resolve(directory, "project.json"), JSON.stringify(project), { mode: 0o600 })
  writeFileSync(resolve(directory, `music.${project.audio_asset.format}`), audio, { mode: 0o600 })
  return directory
}

export function browserConfiguration() {
  const statePath = resolve(
    process.env.STUDIO_BROWSER_STATE_FILE ?? resolve(repoRoot, ".studio-dev/state.json"),
  )
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : undefined
  const source = process.env.STUDIO_BROWSER_URL ?? state?.origin
  if (source === undefined) throw new Error("Start the managed preview or set STUDIO_BROWSER_URL")
  const url = URL.parse(source)
  if (url === null || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Browser URL must be an absolute HTTP or HTTPS URL")
  }
  if (url.username !== "" || url.password !== "" || url.search !== "") {
    throw new Error("Use a browser URL without credentials or query parameters")
  }
  const passwordFile = resolve(dirname(statePath), "password")
  const stateOrigin =
    typeof state?.origin === "string" ? URL.parse(state.origin)?.origin : undefined
  const authenticated = state !== undefined && !state.local && url.origin === stateOrigin
  const credential = authenticated ? readFileSync(passwordFile, "utf8").trim() : ""
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    (existsSync("/usr/lib/chromium/chrome") ? "/usr/lib/chromium/chrome" : undefined)
  return {
    url: url.toString(),
    launch: {
      ...(executablePath === undefined ? {} : { executablePath }),
      headless: true,
      args: ["--no-sandbox"],
    },
    context: {
      viewport: { width: 1440, height: 1000 },
      ...(authenticated
        ? { httpCredentials: { username: "studio", password: credential.slice("studio:".length) } }
        : {}),
    },
  }
}

export async function bootstrap(context, url) {
  const response = await context.request.get(new URL("/api/v1/bootstrap", url).toString())
  assert.equal(response.status(), 200)
  return BootstrapSchema.parse(await response.json())
}

export async function importProject(context, url, input) {
  const response = await context.request.post(new URL("/api/v1/imports", url).toString(), {
    headers: { "x-csrf-token": input.csrfToken },
    multipart: {
      base_revision: String(input.revision),
      project: JSON.stringify(input.project),
      audio: {
        name: `music.${input.project.audio_asset.format}`,
        mimeType: "application/octet-stream",
        buffer: input.audio,
      },
    },
  })
  assert.equal(response.status(), 200, await response.text())
  return CurrentDocumentSchema.parse(await response.json())
}

export function extendDemoAudio(source) {
  const bytes = Buffer.from(source)
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE")
  assert.equal(bytes.toString("ascii", 36, 40), "data")
  const data = bytes.subarray(44)
  const result = Buffer.concat([bytes.subarray(0, 44), ...Array.from({ length: 6 }, () => data)])
  result.writeUInt32LE(result.byteLength - 8, 4)
  result.writeUInt32LE(result.byteLength - 44, 40)
  return result
}

export async function ownedMutation(page, path, action) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      ["POST", "PUT"].includes(response.request().method()),
  )
  await action()
  const response = await pending
  assert.equal(response.status(), 200, await response.text())
  return CurrentDocumentSchema.parse(await response.json())
}

export async function importUcsThroughUi(page, path) {
  await page.getByRole("button", { name: "UCS transfer", exact: true }).click()
  await page.getByLabel("UCS chart", { exact: true }).setInputFiles(path)
  return ownedMutation(page, "/api/v1/ucs/import", () =>
    page.getByRole("button", { name: "Import UCS", exact: true }).click(),
  )
}

export async function downloadUcs(page, path, mode = "Double") {
  await page.getByRole("button", { name: "UCS transfer", exact: true }).click()
  await page.getByRole("radio", { name: mode, exact: true }).check()
  const pending = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download UCS", exact: true }).click()
  const download = await pending
  assert.equal(await download.failure(), null)
  await download.saveAs(path)
  await page.getByRole("button", { name: "Close", exact: true }).click()
}
