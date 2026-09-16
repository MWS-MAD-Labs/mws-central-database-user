// Mirrors lookup-cache.ts's TTL_SECONDS (300s) - the backend's own dedupe
// window for every PII/sensitive-data access log (EmployeeService.
// recordPiiAccess, HealthRecordService/HealthNoteService/VaccineRecordService's
// list/get methods), so "was this recently revealed" matches what the
// backend would actually do with a fresh request instead of always
// claiming a fresh log entry in the confirm dialog even when the backend
// is about to silently skip writing one.
//
// Shared across Employee (PII reveal on the Detail page, auto-logged on
// the Edit page) and Student (Health/Vaccine "Show" panels) - same
// dedupe window, same "closing and reopening within a few minutes is
// really the same viewing session" reasoning, just scoped by a different
// resource key per caller (e.g. "employee:<id>", "student-health:<id>").
const REVEAL_MEMORY_MS = 5 * 60 * 1000

export function hasRecentReveal(scopeKey) {
  try {
    const raw = sessionStorage.getItem(`pii-reveal:${scopeKey}`)
    if (!raw) return false
    return Date.now() - Number(raw) < REVEAL_MEMORY_MS
  } catch {
    // Private browsing / storage blocked - just means the confirm dialog
    // shows every time, same as before this existed.
    return false
  }
}

export function rememberReveal(scopeKey) {
  try {
    sessionStorage.setItem(`pii-reveal:${scopeKey}`, String(Date.now()))
  } catch {
    // Nothing to remember, nothing to do about it.
  }
}
