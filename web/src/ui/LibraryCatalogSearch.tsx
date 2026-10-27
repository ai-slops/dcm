import { Download, Search } from "lucide-react"
import { useState } from "react"

import type { UcsCatalogResult } from "../../shared/library.ts"
import { libraryApi } from "../api/library-client.ts"
import { errorMessage } from "./action-utils.ts"
import { Button } from "./primitives.tsx"

type LibraryCatalogResultsProps = {
  readonly busy: boolean
  readonly result: UcsCatalogResult
  readonly onDownload: (code: string) => void
}

export function LibraryCatalogResults(props: LibraryCatalogResultsProps) {
  return (
    <div className="library-catalog-results">
      <p className="status-copy">
        {props.result.count} public result(s). Metadata only; searching does not change the current
        chart.
      </p>
      <ul aria-label="Public Pump Pro UCS results">
        {props.result.items.map((item) => (
          <li key={item.code}>
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.artist} · {item.bpm} BPM · {item.code}
              </small>
            </span>
            <Button
              icon={<Download size={15} />}
              disabled={props.busy}
              onClick={() => props.onDownload(item.code)}
            >
              Download
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

type LibraryCatalogSearchProps = {
  readonly busy: boolean
  readonly onDownload: (code: string) => void
}

export function LibraryCatalogSearch(props: LibraryCatalogSearchProps) {
  const [query, setQuery] = useState("Nemonemo Yena")
  const [result, setResult] = useState<UcsCatalogResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")

  async function search(): Promise<void> {
    setSearching(true)
    setError("")
    try {
      setResult(await libraryApi.catalog(query))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="library-catalog-search">
      <form
        className="library-inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <label>
          Search public songs
          <input
            required
            maxLength={100}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          icon={<Search size={15} />}
          disabled={props.busy || searching || query.trim() === ""}
        >
          {searching ? "Searching" : "Search Pump Pro"}
        </Button>
      </form>
      {error === "" ? null : (
        <p className="operation-result operation-result--error" role="alert">
          {error}
        </p>
      )}
      {result === null ? null : (
        <LibraryCatalogResults busy={props.busy} result={result} onDownload={props.onDownload} />
      )}
    </div>
  )
}
