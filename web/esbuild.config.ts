import { build } from "esbuild"

await build({
  bundle: true,
  entryPoints: {
    "archive-worker": "server/library/archive-worker.ts",
    server: "server/index.ts",
  },
  format: "esm",
  outdir: "dist",
  packages: "external",
  platform: "node",
  sourcemap: true,
  target: "node24",
})
