// The domains most people use, so the part after @ is one pick. Anything else (an organization's own mail) is typed.
export const COMMON_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'yahoo.co.id', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me']

export const domainOf = (value) => (value.includes('@') ? value.slice(value.indexOf('@') + 1) : '')
export const localOf = (value) => (value.includes('@') ? value.slice(0, value.indexOf('@')) : value)

// Whether the second typing of an email is the first. When the first one is on a common domain the second is only the
// name, since the domain was a pick; any other domain is typed whole both times.
export function emailsMatch(primary, confirm) {
  const first = String(primary || '').trim().toLowerCase()
  const second = String(confirm || '').trim().toLowerCase()
  if (!first || !second) return false
  if (first === second) return true
  return !second.includes('@') && COMMON_EMAIL_DOMAINS.includes(domainOf(first)) && localOf(first) === second
}
