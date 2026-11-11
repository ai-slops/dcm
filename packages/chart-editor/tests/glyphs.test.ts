import assert from "node:assert/strict"
import test from "node:test"
import { displaySeconds, noteGlyph, noteGlyphPath, noteGlyphSize } from "../src/glyphs.ts"

test("Pump directions and center repeat for the second pad", () => {
  for (const [lane, xSign, ySign] of [[0, -1, 1], [1, -1, -1], [3, 1, -1], [4, 1, 1]]) {
    const tip = noteGlyph(lane ?? 0)[0]
    assert.ok(tip)
    assert.equal(Math.sign(tip[0]), xSign)
    assert.equal(Math.sign(tip[1]), ySign)
  }
  assert.equal(noteGlyph(2).length, 4)
  for (let lane = 0; lane < 5; lane++) assert.deepEqual(noteGlyph(lane), noteGlyph(lane + 5))
  assert.ok(noteGlyphPath(0).startsWith("M"))
  assert.throws(() => noteGlyph(10))
})
test("display scale changes visible seconds without changing note size or time", () => {
  assert.equal(displaySeconds(600, 150), 4)
  assert.equal(displaySeconds(600, 300), 2)
  assert.equal(noteGlyphSize(100), 32)
  assert.ok(noteGlyphSize(20) < noteGlyphSize(100))
  assert.throws(() => displaySeconds(600, 0))
})
