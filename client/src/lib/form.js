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

export function optionalNumber(value) {
  if (value === '' || value === undefined || value === null) return undefined
  const number = Number(value)
  return Number.isNaN(number) ? undefined : number
}
