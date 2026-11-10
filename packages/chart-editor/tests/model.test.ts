import test from "node:test"
import assert from "node:assert/strict"
import { addBeats } from "../src/beat-arithmetic.ts"
import { editReview, ucsLosses, type ReviewDocument } from "../src/model.ts"
import { beatToAudioMicros, audioMicrosToBeatPosition } from "../src/timing.ts"
test("shared beat arithmetic and tempo projection preserve mixed subdivisions", () => {
  assert.deepEqual(addBeats({ numerator: 1, denominator: 3 }, { numerator: 1, denominator: 4 }), {
    numerator: 7,
    denominator: 12,
  })
  const timing = {
    offset_micros: 125000,
    tempo: [
      {
        at: { numerator: 0, denominator: 1 },
        micros_per_beat: { numerator: 500000, denominator: 1 },
      },
      {
        at: { numerator: 4, denominator: 1 },
        micros_per_beat: { numerator: 400000, denominator: 1 },
      },
    ],
  }
  assert.equal(beatToAudioMicros(timing, { numerator: 5, denominator: 1 }), 2525000)
  assert.equal(audioMicrosToBeatPosition(timing, 2525000), 5)
})
test("weighted ticks do not become repeated presses or UCS body cells", () => {
  const d: ReviewDocument = {
    schema: 1,
    revision: 0,
    source: { id: "test", size_bytes: 1, mtime_ns: "1" },
    analysis_fingerprint: "test",
    coverage: [0, 2],
    status: "draft",
    notes: [],
    ticks: [{ id: "tick", seconds: 0.13, count: 4, evidence: [] }],
    scroll: [],
    comment: "",
  }
  const next = editReview(d, {
    kind: "put-note",
    note: {
      id: "hold",
      lane: 0,
      kind: "hold",
      start_seconds: null,
      end_seconds: 1,
      observed_range: [0, 1],
      evidence: [],
    },
  })
  assert.equal(next.notes.length, 1)
  assert.deepEqual(next.ticks, d.ticks)
  assert.equal(ucsLosses(next).length, 2)
})
