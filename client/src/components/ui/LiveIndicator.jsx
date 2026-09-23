import { cn } from '../../lib/cn.js'

export function LiveIndicator({ isSyncing = false, className }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-2 rounded-full border px-2.5 text-xs font-semibold',
        isSyncing
          ? 'border-[#e9d49b] bg-[#fff8e8] text-[#8a6419]'
          : 'border-[#b9d8b5] bg-[#f1f8ef] text-[#3f6a3b]',
        className,
      )}
    >
      <span className="relative flex h-2.5 w-2.5 items-center justify-center" aria-hidden="true">
        {!isSyncing ? (
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-[#58a451] opacity-45 motion-reduce:hidden" />
        ) : null}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            isSyncing ? 'bg-[#c08a21]' : 'bg-[#4d9647]',
          )}
        />
      </span>
      {isSyncing ? 'Syncing' : 'Live'}
    </span>
  )
}
