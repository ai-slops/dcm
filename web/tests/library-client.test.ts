import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadDemo } from "../server/demo.ts"
import { migrateLegacyChart } from "../server/library/legacy-beat-migration.ts"
import { LibrarySnapshotSchema, UcsCatalogResultSchema } from "../shared/library.ts"
import { NewSongSchema } from "../shared/library-commands.ts"
import { repoRoot } from "./support/paths.ts"

const httpMock = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

vi.mock("../src/api/http.ts", () => ({ http: httpMock }))

import { libraryApi } from "../src/api/library-client.ts"

const songId = "11111111-1111-4111-8111-111111111111"
const chartId = "22222222-2222-4222-8222-222222222222"

function snapshotFixture() {
  return LibrarySnapshotSchema.parse({
    revision: 4,
    active_chart_id: chartId,
    songs: [
      {
        id: songId,
        title: "Nemonemo",
        artist: "Yena",
        audio: { format: "mp3", byte_length: 1024, sha256: "a".repeat(64) },
      },
    ],
    charts: [
      {
        id: chartId,
        song_id: songId,
        name: "Single 18",
        mode: "Single",
        note_count: 10,
        hold_count: 1,
        duration: { numerator: 16, denominator: 1 },
        chart_artist: "Stepper",
      },
    ],
    archives: [],
  })
}

describe("libraryApi", () => {
  beforeEach(() => vi.clearAllMocks())

  it("parses the library snapshot from the canonical list route", async () => {
    // Given
    const snapshot = snapshotFixture()
    httpMock.get.mockResolvedValue(new Response(JSON.stringify(snapshot)))

    // When
    const result = await libraryApi.list()

    // Then
    expect(result).toEqual(snapshot)
    expect(httpMock.get).toHaveBeenCalledWith("/api/v1/library")
  })

  it("sends new-song input and optional audio as multipart data", async () => {
    // Given
    const demo = await loadDemo(repoRoot)
    const snapshot = snapshotFixture()
    httpMock.post.mockResolvedValue(
      new Response(
        JSON.stringify({
          document: {
            revision: demo.document.revision,
            project: migrateLegacyChart(demo.document.project),
          },
          library: snapshot,
        }),
      ),
    )
    const input = NewSongSchema.parse({
      library_revision: snapshot.revision,
      base_revision: demo.document.revision,
      title: "Nemonemo",
      artist: "Yena",
      chart_name: "Blank",
      mode: "Double",
      bpm: 138,
      beats: 128,
    })
    const audio = new File(["audio"], "nemonemo.mp3", { type: "audio/mpeg" })

    // When
    await libraryApi.newSong("csrf-token", input, audio)

    // Then
    const call = httpMock.post.mock.calls[0]
    expect(call?.[0]).toBe("/api/v1/library/songs")
    expect(call?.[1]?.headers).toEqual({ "x-csrf-token": "csrf-token" })
    const body = call?.[1]?.body
    expect(body).toBeInstanceOf(FormData)
    if (!(body instanceof FormData)) throw new TypeError("Expected multipart form data")
    expect(body.get("input")).toBe(JSON.stringify(input))
    expect(body.get("audio")).toBe(audio)
  })

  it("uses encoded identifiers for chart and binary asset routes", async () => {
    // Given
    const blob = new Blob(["zip"], { type: "application/zip" })
    httpMock.get.mockResolvedValue(new Response(blob))

    // When
    const parsedSongId = snapshotFixture().songs[0]?.id
    if (parsedSongId === undefined) throw new TypeError("Expected fixture song")
    const result = await libraryApi.songZip(parsedSongId)

    // Then
    expect(await result.text()).toBe("zip")
    expect(httpMock.get).toHaveBeenCalledWith(`/api/v1/library/songs/${songId}/export`)
  })

  it("encodes metadata catalog queries and parses public UCS results", async () => {
    // Given
    const catalog = UcsCatalogResultSchema.parse({
      query: "nemonemo",
      count: 1,
      items: [{ code: "CS839", title: "Nemonemo", artist: "Yena", bpm: "138" }],
      source_url: "https://pump-pro.example/catalog",
    })
    httpMock.get.mockResolvedValue(new Response(JSON.stringify(catalog)))

    // When
    const result = await libraryApi.catalog("Yena Nemonemo")

    // Then
    expect(result).toEqual(catalog)
    expect(httpMock.get).toHaveBeenCalledWith("/api/v1/library/catalog?query=Yena%20Nemonemo")
  })
})
