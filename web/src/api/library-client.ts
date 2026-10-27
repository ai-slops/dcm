import {
  type ArchiveId,
  type ChartId,
  type LibraryChartDocument,
  LibraryChartDocumentSchema,
  type LibraryMutation,
  LibraryMutationSchema,
  type LibrarySnapshot,
  LibrarySnapshotSchema,
  type SongId,
  type UcsCatalogResult,
  UcsCatalogResultSchema,
} from "../../shared/library.ts"
import type {
  DownloadArchive,
  ImportChart,
  LibraryCommand,
  NewSong,
} from "../../shared/library-commands.ts"
import { mutationHeaders, requestBlob, typedRequest } from "./client.ts"
import { http } from "./http.ts"

const libraryRoot = "/api/v1/library"

function inputForm(input: object): FormData {
  const body = new FormData()
  body.set("input", JSON.stringify(input))
  return body
}

export const libraryApi = {
  list(): Promise<LibrarySnapshot> {
    return typedRequest(http.get(libraryRoot), LibrarySnapshotSchema)
  },
  catalog(query: string): Promise<UcsCatalogResult> {
    return typedRequest(
      http.get(`${libraryRoot}/catalog?query=${encodeURIComponent(query)}`),
      UcsCatalogResultSchema,
    )
  },
  command(csrfToken: string, input: LibraryCommand): Promise<LibraryMutation> {
    return typedRequest(
      http.post(`${libraryRoot}/actions`, { headers: mutationHeaders(csrfToken), json: input }),
      LibraryMutationSchema,
    )
  },
  newSong(csrfToken: string, input: NewSong, audio?: File): Promise<LibraryMutation> {
    const body = inputForm(input)
    if (audio !== undefined) body.set("audio", audio)
    return typedRequest(
      http.post(`${libraryRoot}/songs`, { headers: mutationHeaders(csrfToken), body }),
      LibraryMutationSchema,
    )
  },
  replaceSongAudio(
    csrfToken: string,
    songId: SongId,
    input: { readonly library_revision: number; readonly base_revision?: number },
    audio: File,
  ): Promise<LibraryMutation> {
    const body = inputForm(input)
    body.set("audio", audio)
    return typedRequest(
      http.put(`${libraryRoot}/songs/${encodeURIComponent(songId)}/audio`, {
        headers: mutationHeaders(csrfToken),
        body,
      }),
      LibraryMutationSchema,
    )
  },
  importChart(
    csrfToken: string,
    songId: SongId,
    input: ImportChart,
    chartFile: File,
  ): Promise<LibraryMutation> {
    const body = inputForm(input)
    body.set("chart", chartFile)
    return typedRequest(
      http.post(`${libraryRoot}/songs/${encodeURIComponent(songId)}/charts`, {
        headers: mutationHeaders(csrfToken),
        body,
      }),
      LibraryMutationSchema,
    )
  },
  uploadArchive(csrfToken: string, libraryRevision: number, file: File): Promise<LibraryMutation> {
    const body = new FormData()
    body.set("library_revision", String(libraryRevision))
    body.set("file", file)
    return typedRequest(
      http.post(`${libraryRoot}/archives`, { headers: mutationHeaders(csrfToken), body }),
      LibraryMutationSchema,
    )
  },
  downloadArchive(csrfToken: string, input: DownloadArchive): Promise<LibraryMutation> {
    return typedRequest(
      http.post(`${libraryRoot}/archives/download`, {
        headers: mutationHeaders(csrfToken),
        json: input,
      }),
      LibraryMutationSchema,
    )
  },
  chart(id: ChartId): Promise<LibraryChartDocument> {
    return typedRequest(
      http.get(`${libraryRoot}/charts/${encodeURIComponent(id)}`),
      LibraryChartDocumentSchema,
    )
  },
  songAudio(songId: SongId): Promise<Blob> {
    return requestBlob(http.get(`${libraryRoot}/songs/${encodeURIComponent(songId)}/audio`))
  },
  songZip(songId: SongId): Promise<Blob> {
    return requestBlob(http.get(`${libraryRoot}/songs/${encodeURIComponent(songId)}/export`))
  },
  archiveFile(id: ArchiveId): Promise<Blob> {
    return requestBlob(http.get(`${libraryRoot}/archives/${encodeURIComponent(id)}/file`))
  },
}
