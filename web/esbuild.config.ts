import { build } from "esbuild"

await build({
  bundle: true,
  entryPoints: ["server/index.ts"],
  format: "esm",
  outfile: "dist/server.js",
  packages: "external",
  platform: "node",
  sourcemap: true,
  target: "node24",
})
