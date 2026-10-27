import { StudioError } from "../errors.ts"

export function requiredBase(value: number | undefined): number {
  if (value === undefined)
    throw new StudioError(
      409,
      "base_revision_required",
      "Active chart changes require the document revision",
    )
  return value
}

export function assertNever(value: never): never {
  throw new StudioError(400, "library_command", `Unsupported library command: ${String(value)}`)
}
