import type { Revision } from "../../shared/index.ts"
import type { LibraryRevision, SongId } from "../../shared/library.ts"
import type { LibraryCommand, NewSong } from "../../shared/library-commands.ts"
import { libraryApi } from "../api/library-client.ts"
import {
  audioInputAtRevisions,
  libraryCommandAtRevisions,
  newSongAtRevisions,
} from "./library-workflow.ts"
import type { LibraryMutationRun } from "./useLibraryMutationRunner.ts"

export type PendingLibrarySwitch =
  | { readonly kind: "command"; readonly command: LibraryCommand }
  | { readonly kind: "new_song"; readonly input: NewSong; readonly audio?: File }
  | { readonly kind: "replace_audio"; readonly songId: SongId; readonly file: File }

type LibrarySwitchRunnerInput = {
  readonly csrfToken: string
  readonly runMutation: (run: LibraryMutationRun) => Promise<void>
}

export function useLibrarySwitchRunner(input: LibrarySwitchRunnerInput) {
  return async (
    action: PendingLibrarySwitch,
    revision: Revision,
    libraryRevision: LibraryRevision,
  ): Promise<void> => {
    switch (action.kind) {
      case "command":
        await input.runMutation({
          label: "Updating library",
          startingRevision: revision,
          policy: "replace_document",
          operation: () =>
            libraryApi.command(
              input.csrfToken,
              libraryCommandAtRevisions(action.command, {
                documentRevision: revision,
                libraryRevision,
              }),
            ),
        })
        return
      case "new_song":
        await input.runMutation({
          label: "Creating song",
          startingRevision: revision,
          policy: "replace_document",
          operation: () =>
            libraryApi.newSong(
              input.csrfToken,
              newSongAtRevisions(action.input, {
                documentRevision: revision,
                libraryRevision,
              }),
              action.audio,
            ),
        })
        return
      case "replace_audio":
        await input.runMutation({
          label: "Replacing song audio",
          startingRevision: revision,
          policy: "replace_document",
          operation: () =>
            libraryApi.replaceSongAudio(
              input.csrfToken,
              action.songId,
              audioInputAtRevisions({ documentRevision: revision, libraryRevision }),
              action.file,
            ),
        })
    }
  }
}
