import { cn } from '../../lib/cn.js'

// A few choices side by side where one is on, like a toggle with more than two sides. Each is a radio in a group.
export function SegmentedControl({ options, value, onChange, label, disabled = false, className }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex flex-wrap rounded-xl border border-(--mws-line) bg-(--mws-soft) p-1', className)}
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              selected ? 'bg-(--mws-burgundy) text-white shadow-sm' : 'text-(--mws-muted) hover:text-(--mws-charcoal)',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
