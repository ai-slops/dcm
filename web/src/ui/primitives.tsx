import {
  type ButtonHTMLAttributes,
  cloneElement,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useId,
} from "react"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "secondary" | "ghost" | "danger"
  readonly icon?: ReactNode
}

export function Button({
  variant = "secondary",
  icon,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button className={`button button--${variant} ${className ?? ""}`} {...props}>
      {icon}
      <span>{children}</span>
    </button>
  )
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly label: string
  readonly icon: ReactNode
  readonly selected?: boolean
}

export function IconButton({ label, icon, selected, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={props["aria-pressed"] === undefined ? selected : props["aria-pressed"]}
      className="icon-button"
      title={label}
      {...props}
    >
      {icon}
    </button>
  )
}

export function Badge({
  tone = "neutral",
  children,
}: PropsWithChildren<{ readonly tone?: string }>) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export function Panel({
  title,
  action,
  className,
  children,
}: PropsWithChildren<{
  readonly title: string
  readonly action?: ReactNode
  readonly className?: string
}>) {
  return (
    <section className={`panel ${className ?? ""}`}>
      <header className="panel__header">
        <h2>{title}</h2>
        {action}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  )
}

export function Field({
  label,
  help,
  children,
}: {
  readonly label: string
  readonly help?: string
  readonly children: ReactElement<{
    readonly id?: string
    readonly "aria-describedby"?: string
  }>
}) {
  const generatedId = useId()
  const id = children.props.id ?? generatedId
  const helpId = `${id}-help`
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, {
        id,
        ...(help === undefined
          ? {}
          : {
              "aria-describedby": [children.props["aria-describedby"], helpId]
                .filter(Boolean)
                .join(" "),
            }),
      })}
      {help === undefined ? null : (
        <span id={helpId} className="field__help">
          {help}
        </span>
      )}
    </div>
  )
}

export function ToolChip({
  pressed,
  children,
  ...props
}: ButtonProps & { readonly pressed: boolean }) {
  return (
    <button className="tool-chip" aria-pressed={pressed} {...props}>
      {children}
    </button>
  )
}
