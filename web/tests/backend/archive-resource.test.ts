import { zipSync } from "fflate"
import { expect, it } from "vitest"

import {
  archiveResourceUsage,
  parseArchiveInWorker,
} from "../../server/library/archive-resource.ts"

function expandingArchive(): Uint8Array {
  return zipSync({
    "chart.ucs": Uint8Array.of(1),
    "music.wav": new Uint8Array(32 * 1024 * 1024),
  })
}

it("parses expanding archives off the server event loop", async () => {
  // Given
  const archive = expandingArchive()
  let turns = 0
  let running = true
  const tick = () => {
    turns += 1
    if (running) setImmediate(tick)
  }
  setImmediate(tick)

  // When
  await parseArchiveInWorker(archive, "expanding.zip")
  running = false

  // Then
  expect(turns).toBeGreaterThan(10)
})

it("runs one shared archive decoder at a time", async () => {
  // Given
  const archive = expandingArchive()

  // When
  const parses = [
    parseArchiveInWorker(archive, "one.zip"),
    parseArchiveInWorker(archive, "two.zip"),
    parseArchiveInWorker(archive, "three.zip"),
  ]

  // Then
  expect(archiveResourceUsage()).toEqual({ active: 1, queued: 2 })
  await Promise.all(parses)
  expect(archiveResourceUsage()).toEqual({ active: 0, queued: 0 })
})

it("rejects excess archive jobs instead of retaining an unbounded input queue", async () => {
  // Given
  const archive = zipSync({ "chart.ucs": Uint8Array.of(1), "music.wav": Uint8Array.of(2) })
  const accepted = ["one", "two", "three"].map((name) => parseArchiveInWorker(archive, name))

  // When
  const excess = parseArchiveInWorker(archive, "excess")

  // Then
  await expect(excess).rejects.toMatchObject({ code: "archive_busy", status: 503 })
  await Promise.all(accepted)
})
