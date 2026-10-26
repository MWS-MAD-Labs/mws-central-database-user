// The same rule the server keeps: a real domain can be shared by path, a port on a local host belongs to one application.
function parse(address) {
  try {
    return address ? new URL(address) : null
  } catch {
    return null
  }
}

const pathOf = (url) => url.pathname.replace(/\/+$/, '') + url.search

export function isLocalHost(address) {
  const url = parse(address)
  if (!url) return false
  const host = url.hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')
}

// What the address means next to the other live applications: { type: 'taken' | 'port' | 'domain', name }, or null.
export function addressClash(address, others, selfId) {
  const url = parse(address)
  if (!url) return null
  const live = others.filter((other) => !other.retired && other.application_id !== selfId && parse(other.launch_url))
  const same = live.find((other) => {
    const found = parse(other.launch_url)
    return found.origin === url.origin && pathOf(found) === pathOf(url)
  })
  if (same) return { type: 'taken', name: same.name }
  const origin = live.find((other) => parse(other.launch_url).origin === url.origin)
  if (!origin) return null
  return { type: isLocalHost(address) ? 'port' : 'domain', name: origin.name }
}
