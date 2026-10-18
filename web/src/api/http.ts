import ky from "ky"

export const http = ky.create({ credentials: "same-origin", retry: 0, timeout: 30_000 })
