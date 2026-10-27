import { expect, it } from "vitest"
import { searchUcsCatalog } from "../../server/library/catalog.ts"
import { catalogForm, catalogResult } from "../../server/library/catalog-html.ts"

const formHtml =
  '<input type="hidden" name="__VIEWSTATE" value="a&amp;b"><input name="__VIEWSTATEGENERATOR" value="generator"><input name="__EVENTVALIDATION" value="validation">'
const resultHtml =
  '<span id="ctl00_cphContentBodyLeft_lblResultCount">1 result</span><table><tr class="data-row"><td>CS839</td><td>banner</td><td><b>Nemonemo</b></td><td>Yena</td><td>138</td><td><a href="/downloads/ucs/cs839.zip">Download</a></td></tr></table>'

it("submits only the public search form fields", () => {
  const form = catalogForm(formHtml, "CS839")
  expect(form.get("__VIEWSTATE")).toBe("a&b")
  expect(form.get("ctl00$cphContentBodyLeft$tbUCSSearch")).toBe("CS839")
  expect([...form.keys()]).toHaveLength(5)
})

it("returns sanitized metadata only for matching trusted package links", () => {
  const result = catalogResult(resultHtml, "CS839")
  expect(result.items).toEqual([{ code: "CS839", title: "Nemonemo", artist: "Yena", bpm: "138" }])
  expect(
    catalogResult(
      resultHtml.replace("/downloads/ucs/cs839.zip", "https://private.invalid/secret"),
      "CS839",
    ).items,
  ).toEqual([])
})

it("keeps the source's anonymous form cookie local to its fixed public host", async () => {
  let requests = 0
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    requests += 1
    expect(request.url).toBe("https://www.pumpproplus.com/ucs-base-list.aspx")
    expect(request.redirect).toBe("error")
    expect(request.headers.has("authorization")).toBe(false)
    if (requests === 1)
      return new Response(formHtml, {
        headers: { "set-cookie": "public-session=fixture; Secure; HttpOnly" },
      })
    expect(request.headers.get("cookie")).toBe("public-session=fixture")
    expect(
      new URLSearchParams(await request.text()).get("ctl00$cphContentBodyLeft$tbUCSSearch"),
    ).toBe("CS839")
    return new Response(resultHtml)
  }
  expect((await searchUcsCatalog("CS839", undefined, fetcher)).items).toHaveLength(1)
})
