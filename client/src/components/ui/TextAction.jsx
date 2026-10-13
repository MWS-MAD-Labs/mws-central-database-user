import { cloneElement, isValidElement } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn.js'

const SIZE = { sm: 'text-xs! font-medium!', md: 'text-sm! font-semibold!' }
// `primary` is the one action of a page or panel: the same quiet shape, in the colour of the brand.
const TONE = { quiet: 'text-(--mws-muted) hover:text-(--mws-charcoal)', header: 'text-(--mws-charcoal) hover:text-(--mws-charcoal)', primary: 'text-(--mws-burgundy) hover:text-(--mws-rose)' }
const classes =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-sm underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mws-burgundy) disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'

// The ! on the size and weight is needed: index.css sets `font: inherit` on buttons outside Tailwind's layers,
// which would otherwise make a button 16px while a link with the same classes is 12px.
// A quiet action written as text, for what sits next to the main button. Use Button for the main one.
// `icon` is a lucide icon component, drawn small in front of the text. `size="md"` is for the row of actions in a page header.
export function TextAction({ asChild, className, size = 'sm', tone, loading = false, disabled, icon: Icon, children, ...props }) {
  const mark = Icon ? <Icon size={size === 'md' ? 16 : 14} aria-hidden="true" /> : null
  const look = cn(classes, SIZE[size], TONE[tone ?? (size === 'md' ? 'header' : 'quiet')])
  if (asChild && isValidElement(children)) {
    return cloneElement(
      children,
      { ...props, className: cn(look, className, children.props.className) },
      mark,
      children.props.children,
    )
  }
  return (
    <button
      type="button"
      className={cn(look, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : mark}
      {children}
    </button>
  )
}
