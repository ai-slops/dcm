import { startBootstrap } from "./bootstrap.ts"
import "./styles/tokens.css"
import "./styles/components.css"
import "./styles/dialogs.css"
import "./styles/layout.css"
import "./styles/editor.css"
import "./styles/playfield.css"
import "./styles/responsive.css"
import "./styles/mobile.css"

const showcase = import.meta.env.DEV && new URLSearchParams(window.location.search).has("showcase")
const bootstrapLoad = showcase ? null : startBootstrap()

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== "true") {
  void import("react-scan").then(({ scan }) => scan({ enabled: true }))
  void import("react-grab")
}

void import("./render.tsx").then(({ renderApp }) => renderApp(bootstrapLoad))
