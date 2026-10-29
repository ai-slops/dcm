import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { RevisionSchema } from "../shared/index.ts"
import { LibrarySnapshotSchema } from "../shared/library.ts"
import { LibraryDialogContent } from "../src/ui/LibraryDialogContent.tsx"

describe("library dialog content", () => {
  it("shows active song and chart controls with public-source disclosure", () => {
    // Given
    const library = LibrarySnapshotSchema.parse({
      revision: 2,
      active_chart_id: "22222222-2222-4222-8222-222222222222",
      songs: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Nemonemo",
          artist: "Yena",
          audio: { format: "mp3", byte_length: 1024, sha256: "a".repeat(64) },
        },
      ],
      charts: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          song_id: "11111111-1111-4111-8111-111111111111",
          name: "Single 18",
          mode: "Single",
          note_count: 12,
          hold_count: 1,
          duration: { numerator: 16, denominator: 1 },
          chart_artist: "Stepper",
        },
      ],
      archives: [],
    })
    const songId = library.songs[0]?.id
    if (songId === undefined) throw new TypeError("Expected fixture song")

    // When
    const markup = renderToStaticMarkup(
      createElement(LibraryDialogContent, {
        actions: {
          command: () => undefined,
          importChart: () => undefined,
          mutation: () => undefined,
          newSong: () => undefined,
          replaceAudio: () => undefined,
          setError: () => undefined,
        },
        busy: false,
        csrfToken: "csrf",
        library,
        revision: RevisionSchema.parse(3),
        selectedSongId: songId,
        onSelectSong: () => undefined,
        onOpenProjectFiles: () => undefined,
        onOpenNativeTools: () => undefined,
        onOpenUcsTransfer: () => undefined,
      }),
    )

    // Then
    expect(markup).toContain("Nemonemo")
    expect(markup).toContain("Single 18")
    expect(markup).toContain("Active")
    expect(markup).toContain("Download public Pump Pro archive")
    expect(markup).toContain('href="/previews"')
  })

  it("disables every shortcut while a library operation is busy", () => {
    // Given
    const library = LibrarySnapshotSchema.parse({
      revision: 2,
      active_chart_id: "22222222-2222-4222-8222-222222222222",
      songs: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Busy",
          artist: "Fixture",
          audio: { format: "wav", byte_length: 44, sha256: "a".repeat(64) },
        },
      ],
      charts: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          song_id: "11111111-1111-4111-8111-111111111111",
          name: "Chart",
          mode: "Double",
          note_count: 0,
          hold_count: 0,
          duration: null,
          chart_artist: null,
        },
      ],
      archives: [],
    })

    // When
    const markup = renderToStaticMarkup(
      createElement(LibraryDialogContent, {
        actions: {
          command: () => undefined,
          importChart: () => undefined,
          mutation: () => undefined,
          newSong: () => undefined,
          replaceAudio: () => undefined,
          setError: () => undefined,
        },
        busy: true,
        csrfToken: "csrf",
        library,
        revision: RevisionSchema.parse(3),
        selectedSongId: library.songs[0]?.id,
        onSelectSong: () => undefined,
        onOpenProjectFiles: () => undefined,
        onOpenNativeTools: () => undefined,
        onOpenUcsTransfer: () => undefined,
      }),
    )

    // Then
    expect(markup.match(/<button[^>]*disabled=""/g)?.length).toBeGreaterThanOrEqual(3)
    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('class="button library-previews-link"')
  })
})
