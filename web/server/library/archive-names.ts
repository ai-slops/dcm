import { StudioError } from "../errors.ts"
import type { AudioRecord } from "../store.ts"
import { nativeMetadata } from "./project-factory.ts"

export function archiveAudioFormat(name: string): AudioRecord["format"] {
  const match = /\.(wav|ogg|mp3)$/i.exec(name)
  if (match?.[1] === undefined)
    throw new StudioError(
      400,
      "archive_audio_format",
      "Selected audio has an unsupported extension",
    )
  const extension = match[1].toLowerCase()
  if (extension === "wav" || extension === "ogg") return extension
  return "mp3"
}

export function archiveLabel(name: string): string {
  const result = name.trim().slice(0, 160)
  return result.length === 0 ? "archive.zip" : result
}

export function chartFilename(
  files: Readonly<Record<string, Uint8Array>>,
  name: string,
  index: number,
): string {
  const stem = nativeMetadata(name)
    .replace(/\.ucs$/i, "")
    .replaceAll(/[<>:"/\\|?*]/g, "_")
    .slice(0, 100)
  const desired = `${stem.length === 0 ? "chart" : stem}.ucs`
  return files[desired] === undefined
    ? desired
    : `${desired.replace(/\.ucs$/, "")}-${index + 1}.ucs`
}
