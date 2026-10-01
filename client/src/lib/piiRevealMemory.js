const REVEAL_MEMORY_MS = 5 * 60 * 1000

export function hasRecentReveal(scopeKey) {
  try {
    const raw = sessionStorage.getItem(`pii-reveal:${scopeKey}`)
    if (!raw) return false
    return Date.now() - Number(raw) < REVEAL_MEMORY_MS
  } catch {
    return false
  }
}

export function forgetReveal(scopeKey) {
  try {
    sessionStorage.removeItem(`pii-reveal:${scopeKey}`)
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

export function rememberReveal(scopeKey) {
  try {
    sessionStorage.setItem(`pii-reveal:${scopeKey}`, String(Date.now()))
  } catch {
    // Storage may be unavailable in private browsing.
  }
}
