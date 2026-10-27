import type { NativeChart } from "../shared/native.ts"
import { assertUcsCellExclusive, UcsCellConflictError } from "../shared/ucs-cells.ts"
import { StudioError } from "./errors.ts"

export function assertEditableChart(chart: NativeChart): void {
  try {
    assertUcsCellExclusive(chart)
  } catch (error) {
    if (error instanceof UcsCellConflictError)
      throw new StudioError(400, "ucs_cell_conflict", error.message)
    throw error
  }
}
