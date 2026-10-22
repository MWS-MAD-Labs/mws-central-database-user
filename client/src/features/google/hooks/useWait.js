import { useEffect, useState } from 'react'

const nowMs = () => Date.now()

// A wait that ends at an ISO time. It is worked out in milliseconds, so the button turns on at the moment the time is
// up, not up to a second later, and the ring that draws it (CooldownRing) uses the same end. `total` is how long the
// whole wait is, in seconds. `seconds` is for the label and rounds up; the page is drawn again each second for it, and
// once more right when the wait ends.
export function useCooldown(until, total) {
  const [, redraw] = useState(0)
  const endMs = until ? Date.parse(until) : 0
  const remainingMs = Math.max(0, endMs - nowMs())

  useEffect(() => {
    const left = endMs - nowMs()
    if (!endMs || left <= 0) return undefined
    const end = setTimeout(() => redraw((count) => count + 1), left + 2)
    const label = setInterval(() => redraw((count) => count + 1), 1000)
    return () => {
      clearTimeout(end)
      clearInterval(label)
    }
  }, [endMs])

  return {
    waiting: remainingMs > 0,
    seconds: Math.ceil(remainingMs / 1000),
    until,
    total,
  }
}

// "1:45"
export function formatWait(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
