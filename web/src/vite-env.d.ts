/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_DISABLE_REACT_DEVTOOLS?: string
  }
}

export {}
