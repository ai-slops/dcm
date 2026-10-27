import { useState } from "react"
import type { CurrentDocument, Revision } from "../../shared/index.ts"
import type { LibraryCommand } from "../../shared/library-commands.ts"
import { libraryApi } from "../api/library-client.ts"
import { ActionDialog } from "./ActionDialog.tsx"
import { errorMessage } from "./action-utils.ts"
import { type LibraryContentActions, LibraryDialogContent } from "./LibraryDialogContent.tsx"
import { LibraryDirtyGuard } from "./LibraryDirtyGuard.tsx"
import {
  guardedSwitchDocument,
  libraryCloseEffect,
  libraryCommandNeedsGuard,
  libraryDialogSurface,
} from "./library-workflow.ts"
import type { SaveResult } from "./studio-types.ts"
import { useLibraryMutationRunner } from "./useLibraryMutationRunner.ts"
import { useLibrarySnapshot } from "./useLibrarySnapshot.ts"
import { type PendingLibrarySwitch, useLibrarySwitchRunner } from "./useLibrarySwitchRunner.ts"

type LibraryDialogProps = {
  readonly csrfToken: string
  readonly dirty: boolean
  readonly open: boolean
  readonly revision: Revision
  readonly onClose: () => void
  readonly onDocument: (document: CurrentDocument) => void
  readonly onOpenProjectFiles: () => void
  readonly onOpenNativeTools: () => void
  readonly onOpenUcsTransfer: () => void
  readonly onSave: () => Promise<SaveResult | null>
  readonly onStatus: (status: string) => void
}

export function LibraryDialog(props: LibraryDialogProps) {
  const {
    library,
    acceptLibrary,
    getLibrary,
    selectedSongId,
    setSelectedSongId,
    error,
    setError,
    loading,
  } = useLibrarySnapshot(props.open)
  const [busy, setBusy] = useState(false)
  const [operationStatus, setOperationStatus] = useState("")
  const [pending, setPending] = useState<PendingLibrarySwitch | null>(null)
  const runMutation = useLibraryMutationRunner({
    onDocument: props.onDocument,
    onStatus: props.onStatus,
    setBusy,
    setError,
    acceptLibrary,
    setOperationStatus,
  })
  const executePending = useLibrarySwitchRunner({ csrfToken: props.csrfToken, runMutation })

  function requestSwitch(action: PendingLibrarySwitch): void {
    if (props.dirty) setPending(action)
    else if (library !== null) void executePending(action, props.revision, library.revision)
  }

  async function saveAndContinue(action: PendingLibrarySwitch): Promise<void> {
    setBusy(true)
    setError("")
    setOperationStatus("Saving current chart")
    try {
      const result = await props.onSave()
      const document = guardedSwitchDocument(result)
      if (document === null) {
        setError(
          result?.kind === "saved_older"
            ? "A newer browser draft exists. It was preserved, and the library action was canceled."
            : "Save failed. The current browser draft was preserved.",
        )
        setOperationStatus("")
        return
      }
      setOperationStatus("Refreshing library")
      const refreshedLibrary = await libraryApi.list()
      acceptLibrary(refreshedLibrary)
      const currentLibrary = getLibrary()
      if (currentLibrary === null) return
      setPending(null)
      await executePending(action, document.revision, currentLibrary.revision)
    } catch (caught) {
      const message = errorMessage(caught)
      setError(message)
      setOperationStatus("")
      props.onStatus(message)
    } finally {
      setBusy(false)
    }
  }

  function runCommand(command: LibraryCommand): void {
    if (libraryCommandNeedsGuard(command)) requestSwitch({ kind: "command", command })
    else
      void runMutation({
        label: "Updating library",
        startingRevision: props.revision,
        policy: "library_only",
        operation: () => libraryApi.command(props.csrfToken, command),
      })
  }

  function closeOrCancelPending(): void {
    if (libraryCloseEffect(pending !== null) === "clear_pending") setPending(null)
    else props.onClose()
  }

  const surface = libraryDialogSurface(pending !== null, loading, library !== null)

  return (
    <ActionDialog
      open={props.open}
      busy={busy}
      title="Songs and charts"
      onClose={closeOrCancelPending}
    >
      <div className="action-dialog__body library-dialog">
        {surface === "guard" && pending !== null ? (
          <LibraryDirtyGuard
            busy={busy}
            onSave={() => void saveAndContinue(pending)}
            onDiscard={() => {
              const action = pending
              setPending(null)
              if (library !== null) void executePending(action, props.revision, library.revision)
            }}
            onCancel={() => setPending(null)}
          />
        ) : surface === "loading" || library === null ? (
          <p className="status-copy" role="status">
            {error === "" ? "Loading saved songs..." : error}
          </p>
        ) : (
          <LibraryDialogContent
            busy={busy}
            csrfToken={props.csrfToken}
            library={library}
            revision={props.revision}
            selectedSongId={selectedSongId}
            onSelectSong={setSelectedSongId}
            onOpenProjectFiles={props.onOpenProjectFiles}
            onOpenNativeTools={props.onOpenNativeTools}
            onOpenUcsTransfer={props.onOpenUcsTransfer}
            actions={
              {
                command: runCommand,
                replaceAudio: ({ songId, file }) => {
                  const activeSongId = library.charts.find(
                    (chart) => chart.id === library.active_chart_id,
                  )?.song_id
                  if (activeSongId === songId) {
                    requestSwitch({ kind: "replace_audio", songId, file })
                    return
                  }
                  void runMutation({
                    label: "Replacing song audio",
                    startingRevision: props.revision,
                    policy: "library_only",
                    operation: () =>
                      libraryApi.replaceSongAudio(
                        props.csrfToken,
                        songId,
                        { library_revision: library.revision },
                        file,
                      ),
                  })
                },
                importChart: ({ songId, name, file }) =>
                  void runMutation({
                    label: "Importing chart",
                    startingRevision: props.revision,
                    policy: "library_only",
                    operation: () =>
                      libraryApi.importChart(
                        props.csrfToken,
                        songId,
                        { library_revision: library.revision, name },
                        file,
                      ),
                  }),
                newSong: (input, audio) =>
                  requestSwitch({
                    kind: "new_song",
                    input,
                    ...(audio === undefined ? {} : { audio }),
                  }),
                mutation: (label, operation) =>
                  void runMutation({
                    label,
                    startingRevision: props.revision,
                    policy: "library_only",
                    operation,
                  }),
                setError,
              } satisfies LibraryContentActions
            }
          />
        )}
        {error === "" ? null : (
          <p className="operation-result operation-result--error" role="alert">
            {error}
          </p>
        )}
        {operationStatus === "" ? null : (
          <p className="status-copy" role="status">
            {operationStatus}
          </p>
        )}
      </div>
    </ActionDialog>
  )
}
