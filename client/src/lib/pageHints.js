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
