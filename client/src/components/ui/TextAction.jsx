import { cloneElement, isValidElement } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn.js'

const classes =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-xs! font-medium! text-(--mws-muted) underline-offset-4 transition-colors hover:text-(--mws-charcoal) hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mws-burgundy) disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'

// The ! on the size and weight is needed: index.css sets `font: inherit` on buttons outside Tailwind's layers,
// which would otherwise make a button 16px while a link with the same classes is 12px.
// A quiet action written as text, for what sits next to the main button. Use Button for the main one.
// `icon` is a lucide icon component, drawn small in front of the text.
export function TextAction({ asChild, className, loading = false, disabled, icon: Icon, children, ...props }) {
  const mark = Icon ? <Icon size={14} aria-hidden="true" /> : null
  if (asChild && isValidElement(children)) {
    return cloneElement(
      children,
      { ...props, className: cn(classes, className, children.props.className) },
      mark,
      children.props.children,
    )
  }
  return (
    <button
      type="button"
      className={cn(classes, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : mark}
      {children}
    </button>
  )
}
