import type { LibrarySnapshot, SongId } from "../../shared/library.ts"
import { Badge } from "./primitives.tsx"

type LibrarySongListProps = {
  readonly activeSongId: SongId | undefined
  readonly library: LibrarySnapshot
  readonly selectedSongId: SongId | undefined
  readonly onSelect: (songId: SongId) => void
}

export function LibrarySongList(props: LibrarySongListProps) {
  return (
    <ul className="library-song-list" aria-label="Saved songs">
      {props.library.songs.map((song) => (
        <li key={song.id}>
          <button
            type="button"
            className="library-song-row"
            data-song-id={song.id}
            aria-pressed={song.id === props.selectedSongId}
            onClick={() => props.onSelect(song.id)}
          >
            <span>
              <strong>{song.title}</strong>
              <small>
                {song.audio.format.toUpperCase()} · {song.audio.byte_length.toLocaleString()} bytes
              </small>
            </span>
            {props.activeSongId === song.id ? <Badge tone="success">Active</Badge> : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
