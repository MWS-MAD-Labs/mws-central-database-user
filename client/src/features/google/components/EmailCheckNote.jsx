import { Button } from '../../../components/ui/Button.jsx'

const TONES = {
  needed: 'text-(--mws-muted)',
  checking: 'text-(--mws-muted)',
  free: 'text-[#476b43]',
  taken: 'text-[#a43c41] font-medium',
  failed: 'text-[#a43c41]',
  'failed-google': 'text-[#8a6419]',
  unchecked: 'text-(--mws-muted)',
}

// Under the Email field: what the check said, and the Check button while the address has not been checked.
export function EmailCheckNote({ check }) {
  if (!check?.message) return null
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={TONES[check.state]} aria-live="polite" data-testid="email-check">
        {check.message}
      </span>
      {check.canCheck ? (
        <Button type="button" variant="secondary" size="sm" onClick={check.check}>
          Check
        </Button>
      ) : null}
    </span>
  )
}
