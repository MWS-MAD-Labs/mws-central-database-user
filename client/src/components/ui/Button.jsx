import { cloneElement, isValidElement } from 'react'
import { Loader2 } from 'lucide-react'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/cn.js'

const buttonVariants = cva(
  'relative inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full font-display text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        primary:
          'bg-(--mws-burgundy) px-5 text-white shadow-sm hover:bg-(--mws-burgundy-dark) focus-visible:outline-(--mws-burgundy)',
        secondary:
          'border border-(--mws-line) bg-white px-5 text-(--mws-charcoal) hover:border-(--mws-burgundy) hover:bg-(--mws-soft) hover:text-(--mws-burgundy) focus-visible:outline-(--mws-burgundy)',
        ghost:
          'px-4 text-(--mws-muted) hover:bg-(--mws-soft) hover:text-(--mws-charcoal) focus-visible:outline-(--mws-burgundy)',
        danger:
          'bg-(--mws-rose) px-5 text-white hover:bg-[#9f3d41] focus-visible:outline-(--mws-rose)',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10',
        icon: 'h-10 w-10 min-w-10 shrink-0 aspect-square px-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export function Button({ asChild, className, variant, size, loading = false, children, disabled, ...props }) {
  const classes = cn(buttonVariants({ variant, size }), className)

  if (asChild) {
    const childProps = props

    if (!isValidElement(children)) {
      return null
    }

    return cloneElement(children, {
      ...childProps,
      className: cn(classes, children.props.className),
    })
  }

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      <span className={cn('inline-flex items-center justify-center gap-2', loading && 'invisible')}>
        {children}
      </span>
      {loading ? (
        <Loader2
          size={16}
          className="absolute animate-spin motion-reduce:animate-none"
        />
      ) : null}
    </button>
  )
}
