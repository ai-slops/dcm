import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const inlineBuiltCss = {
  name: "inline-built-css",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(html, context) {
      if (context.bundle === undefined) return html
      return Object.values(context.bundle).reduce((result, output) => {
        if (output.type !== "asset" || !output.fileName.endsWith(".css")) return result
        const link = `<link rel="stylesheet" crossorigin href="/${output.fileName}">`
        if (!result.includes(link)) return result
        const css =
          typeof output.source === "string"
            ? output.source
            : new TextDecoder().decode(output.source)
        return result.replace(link, `<style>${css}</style>`)
      }, html)
    },
  },
} satisfies Plugin

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  plugins: [react(), inlineBuiltCss],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4173", changeOrigin: true },
    },
  },
})
