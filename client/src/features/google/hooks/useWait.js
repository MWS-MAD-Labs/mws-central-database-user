import { useEffect, useState } from 'react'

const nowMs = () => Date.now()

// Seconds left until an ISO time, counting down while the page is open. 0 when there is none or it has passed.
export function useWaitSeconds(until) {
  // Only the timer changes this, to draw the page again each second; the time itself is read when drawing.
  const [, tick] = useState(0)
  const left = until ? Math.max(0, Math.ceil((Date.parse(until) - nowMs()) / 1000)) : 0

  useEffect(() => {
    if (!until || Date.parse(until) <= nowMs()) return undefined
    const timer = setInterval(() => tick((count) => count + 1), 1000)
    return () => clearInterval(timer)
  }, [until])

  return left
}

// "1:45"
export function formatWait(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
