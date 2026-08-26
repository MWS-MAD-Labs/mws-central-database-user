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
