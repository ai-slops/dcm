import { expect, it } from "vitest"

import { timelineGestureExceedsJitter } from "../src/ui/useTimelineGesture.ts"

it("requires deliberate pointer movement before a timeline click becomes a drag", () => {
  // Given a pointer press with small hand jitter and a later deliberate move
  const startY = 100

  // When both distances are classified
  const jitter = timelineGestureExceedsJitter(startY, 103)
  const drag = timelineGestureExceedsJitter(startY, 105)

  // Then ordinary jitter stays a click while explicit movement starts a drag
  expect(jitter).toBe(false)
  expect(drag).toBe(true)
})
