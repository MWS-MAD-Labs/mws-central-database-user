import { cn } from '../../lib/cn.js'

const toneClasses = {
  green: 'bg-[#e3f2e8] text-[#23633a]',
  amber: 'bg-[#fff0cf] text-[#7c5418]',
  red: 'bg-[#fde2df] text-[#8f2f2f]',
  neutral: 'bg-[#ecebe5] text-[#565b60]',
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
