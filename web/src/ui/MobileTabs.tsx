const mobileTabs = ["editor", "preview", "agent"] as const

export type MobileTab = (typeof mobileTabs)[number]

export function MobileTabs({
  selected,
  onSelect,
}: {
  readonly selected: MobileTab
  readonly onSelect: (tab: MobileTab) => void
}) {
  return (
    <div className="mobile-tabs" aria-label="Studio views" role="tablist">
      {mobileTabs.map((item, index) => (
        <button
          type="button"
          role="tab"
          id={`${item}-tab`}
          aria-controls={`${item}-panel`}
          aria-selected={selected === item}
          key={item}
          tabIndex={selected === item ? 0 : -1}
          onClick={() => onSelect(item)}
          onKeyDown={(event) => {
            let nextIndex = index
            if (event.key === "ArrowRight") nextIndex = (index + 1) % mobileTabs.length
            else if (event.key === "ArrowLeft") {
              nextIndex = (index + mobileTabs.length - 1) % mobileTabs.length
            } else if (event.key === "Home") nextIndex = 0
            else if (event.key === "End") nextIndex = mobileTabs.length - 1
            else return
            const nextTab = mobileTabs[nextIndex]
            if (nextTab === undefined) return
            event.preventDefault()
            onSelect(nextTab)
            const nextButton = document.getElementById(`${nextTab}-tab`)
            if (nextButton instanceof HTMLButtonElement) nextButton.focus()
          }}
        >
          {item}
        </button>
      ))}
    </div>
  )
}
