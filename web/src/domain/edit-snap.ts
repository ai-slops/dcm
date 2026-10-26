import type { NativeChart } from "../../shared/index.ts"
import { findPanelDemand, type PanelIndex } from "./editor.ts"

export class QuantizationConflictError extends Error {
  override readonly name = "QuantizationConflictError"
  constructor(readonly tick: number) {
    super(
      `Quantized target tick ${tick} is occupied. Select that note directly or choose a finer edit grid.`,
    )
  }
}

export function snapPlacementTick(tick: number, quantize: number, spanTicks: number): number {
  return Math.floor(Math.min(Math.max(tick, 0), spanTicks - 1) / quantize) * quantize
}

export function quantizedPlacementTick(
  chart: NativeChart,
  point: { readonly tick: number; readonly panel: PanelIndex },
  quantize: number,
): number {
  const target = snapPlacementTick(point.tick, quantize, chart.span_ticks)
  if (target !== point.tick && findPanelDemand(chart, target, point.panel) !== undefined) {
    throw new QuantizationConflictError(target)
  }
  return target
}
