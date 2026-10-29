import { expect, it } from "vitest"
import { LibrarySnapshotSchema } from "../shared/library.ts"
import { DownloadArchiveSchema, LibraryCommandSchema } from "../shared/library-commands.ts"

const chartId = "1b01d555-6087-4ab2-8767-5dcb1efb87a1"
const songId = "2b01d555-6087-4ab2-8767-5dcb1efb87a1"

it("requires both document and library guards for active selection", () => {
  const input = { type: "open_chart", library_revision: 0, chart_id: chartId }
  expect(LibraryCommandSchema.safeParse(input).success).toBe(false)
  expect(LibraryCommandSchema.safeParse({ ...input, base_revision: 1 }).success).toBe(true)
})

it("allows metadata rename without resubmitting a browser project", () => {
  const input = { type: "rename_chart", library_revision: 0, chart_id: chartId, name: "새 채보" }
  expect(LibraryCommandSchema.safeParse(input).success).toBe(true)
  expect(LibraryCommandSchema.safeParse({ ...input, project: {} }).success).toBe(false)
})

it("does not accept arbitrary URLs as a package-download request", () => {
  expect(DownloadArchiveSchema.safeParse({ library_revision: 0, code: "CS839" }).success).toBe(true)
  const privateUrl = { library_revision: 0, code: "https://127.0.0.1/private" }
  expect(DownloadArchiveSchema.safeParse(privateUrl).success).toBe(false)
})

it("represents a metadata-only library without embedding native project payloads", () => {
  const snapshot = LibrarySnapshotSchema.parse({
    revision: 0,
    active_chart_id: chartId,
    songs: [
      {
        id: songId,
        title: "Song",
        artist: "Artist",
        audio: { format: "mp3", byte_length: 100, sha256: "a".repeat(64) },
      },
    ],
    charts: [
      {
        id: chartId,
        song_id: songId,
        name: "Chart",
        mode: "Double",
        note_count: 0,
        hold_count: 0,
        duration: { numerator: 4, denominator: 1 },
        chart_artist: null,
      },
    ],
    archives: [],
  })
  expect(Object.keys(snapshot.charts[0] ?? {})).not.toContain("project")
})
