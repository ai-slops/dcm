import type { Revision } from "../../shared/index.ts"
import type { LibraryArchive, LibrarySnapshot, LibrarySong, SongId } from "../../shared/library.ts"
import type { DownloadArchive, LibraryCommand, NewSong } from "../../shared/library-commands.ts"
import { libraryApi } from "../api/library-client.ts"
import { downloadBlob, errorMessage } from "./action-utils.ts"
import { LibraryArchiveManager } from "./LibraryArchiveManager.tsx"
import { LibraryNewSongForm } from "./LibraryNewSongForm.tsx"
import { LibrarySongManager } from "./LibrarySongManager.tsx"
import { Button } from "./primitives.tsx"

export type LibraryContentActions = {
  readonly command: (command: LibraryCommand) => void
  readonly importChart: (input: {
    readonly songId: SongId
    readonly name: string
    readonly file: File
  }) => void
  readonly newSong: (input: NewSong, audio?: File) => void
  readonly replaceAudio: (input: { readonly songId: SongId; readonly file: File }) => void
  readonly mutation: (label: string, operation: () => ReturnType<typeof libraryApi.command>) => void
  readonly setError: (message: string) => void
}

type LibraryDialogContentProps = {
  readonly actions: LibraryContentActions
  readonly busy: boolean
  readonly csrfToken: string
  readonly library: LibrarySnapshot
  readonly revision: Revision
  readonly selectedSongId: SongId | undefined
  readonly onSelectSong: (songId: SongId) => void
  readonly onOpenProjectFiles: () => void
  readonly onOpenNativeTools: () => void
  readonly onOpenUcsTransfer: () => void
}

export function LibraryDialogContent(props: LibraryDialogContentProps) {
  const { actions, library } = props
  return (
    <>
      <nav className="library-shortcuts" aria-label="Library tools">
        <Button disabled={props.busy} onClick={props.onOpenProjectFiles}>
          Chart document
        </Button>
        <Button disabled={props.busy} onClick={props.onOpenNativeTools}>
          Generate and export
        </Button>
        <Button disabled={props.busy} onClick={props.onOpenUcsTransfer}>
          UCS transfer
        </Button>
        <a
          className="button"
          href="/"
          aria-disabled={props.busy}
          tabIndex={props.busy ? -1 : undefined}
          onClick={(event) => {
            if (props.busy) event.preventDefault()
          }}
        >
          Open editor
        </a>
      </nav>
      <LibrarySongManager
        busy={props.busy}
        documentRevision={props.revision}
        library={library}
        selectedSongId={props.selectedSongId}
        onSelectSong={props.onSelectSong}
        onCommand={actions.command}
        onReplaceAudio={actions.replaceAudio}
        onImportChart={actions.importChart}
        onDownloadSong={(song: LibrarySong) =>
          void libraryApi
            .songZip(song.id)
            .then((blob) => downloadBlob(blob, `${song.title}.zip`))
            .catch((caught) => actions.setError(errorMessage(caught)))
        }
      />
      <LibraryNewSongForm
        busy={props.busy}
        libraryRevision={library.revision}
        documentRevision={props.revision}
        onCreate={actions.newSong}
      />
      <LibraryArchiveManager
        busy={props.busy}
        library={library}
        onCommand={actions.command}
        onDownloadSource={(code) =>
          actions.mutation("Downloading public archive", () =>
            libraryApi.downloadArchive(props.csrfToken, {
              library_revision: library.revision,
              code,
            } satisfies DownloadArchive),
          )
        }
        onUpload={(file) =>
          actions.mutation("Uploading archive", () =>
            libraryApi.uploadArchive(props.csrfToken, library.revision, file),
          )
        }
        onDownloadOriginal={(archive: LibraryArchive) =>
          void libraryApi
            .archiveFile(archive.id)
            .then((blob) => downloadBlob(blob, archive.name))
            .catch((caught) => actions.setError(errorMessage(caught)))
        }
        onImport={({ archive, audioName, chartNames, title, artist }) =>
          actions.command({
            type: "import_archive",
            library_revision: library.revision,
            archive_id: archive.id,
            audio_name: audioName,
            chart_names: chartNames,
            title,
            artist,
          })
        }
      />
    </>
  )
}
