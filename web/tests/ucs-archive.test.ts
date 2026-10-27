import { strToU8, zipSync } from "fflate"
import { describe, expect, it } from "vitest"

import { MAX_ZIP_BYTES } from "../src/domain/archive-policy.ts"
import { readUcsZip } from "../src/domain/ucs-archive.ts"

function fixture(entries: Readonly<Record<string, Uint8Array>>): File {
  return new File([Uint8Array.from(zipSync(entries)).buffer], "song.zip")
}

describe("UCS music ZIP", () => {
  it("finds nested charts and bundled music without extracting unrelated files", async () => {
    const chart = strToU8(":Format=1\n:Mode=Single\n")
    const audio = Uint8Array.of(82, 73, 70, 70)
    const archive = await readUcsZip(
      fixture({
        "Song/Easy.UCS": chart,
        "Song/music.wav": audio,
        "Song/banner.jpg": new Uint8Array(50),
      }),
    )
    expect(archive.charts.map((entry) => entry.name)).toEqual(["Song/Easy.UCS"])
    expect(archive.charts[0]?.data).toEqual(chart)
    expect(archive.audio[0]?.data).toEqual(audio)
  })

  it("keeps multiple charts and audio choices explicit", async () => {
    const archive = await readUcsZip(
      fixture({
        "a.ucs": strToU8("a"),
        "b.ucs": strToU8("b"),
        "song.mp3": Uint8Array.of(1),
        "preview.ogg": Uint8Array.of(2),
      }),
    )
    expect(archive.charts).toHaveLength(2)
    expect(archive.audio).toHaveLength(2)
  })

  it("rejects unsafe names instead of normalizing parent traversal", async () => {
    await expect(
      readUcsZip(fixture({ "../chart.ucs": Uint8Array.of(1), "music.wav": Uint8Array.of(2) })),
    ).rejects.toMatchObject({ code: "archive_path" })
  })

  it("rejects an archive without music instead of silently reusing unrelated audio", async () => {
    await expect(readUcsZip(fixture({ "chart.ucs": Uint8Array.of(1) }))).rejects.toMatchObject({
      code: "archive_missing_audio",
    })
  })

  it("rejects truncated ZIP files", async () => {
    const bytes = zipSync({ "chart.ucs": Uint8Array.of(1), "music.wav": Uint8Array.of(2) })
    await expect(
      readUcsZip(new File([bytes.slice(0, -10)], "truncated.zip")),
    ).rejects.toMatchObject({ code: "archive_invalid" })
  })

  it("rejects oversized input before reading its bytes", async () => {
    class OversizedFile extends File {
      override get size(): number {
        return MAX_ZIP_BYTES + 1
      }
    }
    await expect(readUcsZip(new OversizedFile([], "large.zip"))).rejects.toMatchObject({
      code: "archive_input_limit",
    })
  })
})
