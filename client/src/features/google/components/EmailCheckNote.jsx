import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { TextAction } from '../../../components/ui/TextAction.jsx'

// One quiet line under the Email field: an icon for what the check said, the words, and Check as a link while the
// address has not been checked.
const LOOK = {
  needed: { tone: 'text-(--mws-muted)' },
  checking: { tone: 'text-(--mws-muted)', icon: Loader2, spin: true },
  free: { tone: 'text-[#476b43]', icon: Check },
  own: { tone: 'text-[#476b43]', icon: Check },
  taken: { tone: 'text-[#a43c41] font-medium', icon: X },
  failed: { tone: 'text-[#a43c41]', icon: X },
  claimable: { tone: 'text-[#8a6419] font-medium', icon: AlertTriangle },
  held: { tone: 'text-[#8a6419] font-medium', icon: AlertTriangle },
  'failed-google': { tone: 'text-[#8a6419]', icon: AlertTriangle },
  unchecked: { tone: 'text-(--mws-muted)' },
  protected: { tone: 'text-[#8a6419]', icon: AlertTriangle },
}

// What an address that was not checked yet says here. The longer sentence stays as the message for a Save that is refused.
const WORDS = { needed: 'Not checked yet' }

export function EmailCheckNote({ check }) {
  if (!check?.message) return null
  const look = LOOK[check.state] ?? LOOK.unchecked
  const Icon = look.icon
  return (
    <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      <span className={`inline-flex min-w-0 items-center gap-1.5 ${look.tone}`} aria-live="polite" data-testid="email-check">
        {Icon ? <Icon size={13} aria-hidden="true" className={look.spin ? 'shrink-0 animate-spin motion-reduce:animate-none' : 'shrink-0'} /> : null}
        <span className="min-w-0">{WORDS[check.state] ?? check.message}</span>
      </span>
      {check.canCheck ? (
        <TextAction type="button" onClick={check.check}>
          Check
        </TextAction>
      ) : null}
    </span>
  )
}
