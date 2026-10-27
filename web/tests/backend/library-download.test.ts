import { expect, it } from "vitest"

import { downloadUcsPackage, ucsPackageUrl } from "../../server/library/download.ts"

it("constructs only fixed public package URLs from UCS codes", () => {
  expect(ucsPackageUrl("cs839").toString()).toBe(
    "https://www.pumpproplus.com/downloads/ucs/cs839.zip",
  )
  for (const code of ["http://127.0.0.1", "CS839/../../secret", "CS839?url=private", "CS839.zip"])
    expect(() => ucsPackageUrl(code)).toThrow()
})

it("uses a credential-free redirect-denying download and retains the public source", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    expect(request.url).toBe("https://www.pumpproplus.com/downloads/ucs/cs839.zip")
    expect(request.credentials).toBe("omit")
    expect(request.redirect).toBe("error")
    expect(request.headers.has("authorization")).toBe(false)
    if (!request.headers.get("accept")?.includes("application/x-zip-compressed"))
      return new Response("Unsupported response format", { status: 406 })
    return new Response(Uint8Array.of(0x50, 0x4b, 3, 4, 1), { status: 200 })
  }
  const result = await downloadUcsPackage("CS839", undefined, fetcher)
  expect(result.title).toBe("Nemonemo")
  expect(result.bytes.byteLength).toBe(5)
})

it("rejects HTML/login results and declared oversized bodies", async () => {
  const html: typeof fetch = async () => new Response("<html>Login</html>")
  await expect(downloadUcsPackage("CS839", undefined, html)).rejects.toMatchObject({
    code: "download_not_zip",
  })
  const huge: typeof fetch = async () =>
    new Response("x", { headers: { "content-length": String(65 * 1024 * 1024) } })
  await expect(downloadUcsPackage("CS839", undefined, huge)).rejects.toMatchObject({
    code: "download_size",
  })
})
