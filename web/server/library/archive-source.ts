import type { BeatChartCore } from "../../shared/index.ts"
import type { ArchiveSourceTiming } from "../../shared/library.ts"
import type { UcsArchiveEntry } from "../../src/domain/archive-policy.ts"
import { StudioError } from "../errors.ts"

export function archiveSource(
  chart: UcsArchiveEntry | undefined,
  audio: UcsArchiveEntry,
  imported: BeatChartCore | undefined,
): ArchiveSourceTiming {
  if (chart === undefined || imported === undefined)
    throw new StudioError(500, "archive_import", "Imported archive source is missing")
  return {
    chart_name: chart.name,
    audio_name: audio.name,
    mode: imported.mode,
    timing: imported.timing,
  }
}
