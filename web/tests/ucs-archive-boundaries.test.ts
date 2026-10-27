import { strToU8, Zip, ZipPassThrough, zipSync } from "fflate"
import { expect, it } from "vitest"

import { updateArchiveCrc } from "../src/domain/archive-crc.ts"
import { MAX_AUDIO_BYTES } from "../src/domain/archive-policy.ts"
import { readUcsZip } from "../src/domain/ucs-archive.ts"

function archiveFile(bytes: Uint8Array): File {
  return new File([Uint8Array.from(bytes).buffer], "fixture.zip")
}

function rewrittenHeaders(
  kind: "encryption" | "size" | "checksum" | "compression",
  value: number,
): File {
  const bytes = zipSync({ "chart.ucs": Uint8Array.of(1), "music.wav": new Uint8Array(50_000) })
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    const signature = view.getUint32(offset, true)
    if (signature !== 0x04034b50 && signature !== 0x02014b50) continue
    const local = signature === 0x04034b50
    switch (kind) {
      case "encryption":
        view.setUint16(offset + (local ? 6 : 8), value, true)
        break
      case "compression":
        view.setUint16(offset + (local ? 8 : 10), value, true)
        break
      case "size":
        view.setUint32(offset + (local ? 22 : 24), value, true)
        break
      case "checksum":
        view.setUint32(offset + (local ? 14 : 16), value, true)
        break
    }
  }
  return archiveFile(bytes)
}

it("rejects encrypted entries before decompression", async () => {
  await expect(readUcsZip(rewrittenHeaders("encryption", 1))).rejects.toMatchObject({
    code: "archive_encrypted",
  })
})

it("checks actual emitted size even when both headers understate it", async () => {
  await expect(readUcsZip(rewrittenHeaders("size", 1))).rejects.toMatchObject({
    code: "archive_output_limit",
  })
})

it("rejects oversized declared entries before allocating output", async () => {
  await expect(readUcsZip(rewrittenHeaders("size", MAX_AUDIO_BYTES + 1))).rejects.toMatchObject({
    code: "archive_output_limit",
  })
})

it("verifies output CRC rather than accepting corrupted directory checksums", async () => {
  await expect(readUcsZip(rewrittenHeaders("checksum", 123))).rejects.toMatchObject({
    code: "archive_invalid",
  })
})

it("rejects unsupported compression methods", async () => {
  await expect(readUcsZip(rewrittenHeaders("compression", 99))).rejects.toMatchObject({
    code: "archive_compression",
  })
})

it("bounds entry count even for unrelated files", async () => {
  const entries = Object.fromEntries(
    Array.from({ length: 129 }, (_, index) => [`extra-${index}.txt`, Uint8Array.of(1)]),
  )
  await expect(
    readUcsZip(
      archiveFile(
        zipSync({ ...entries, "chart.ucs": Uint8Array.of(1), "music.wav": Uint8Array.of(1) }),
      ),
    ),
  ).rejects.toMatchObject({ code: "archive_entry_limit" })
})

it("rejects case-ambiguous names", async () => {
  const bytes = zipSync({
    "CHART.ucs": Uint8Array.of(1),
    "chart.UCS": Uint8Array.of(1),
    "music.wav": Uint8Array.of(1),
  })
  await expect(readUcsZip(archiveFile(bytes))).rejects.toMatchObject({ code: "archive_duplicate" })
})

it("reads UTF-8 names and data-descriptor ZIP entries", async () => {
  const chunks: Uint8Array[] = []
  const zip = new Zip((error, chunk) => {
    if (error !== null) throw error
    chunks.push(chunk)
  })
  for (const name of ["곡/Normal.ucs", "곡/music.wav"]) {
    const file = new ZipPassThrough(name)
    zip.add(file)
    file.push(strToU8(name), true)
  }
  zip.end()
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const archive = await readUcsZip(archiveFile(bytes))
  expect(archive.charts[0]?.name).toBe("곡/Normal.ucs")
  expect(archive.audio[0]?.data).toEqual(strToU8("곡/music.wav"))
})

it("extracts a worker-sized entry without detaching shared ZIP input", async () => {
  const audio = new Uint8Array(400_000)
  let state = 1
  for (let index = 0; index < audio.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    audio[index] = state >>> 24
  }
  const archive = await readUcsZip(
    archiveFile(zipSync({ "chart.ucs": Uint8Array.of(1), "music.wav": audio })),
  )
  expect(archive.audio[0]?.data).toEqual(audio)
})

it("supports cancellation without returning partial song entries", async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    readUcsZip(
      archiveFile(zipSync({ "chart.ucs": Uint8Array.of(1), "music.wav": Uint8Array.of(1) })),
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" })
})

it("rejects a directory offset alias instead of reading another same-named physical record", async () => {
  const bytes = zipSync(
    { "chart.ucs": Uint8Array.of(1), "music.wav": Uint8Array.of(2) },
    { level: 0 },
  )
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const central: number[] = []
  for (let offset = 0; offset + 46 < bytes.length; offset += 1)
    if (view.getUint32(offset, true) === 0x02014b50) central.push(offset)
  const first = central[0]
  const second = central[1]
  if (first === undefined || second === undefined) throw new TypeError("Fixture headers missing")
  view.setUint32(first + 42, view.getUint32(second + 42, true), true)
  await expect(readUcsZip(archiveFile(bytes))).rejects.toMatchObject({ code: "archive_invalid" })
})

it("rejects overlapping local records even with consistent names, sizes and CRCs", async () => {
  const bytes = zipSync(
    { "chart.ucs": Uint8Array.of(1), "music.wav": Uint8Array.of(2) },
    { level: 0 },
  )
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  const central = view.getUint32(end + 16, true)
  const dataStart = 30 + view.getUint16(26, true) + view.getUint16(28, true)
  const size = central - dataStart
  const crc = (updateArchiveCrc(0xffffffff, bytes.subarray(dataStart, central)) ^ 0xffffffff) >>> 0
  view.setUint32(14, crc, true)
  view.setUint32(18, size, true)
  view.setUint32(22, size, true)
  view.setUint32(central + 16, crc, true)
  view.setUint32(central + 20, size, true)
  view.setUint32(central + 24, size, true)
  await expect(readUcsZip(archiveFile(bytes))).rejects.toMatchObject({ code: "archive_invalid" })
})
