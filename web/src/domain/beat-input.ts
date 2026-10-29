import { z } from "zod"

import { type Beat, BeatSchema } from "../../shared/beat.ts"

const BeatDraftSchema = z.string().regex(/^\d+(?:\/\d+)?$/)

export type BeatDraftResult =
  | { readonly kind: "success"; readonly beat: Beat }
  | { readonly kind: "error"; readonly message: string }

export function parseBeatDraft(draft: string): BeatDraftResult {
  const parsed = BeatDraftSchema.safeParse(draft.trim())
  if (!parsed.success)
    return {
      kind: "error",
      message: "Enter a beat as a whole number or fraction such as 7/4",
    }
  const [numeratorDraft, denominatorDraft = "1"] = parsed.data.split("/")
  const numerator = Number(numeratorDraft)
  const denominator = Number(denominatorDraft)
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0)
    return {
      kind: "error",
      message: "Enter a beat as a whole number or fraction such as 7/4",
    }
  const divisor = greatestCommonDivisor(numerator, denominator)
  return {
    kind: "success",
    beat: BeatSchema.parse({ numerator: numerator / divisor, denominator: denominator / divisor }),
  }
}

export function formatBeat(beat: Beat): string {
  return beat.denominator === 1 ? String(beat.numerator) : `${beat.numerator}/${beat.denominator}`
}

function greatestCommonDivisor(left: number, right: number): number {
  let dividend = left
  let divisor = right
  while (divisor !== 0) [dividend, divisor] = [divisor, dividend % divisor]
  return dividend
}
