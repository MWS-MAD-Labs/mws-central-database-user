import { cloneElement, isValidElement } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn.js'

const classes =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-[13px] font-semibold text-(--mws-burgundy) underline-offset-4 transition-colors hover:text-(--mws-burgundy-dark) hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mws-burgundy) disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'

// A quiet action written as text, for what sits next to the main button. Use Button for the main one.
export function TextAction({ asChild, className, loading = false, disabled, children, ...props }) {
  if (asChild && isValidElement(children)) {
    return cloneElement(children, { ...props, className: cn(classes, className, children.props.className) })
  }
  return (
    <button
      type="button"
      className={cn(classes, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
      {children}
    </button>
  )
}
