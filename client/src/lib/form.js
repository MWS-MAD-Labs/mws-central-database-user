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
  return value.replace(/(^|[\s-])\S/g, (char) => char.toUpperCase())
}

export function phoneDigitsOnly(value) {
  const raw = String(value || '')
  const hasLeadingPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  return hasLeadingPlus ? `+${digits}` : digits
}

export function formatEmployeeId(value) {
  const digits = digitsOnly(value, 7)
  const groups = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 7)]
  return groups.filter(Boolean).join('.')
}

export function digitsOnly(value, maxLength) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, maxLength)
}

export function countDigits(value) {
  return String(value || '').replace(/\D/g, '').length
}

export function textLength(value) {
  return String(value || '').length
}

export function formatDigitGroups(value, groupSizes, separators) {
  const totalDigits = groupSizes.reduce((sum, size) => sum + size, 0)
  const digits = digitsOnly(value, totalDigits)
  let result = ''
  let position = 0
  for (let i = 0; i < groupSizes.length; i++) {
    const group = digits.slice(position, position + groupSizes[i])
    if (!group) break
    if (i > 0) result += separators[i - 1]
    result += group
    position += groupSizes[i]
  }
  return result
}

export function formatNik(value) {
  return formatDigitGroups(value, [4, 4, 4, 4], [' ', ' ', ' '])
}

export function formatNpwp(value) {
  return formatDigitGroups(value, [2, 3, 3, 1, 3, 3], ['.', '.', '.', '-', '.'])
}

export function formatBankAccountNumber(value) {
  return formatDigitGroups(value, [4, 4, 2], [' ', ' '])
}

export function formatBpjsNumber(value) {
  return formatDigitGroups(value, [4, 4, 4, 1], [' ', ' ', ' '])
}

export function formatBpjsEmploymentNumber(value) {
  return formatDigitGroups(value, [4, 4, 3], [' ', ' '])
}

export function formatKpjNumber(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 11)
}

export function optionalNumber(value) {
  if (value === '' || value === undefined || value === null) return undefined
  const number = Number(value)
  return Number.isNaN(number) ? undefined : number
}

export function addMonthsToDateInput(dateInput, months) {
  if (!dateInput) return ''
  const date = new Date(`${dateInput}T12:00:00`)
  date.setMonth(date.getMonth() + Number(months))
  return date.toISOString().slice(0, 10)
}

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
  floor.setUTCHours(0, 0, 0, 0)
  floor.setUTCFullYear(floor.getUTCFullYear() - MAX_BIRTH_DATE_AGE_YEARS)
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

// In create mode before the first submit attempt, only suppress errors on
// fields that are still empty - a field that already has a value but fails
// a rule check (e.g. an implausible birth date) surfaces immediately.
export function visibleErrors(allErrors, values, { isCreate, hasAttemptedSubmit }) {
  if (!isCreate || hasAttemptedSubmit) return allErrors
  return Object.fromEntries(
    Object.entries(allErrors).filter(([field]) => hasValue(values[field])),
  )
}

function hasValue(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

export function buildFixFieldsTooltip(errors, { maxItems = 3 } = {}) {
  const messages = Object.values(errors).filter(Boolean)
  if (messages.length === 0) return undefined
  const shown = messages.slice(0, maxItems)
  const remainder = messages.length - shown.length
  return `Fix before saving: ${shown.join(' ')}${remainder > 0 ? ` (+${remainder} more)` : ''}`
}

export const CONTRACT_DURATION_OPTIONS = [
  { value: '3', label: '3 Months' },
  { value: '6', label: '6 Months' },
  { value: '9', label: '9 Months' },
  { value: '12', label: '1 Year' },
  { value: '24', label: '2 Years' },
  { value: '36', label: '3 Years' },
  { value: '48', label: '4 Years' },
  { value: '60', label: '5 Years' },
]

// One rule for every email: before the @ only lowercase letters, digits and the separators . _ -, and a separator never
// starts, ends or doubles up. No + % ' or spaces. Mirrors server/src/validation/validation.ts.
const CLEAN_LOCAL_PART = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
// At someone else's provider (a parent, a recovery email) a +label is fine: Gmail and others deliver it to the plain
// mailbox. A Google Workspace account name of ours may not have one.
const CLEAN_EXTERNAL_LOCAL_PART = /^[a-z0-9]+(?:[._+-][a-z0-9]+)*$/
const CLEAN_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

// What is typed in the part before the @: lowercase, only the allowed characters, no separator at the start and no two
// in a row. A separator at the end is allowed while typing; emailProblem catches it when the form is checked.
export function sanitizeEmailLocalPart(value, { external = false } = {}) {
  const separators = external ? '._+-' : '._-'
  return String(value || '')
    .toLowerCase()
    .replace(external ? /[^a-z0-9._+-]/g : /[^a-z0-9._-]/g, '')
    .replace(external ? /^[._+-]+/ : /^[._-]+/, '')
    .replace(external ? /([._+-])[._+-]+/g : /([._-])[._-]+/g, '$1')
}

// A whole email typed freely (parents, recovery): the local part may also carry a +label, and a domain of letters, digits,
// dots and hyphens.
export function sanitizeEmail(value) {
  const text = String(value || '').toLowerCase().replace(/\s/g, '')
  const at = text.indexOf('@')
  if (at === -1) return sanitizeEmailLocalPart(text, { external: true })
  const domain = text.slice(at + 1).replace(/[^a-z0-9.-]/g, '')
  return `${sanitizeEmailLocalPart(text.slice(0, at), { external: true })}@${domain}`
}

// What is wrong with an email, in plain words, or null when it is fine (or empty: whether it is needed is another rule).
export function emailProblem(value, { external = false } = {}) {
  const email = String(value || '').trim().toLowerCase()
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return 'Enter a full email address.'
  if (!(external ? CLEAN_EXTERNAL_LOCAL_PART : CLEAN_LOCAL_PART).test(email.slice(0, at))) {
    return external
      ? 'Use only letters, numbers, dots, underscores, hyphens and + before the @, with none at the start, the end or twice in a row.'
      : 'Use only letters, numbers, dots, underscores and hyphens before the @, with none at the start, the end or twice in a row.'
  }
  if (!CLEAN_DOMAIN.test(email.slice(at + 1))) return 'The part after the @ is not a valid domain.'
  return null
}
