import { cloneElement, isValidElement } from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/cn.js'

const buttonVariants = cva(
  'inline-flex h-10 items-center justify-center gap-2 rounded-full font-display text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--mws-burgundy)] px-5 text-white shadow-sm hover:bg-[var(--mws-burgundy-dark)] focus-visible:outline-[var(--mws-burgundy)]',
        secondary:
          'border border-[var(--mws-line)] bg-white px-5 text-[var(--mws-charcoal)] hover:border-[var(--mws-burgundy)] hover:bg-[var(--mws-soft)] hover:text-[var(--mws-burgundy)] focus-visible:outline-[var(--mws-burgundy)]',
        ghost:
          'px-4 text-[var(--mws-muted)] hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)] focus-visible:outline-[var(--mws-burgundy)]',
        danger:
          'bg-[var(--mws-rose)] px-5 text-white hover:bg-[#9f3d41] focus-visible:outline-[var(--mws-rose)]',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10',
        icon: 'h-10 w-10 px-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export function Button({ asChild, className, variant, size, ...props }) {
  const classes = cn(buttonVariants({ variant, size }), className)

  if (asChild) {
    const { children, ...childProps } = props

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
      {...props}
    />
  )
}
