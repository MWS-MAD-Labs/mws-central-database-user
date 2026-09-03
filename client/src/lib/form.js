export function dateInputFromIso(value) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toISOString().slice(0, 10)
}

export function isoFromDateInput(value) {
  if (!value) return undefined
  return new Date(`${value}T00:00:00.000Z`).toISOString()
}

export function cleanPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (value === undefined || value === '') return false
      return true
    }),
  )
}

export function trimmedOrUndefined(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function capitalizeWords(value) {
  if (typeof value !== 'string') return value
  // Also capitalize after a dash - "san-marcos" -> "San-Marcos", not
  // "San-marcos" - common in institution/place names.
  return value.replace(/(^|[\s-])\S/g, (char) => char.toUpperCase())
}

// Strips everything but digits, keeping a leading "+" if the user typed
// one - covers every phone format this app accepts (08xx, +628xx, 628xx)
// without blocking the international prefix.
export function phoneDigitsOnly(value) {
  const raw = String(value || '')
  const hasLeadingPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  return hasLeadingPlus ? `+${digits}` : digits
}

export function optionalNumber(value) {
  if (value === '' || value === undefined || value === null) return undefined
  const number = Number(value)
  return Number.isNaN(number) ? undefined : number
}

// Date <input> gives/wants "YYYY-MM-DD" - construct at noon local time so a
// timezone offset can never roll the date over to the previous/next day.
export function addMonthsToDateInput(dateInput, months) {
  if (!dateInput) return ''
  const date = new Date(`${dateInput}T12:00:00`)
  date.setMonth(date.getMonth() + Number(months))
  return date.toISOString().slice(0, 10)
}

// Mirrors server/src/validation/validation.ts's date-sanity bounds exactly
// (same constants, same logic) - client-side copy so the form can show an
// inline error immediately instead of only failing at submit. Values here
// are "YYYY-MM-DD" date-input strings, not full ISO timestamps.
const MAX_BIRTH_DATE_AGE_YEARS = 130
const MAX_JOIN_DATE_FUTURE_DAYS = 90
const MAX_FUTURE_DATE_YEARS = 50

export function isBirthDateNotFuture(dateInput) {
  if (!dateInput) return true
  return new Date(`${dateInput}T00:00:00.000Z`) <= new Date()
}

export function isBirthDateNotTooOld(dateInput) {
  if (!dateInput) return true
  const floor = new Date()
  floor.setFullYear(floor.getFullYear() - MAX_BIRTH_DATE_AGE_YEARS)
  return new Date(`${dateInput}T00:00:00.000Z`) >= floor
}

export function isWithinJoinDateFutureCap(dateInput) {
  if (!dateInput) return true
  const cap = new Date()
  cap.setDate(cap.getDate() + MAX_JOIN_DATE_FUTURE_DAYS)
  return new Date(`${dateInput}T00:00:00.000Z`) <= cap
}

export function isWithinReasonableFutureCeiling(dateInput) {
  if (!dateInput) return true
  const cap = new Date()
  cap.setFullYear(cap.getFullYear() + MAX_FUTURE_DATE_YEARS)
  return new Date(`${dateInput}T00:00:00.000Z`) <= cap
}

// Whole years elapsed between two "YYYY-MM-DD" date-input strings - not a
// naive year subtraction, so someone born Dec 2008 isn't counted as 18 the
// moment the calendar flips to 2026 in January.
export function yearsBetweenDateInputs(fromInput, toInput) {
  const from = new Date(`${fromInput}T00:00:00.000Z`)
  const to = new Date(`${toInput}T00:00:00.000Z`)
  let years = to.getFullYear() - from.getFullYear()
  const monthDiff = to.getMonth() - from.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && to.getDate() < from.getDate())) {
    years--
  }
  return years
}

// Scrolls to (and focuses, if possible) the first errored field so a
// failed submit is never silent when the actual error is scrolled off
// screen - pair with a `Field name="..."` matching each key in `errors`.
// `fieldOrder` (optional) picks which key counts as "first" when the form
// wants a specific top-to-bottom order rather than object key order.
export function scrollToFirstError(errors, fieldOrder) {
  const keys = Object.keys(errors)
  if (keys.length === 0) return
  const firstKey = fieldOrder
    ? fieldOrder.find((key) => errors[key]) ?? keys[0]
    : keys[0]

  const el = document.querySelector(`[data-field="${firstKey}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const focusable = el.querySelector('input, button, textarea, select')
  focusable?.focus({ preventScroll: true })
}

export const CONTRACT_DURATION_OPTIONS = [
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '9', label: '9 months' },
  { value: '12', label: '1 year' },
  { value: '24', label: '2 years' },
  { value: '36', label: '3 years' },
  { value: '48', label: '4 years' },
  { value: '60', label: '5 years' },
]
