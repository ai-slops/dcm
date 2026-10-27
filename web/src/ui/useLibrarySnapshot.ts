import { useCallback, useEffect, useRef, useState } from "react"

import type { LibrarySnapshot, SongId } from "../../shared/library.ts"
import { libraryApi } from "../api/library-client.ts"
import { errorMessage } from "./action-utils.ts"
import {
  acceptMonotonicLibrarySnapshot,
  type LibrarySelectionPreference,
  reconcileSelectedSongId,
} from "./library-workflow.ts"

export function useLibrarySnapshot(open: boolean) {
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null)
  const [selectedSongId, setSelectedSongId] = useState<SongId | undefined>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const libraryRef = useRef<LibrarySnapshot | null>(null)

  const acceptLibrary = useCallback(
    (snapshot: LibrarySnapshot, preference: LibrarySelectionPreference = "retain"): boolean => {
      const accepted = acceptMonotonicLibrarySnapshot(libraryRef.current, snapshot)
      if (accepted !== snapshot) return false
      libraryRef.current = snapshot
      setLibrary(snapshot)
      setSelectedSongId((current) => reconcileSelectedSongId(snapshot, current, preference))
      return true
    },
    [],
  )

  const getLibrary = useCallback(() => libraryRef.current, [])

  useEffect(() => {
    if (!open) return
    let active = true
    setError("")
    setLoading(true)
    void libraryApi
      .list()
      .then((snapshot) => {
        if (!active) return
        acceptLibrary(snapshot)
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [acceptLibrary, open])

  return {
    library,
    acceptLibrary,
    getLibrary,
    selectedSongId,
    setSelectedSongId,
    error,
    setError,
    loading,
  }
}
