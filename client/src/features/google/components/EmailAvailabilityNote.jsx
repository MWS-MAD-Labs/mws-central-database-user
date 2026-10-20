const TONES = {
  checking: 'text-(--mws-muted)',
  free: 'text-[#476b43]',
  taken: 'text-[#a43c41] font-medium',
  failed: 'text-[#8a6419]',
  unchecked: 'text-(--mws-muted)',
}

// One line under the Email field: whether the address can be used for a new person.
export function EmailAvailabilityNote({ availability }) {
  if (!availability?.message) return null
  return (
    <span className={TONES[availability.state]} aria-live="polite" data-testid="email-availability">
      {availability.message}
    </span>
  )
}
