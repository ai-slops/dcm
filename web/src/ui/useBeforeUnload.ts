import { useEffect } from "react"

export function useBeforeUnload(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", preventUnload)
    return () => window.removeEventListener("beforeunload", preventUnload)
  }, [dirty])
}
