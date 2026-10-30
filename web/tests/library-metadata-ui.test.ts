import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { RevisionSchema } from "../shared/index.ts"
import { LibraryRevisionSchema, LibrarySnapshotSchema } from "../shared/library.ts"
import { LibraryNewSongForm } from "../src/ui/LibraryNewSongForm.tsx"
import { LibrarySongManager } from "../src/ui/LibrarySongManager.tsx"

it("creates an audio entry without collecting song or artist facts", () => {
  const markup = renderToStaticMarkup(
    createElement(LibraryNewSongForm, {
      busy: false,
      libraryRevision: LibraryRevisionSchema.parse(0),
      documentRevision: RevisionSchema.parse(0),
      onCreate: () => undefined,
    }),
  )

  expect(markup).toContain("Audio label")
  expect(markup).not.toContain("Artist")
  expect(markup).not.toContain("Song title")
})

it("keeps saved metadata out of audio management controls and labels", () => {
  const library = LibrarySnapshotSchema.parse({
    revision: 0,
    active_chart_id: "00000000-0000-4000-8000-000000000001",
    songs: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        title: "music.mp3",
        artist: "Hidden artist",
        audio: { format: "mp3", byte_length: 100, sha256: "0".repeat(64) },
      },
    ],
    charts: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        song_id: "00000000-0000-4000-8000-000000000002",
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
  const markup = renderToStaticMarkup(
    createElement(LibrarySongManager, {
      busy: false,
      documentRevision: RevisionSchema.parse(0),
      library,
      selectedSongId: library.songs[0]?.id,
      onSelectSong: () => undefined,
      onCommand: () => undefined,
      onReplaceAudio: () => undefined,
      onImportChart: () => undefined,
      onDownloadSong: () => undefined,
    }),
  )

  expect(markup).toContain("Audio label")
  expect(markup).not.toContain("Hidden artist")
  expect(markup).not.toContain("Artist")
  expect(markup).toContain("Replace song audio")
})
