export const laneLabels = [
  "L DL",
  "L UL",
  "L C",
  "L UR",
  "L DR",
  "R DL",
  "R UL",
  "R C",
  "R UR",
  "R DR",
] as const

export type EditorTool = "tap" | "hold" | "select" | "erase"

export type SaveResult =
  | { readonly kind: "saved_current"; readonly document: CurrentDocument }
  | { readonly kind: "saved_older"; readonly document: CurrentDocument }

import type { CurrentDocument } from "../../shared/index.ts"
