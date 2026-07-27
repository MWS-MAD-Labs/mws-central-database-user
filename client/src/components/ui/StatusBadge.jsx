import { cn } from '../../lib/cn.js'

const toneClasses = {
  green: 'bg-[#edf4eb] text-[#476b43]',
  amber: 'bg-[#fff4d8] text-[#8a6419]',
  red: 'bg-[#fff0f1] text-[#a43c41]',
  neutral: 'bg-[#eef3fb] text-[var(--mws-navy)]',
}

export function StatusBadge({ children, tone = 'neutral', className }) {
  return (
    <span
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
