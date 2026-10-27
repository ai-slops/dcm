import { type UcsCatalogResult, UcsCatalogResultSchema } from "../../shared/library.ts"
import { StudioError } from "../errors.ts"
import { ucsPackageUrl } from "./download.ts"

const SOURCE = "https://www.pumpproplus.com/ucs-base-list.aspx"

function entities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);/gi,
    (match, raw: string) => {
      const key = raw.toLowerCase()
      switch (key) {
        case "amp":
          return "&"
        case "quot":
          return '"'
        case "apos":
          return "'"
        case "lt":
          return "<"
        case "gt":
          return ">"
        case "nbsp":
          return " "
        default: {
          const number = key.startsWith("#x")
            ? Number.parseInt(key.slice(2), 16)
            : Number.parseInt(key.slice(1), 10)
          return Number.isInteger(number) && number >= 0 && number <= 0x10ffff
            ? String.fromCodePoint(number)
            : match
        }
      }
    },
  )
}

function attributes(tag: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  for (const match of tag.matchAll(
    /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    const key = match[1]
    if (key !== undefined)
      result.set(key.toLowerCase(), entities(match[2] ?? match[3] ?? match[4] ?? ""))
  }
  return result
}

function text(value: string): string {
  return entities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

export function catalogForm(html: string, query: string): URLSearchParams {
  const allowed = new Set([
    "__VIEWSTATE",
    "__VIEWSTATEGENERATOR",
    "__VIEWSTATEENCRYPTED",
    "__EVENTVALIDATION",
  ])
  const form = new URLSearchParams()
  for (const input of html.match(/<input\b[^>]*>/gi) ?? []) {
    const fields = attributes(input)
    const name = fields.get("name")
    if (name !== undefined && allowed.has(name)) form.set(name, fields.get("value") ?? "")
  }
  for (const name of ["__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"])
    if (!form.has(name))
      throw new StudioError(
        502,
        "catalog_invalid",
        "The public song catalog changed its search form; try the song code download instead",
      )
  form.set("ctl00$cphContentBodyLeft$tbUCSSearch", query)
  form.set("ctl00$cphContentBodyLeft$btnSearch", "Search")
  return form
}

export function catalogResult(html: string, query: string): UcsCatalogResult {
  if (!html.includes("ctl00_cphContentBodyLeft_lblResultCount"))
    throw new StudioError(
      502,
      "catalog_invalid",
      "The source did not return public song search results",
    )
  const items: { code: string; title: string; artist: string; bpm: string }[] = []
  const seen = new Set<string>()
  for (const row of html.matchAll(
    /<tr\b[^>]*class\s*=\s*(?:"[^"]*\bdata-row\b[^"]*"|'[^']*\bdata-row\b[^']*')[^>]*>([\s\S]*?)<\/tr>/gi,
  )) {
    const cells = [...(row[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (cell) => cell[1] ?? "",
    )
    const code = text(cells[0] ?? "").toUpperCase()
    if (!/^CS[0-9]{3,4}$/.test(code) || seen.has(code)) continue
    const anchor = /<a\b[^>]*>/i.exec(cells[5] ?? "")?.[0]
    const href = anchor === undefined ? undefined : attributes(anchor).get("href")
    if (href === undefined) continue
    const url = URL.parse(href, SOURCE)
    const expected = ucsPackageUrl(code)
    if (url === null || url.origin !== expected.origin || url.pathname !== expected.pathname)
      continue
    const title = text(cells[2] ?? "").slice(0, 160)
    const artist = text(cells[3] ?? "").slice(0, 160)
    const bpm = text(cells[4] ?? "").slice(0, 64)
    if (title === "" || artist === "" || bpm === "") continue
    seen.add(code)
    items.push({ code, title, artist, bpm })
    if (items.length === 100) break
  }
  const countText =
    /id=["']ctl00_cphContentBodyLeft_lblResultCount["'][^>]*>([\s\S]*?)<\//i.exec(html)?.[1] ?? ""
  const count = Number(text(countText).match(/[0-9]+/)?.[0] ?? items.length)
  return UcsCatalogResultSchema.parse({ query, count, items, source_url: SOURCE })
}
