// Addresses are typed without http or https. The environment adds it: Local is http, Production is https.
export const ENVIRONMENTS = [
  { id: 'production', label: 'Production', scheme: 'https://' },
  { id: 'local', label: 'Local', scheme: 'http://' },
]

const SCHEME = /^(https?):\/\//i
const PRIVATE_IPV4 = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
const REST = /^[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?([/?#][A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*)?$/

// A stored address into its environment and the part after the scheme.
export function splitAddress(url, fallback = 'production') {
  const match = (url || '').trim().match(SCHEME)
  if (!match) return { environment: fallback, rest: (url || '').trim() }
  return { environment: match[1].toLowerCase() === 'http' ? 'local' : 'production', rest: url.trim().slice(match[0].length) }
}

// What was typed, with a pasted scheme taken off. A scheme in the text decides the environment.
export function readAddressInput(value, environment) {
  const match = value.match(SCHEME)
  if (!match) return { environment, rest: value }
  return { environment: match[1].toLowerCase() === 'http' ? 'local' : 'production', rest: value.slice(match[0].length) }
}

export function joinAddress(environment, rest) {
  const text = rest.trim()
  if (!text) return ''
  return `${ENVIRONMENTS.find((item) => item.id === environment)?.scheme ?? 'https://'}${text}`
}

export function isLocalHost(hostname) {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.test') ||
    !host.includes('.') ||
    PRIVATE_IPV4.test(host)
  )
}

export function addressProblem(environment, rest, { required = false } = {}) {
  const text = rest.trim()
  if (!text) return required ? 'Address is required.' : null
  if (/\s/.test(text)) return 'No spaces allowed.'
  if (text.split(/[/?#]/)[0].includes('@')) return 'Leave the user name and password out.'
  if (!REST.test(text)) return 'Use a host like exima.mws.web.id, then the path. Letters, numbers and the usual address symbols only.'
  const host = text.split(/[/?#:]/)[0]
  if (environment === 'local' && !isLocalHost(host)) return 'Local addresses use http. Pick Production for a public address.'
  if (joinAddress(environment, text).length > 300) return 'Address is too long.'
  return null
}
