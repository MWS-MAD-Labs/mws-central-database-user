import { Check } from 'lucide-react'
import { cn } from '../../../lib/cn.js'

// One step of the admission flow of a new student: a numbered circle (burgundy and ticked when done, outlined while it is
// the one to do, grey while an earlier step is still open), and the control of that step next to it.
export function AdmissionStep({ number, done, locked, children }) {
  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
            done
              ? 'bg-(--mws-burgundy) text-white'
              : locked
                ? 'border border-(--mws-line) bg-white text-(--mws-muted)'
                : 'border-2 border-(--mws-burgundy) bg-white text-(--mws-burgundy)',
          )}
        >
          {done ? <Check size={14} strokeWidth={3} /> : number}
        </span>
        <span className="mt-1 w-px flex-1 bg-(--mws-line)" aria-hidden="true" />
      </div>
      <div className={cn('min-w-0 flex-1 pb-5', locked ? 'opacity-70' : null)}>{children}</div>
    </div>
  )
}
