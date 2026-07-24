import { cloneElement, isValidElement } from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/cn.js'

const buttonVariants = cva(
  'inline-flex h-10 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-[#24463f] px-4 text-white hover:bg-[#1d3833]',
        secondary:
          'border border-[#d8d6cf] bg-white px-4 text-[#303438] hover:bg-[#f1f1ec]',
        ghost: 'px-3 text-[#4b5055] hover:bg-[#f1f1ec] hover:text-[#202326]',
        danger: 'bg-[#8f2f2f] px-4 text-white hover:bg-[#752727]',
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
