// Addresses are typed without http or https. The environment adds it: Local is http, Production is https.
export const ENVIRONMENTS = [
  { id: 'production', label: 'Public HTTPS', scheme: 'https://' },
  { id: 'local', label: 'Local HTTP', scheme: 'http://' },
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

// What was typed, tidied. Leading spaces go, a pasted http:// or https:// (any case, even twice) is taken off
// and reported as `scheme`, a leading // goes, and the host is written in lower case.
export function readAddressInput(value, environment) {
  let text = value.replace(/^\s+/, '')
  let scheme = null
  for (let match = text.match(SCHEME); match; match = text.match(SCHEME)) {
    scheme = scheme ?? match[1].toLowerCase()
    text = text.slice(match[0].length).replace(/^\s+/, '')
  }
  text = text.replace(/^\/\/+/, '')
  const end = text.search(/[/?#]/)
  const host = end === -1 ? text : text.slice(0, end)
  text = host.toLowerCase() + (end === -1 ? '' : text.slice(end))
  return { environment, rest: text, scheme }
}

export const environmentOfScheme = (scheme) => (scheme === 'http' ? 'local' : 'production')

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
  if (!REST.test(text)) return 'Use a host like application.example.com, then the path. Letters, numbers and the usual address symbols only.'
  const host = text.split(/[/?#:]/)[0]
  if (environment === 'local' && !isLocalHost(host)) return 'Local addresses use http. Pick Public HTTPS for a public address.'
  if (joinAddress(environment, text).length > 300) return 'Address is too long.'
  return null
}

// What the empty address box shows. Local uses the machine and a port, Production a real host.
export function addressPlaceholder(environment, path) {
  return `${environment === 'local' ? 'localhost:3000' : 'application.example.com'}${path}`
}

// The address of the Hub is an origin: nothing after the host and port.
export function hubAddressProblem(environment, rest) {
  const text = rest.trim()
  if (/[/?#]/.test(text)) return 'Use only the public Hub address, with nothing after the host.'
  const problem = addressProblem(environment, text, { required: true })
  if (problem) return problem
  // A public Hub has a public name. Something that only exists on one machine would not work for anyone else.
  if (environment === 'production' && isLocalHost(text.split(':')[0])) {
    return 'That is a local address. Pick Local, or type the public address of the Hub.'
  }
  return null
}
