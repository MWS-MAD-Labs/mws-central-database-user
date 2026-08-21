import { cn } from '../../lib/cn.js'

const toneClasses = {
  green: 'bg-[#edf4eb] text-[#476b43]',
  amber: 'bg-[#fff4d8] text-[#8a6419]',
  red: 'bg-[#fff0f1] text-[#a43c41]',
  neutral: 'bg-[#eef3fb] text-[var(--mws-navy)]',
}

const textToneClasses = {
  green: 'text-[#476b43]',
  amber: 'text-[#8a6419]',
  red: 'text-[#a43c41]',
  neutral: 'text-[var(--mws-navy)]',
}

// variant="text" - same tone colors, no pill background - for tables that
// want status conveyed by color alone rather than a badge shape.
export function StatusBadge({
  children,
  tone = 'neutral',
  variant = 'solid',
  className,
  title,
}) {
  if (variant === 'text') {
    return (
      <span
        title={title}
        className={cn('text-xs font-semibold', textToneClasses[tone], className)}
      >
        {children}
      </span>
    )
  }

  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
