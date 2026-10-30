import {
  type Beat,
  type BeatChartCore,
  BeatChartCoreSchema,
  type BeatTiming,
  beatFromTicks,
} from "./beat.ts"
import {
  type NativeDurationUnresolved,
  type NativeGridUnsupported,
  type NativeLimitUnsupported,
  nativeTicksPerBeatFor,
} from "./beat-native-capability.ts"
import { type BeatOutputContext, resolveChartOutputTiming } from "./beat-output.ts"
import {
  canonicalizeChart,
  type NativeChart,
  type NativeMusic,
  NativeMusicSchema,
} from "./native.ts"

export type BeatNativeProjection =
  | { readonly kind: "supported"; readonly chart: NativeChart; readonly music: NativeMusic }
  | {
      readonly kind: "unsupported"
      readonly capability: NativeGridUnsupported | NativeDurationUnresolved | NativeLimitUnsupported
    }

export function projectBeatChartNative(
  input: BeatChartCore,
  audioSha256: readonly number[],
  context: BeatOutputContext = {},
): BeatNativeProjection {
  const source = BeatChartCoreSchema.parse(input)
  const outputTiming = resolveChartOutputTiming(source, context)
  if (outputTiming === null)
    return { kind: "unsupported", capability: { code: "native_duration_unresolved" } }
  const duration = outputTiming.duration
  if (duration === null)
    return { kind: "unsupported", capability: { code: "native_duration_unresolved" } }
  const coordinates = [
    duration,
    ...source.notes.flatMap((note) => [note.at, note.hold]),
    ...outputTiming.tempo.map((segment) => segment.at),
    ...outputTiming.reference_accents,
  ]
  const nativeGrid = nativeTicksPerBeatFor(coordinates)
  if (nativeGrid.kind === "unsupported") return nativeGrid
  const ticksPerBeat = nativeGrid.ticks_per_beat
  const nativeTicksPerBeat = Number(ticksPerBeat)
  const durationTicks = beatToTicks(duration, ticksPerBeat)
  if (durationTicks > 1_000_000)
    return {
      kind: "unsupported",
      capability: {
        code: "native_limit_unsupported",
        field: "duration_ticks",
        value: durationTicks,
        limit: 1_000_000,
      },
    }
  return {
    kind: "supported",
    chart: canonicalizeChart({
      ticks_per_beat: nativeTicksPerBeat,
      span_ticks: durationTicks,
      notes: source.notes.map((note) => ({
        tick: beatToTicks(note.at, ticksPerBeat),
        panel_mask: note.panel_mask,
        hold_ticks: beatToTicks(note.hold, ticksPerBeat),
      })),
    }),
    music: NativeMusicSchema.parse({
      duration_ticks: durationTicks,
      ticks_per_beat: nativeTicksPerBeat,
      offset_micros: outputTiming.offset_micros,
      tempo: outputTiming.tempo.map((segment) => ({
        start_tick: beatToTicks(segment.at, ticksPerBeat),
        micros_per_beat: segment.micros_per_beat,
      })),
      audio_sha256: audioSha256,
      reference_accents: outputTiming.reference_accents.map((beat) =>
        beatToTicks(beat, ticksPerBeat),
      ),
    }),
  }
}

export function nativeChartToBeatCore(
  chart: NativeChart,
  mode: BeatChartCore["mode"],
  timing: BeatTiming,
): BeatChartCore {
  return BeatChartCoreSchema.parse({
    mode,
    timing: {
      ...timing,
      duration: timing.duration ?? beatFromTicks(chart.span_ticks, chart.ticks_per_beat),
    },
    notes: chart.notes.map((note) => ({
      at: beatFromTicks(note.tick, chart.ticks_per_beat),
      hold: beatFromTicks(note.hold_ticks, chart.ticks_per_beat),
      panel_mask: note.panel_mask,
    })),
  })
}

function beatToTicks(beat: Beat, ticksPerBeat: bigint): number {
  const scaled = BigInt(beat.numerator) * ticksPerBeat
  const denominator = BigInt(beat.denominator)
  if (scaled % denominator !== 0n)
    throw new RangeError("Beat does not admit an exact native tick coordinate")
  const ticks = scaled / denominator
  if (ticks > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("Native tick coordinate exceeds JSON-safe integer range")
  return Number(ticks)
}
