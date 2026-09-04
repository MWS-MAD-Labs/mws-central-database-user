// Dismissed page hints, one id per hint - sessionStorage so it follows the
// same lifecycle as clientSession.js's own session (per-tab, cleared on
// logout via clearClientSession, gone on tab close). A hint dismissed this
// login resurfaces on the next one instead of disappearing for good.
const STORAGE_KEY = 'mws.dismissedHints'

function readDismissed() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function isHintDismissed(id) {
  return readDismissed().includes(id)
}

export function dismissHint(id) {
  if (typeof window === 'undefined') return
  const current = readDismissed()
  if (current.includes(id)) return
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...current, id]))
}

export function clearDismissedHints() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(STORAGE_KEY)
}
