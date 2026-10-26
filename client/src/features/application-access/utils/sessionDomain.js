// Whether an application sits under the same parent domain as the Hub. The shared session is a cookie on that parent
// domain, so it only reaches applications under it.

// Second level suffixes that are not a domain anyone can own, so the name in front of them is the registrable one.
const SECOND_LEVEL = new Set([
  'co.id', 'ac.id', 'or.id', 'go.id', 'sch.id', 'web.id', 'my.id', 'biz.id', 'net.id', 'mil.id', 'desa.id', 'ponpes.id',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.sg', 'com.my',
])

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

function hostOf(address) {
  try {
    return new URL(address).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// The part of a host a person can register, like mws.web.id for app.mws.web.id. A single name (localhost) and an IP
// address stand for themselves.
export function registrableDomain(host) {
  const name = (host || '').toLowerCase().replace(/\.$/, '')
  if (!name || IPV4.test(name) || !name.includes('.')) return name
  const labels = name.split('.')
  const take = SECOND_LEVEL.has(labels.slice(-2).join('.')) ? 3 : 2
  return labels.slice(-take).join('.')
}

// null when either address is missing or not an address, so nothing is claimed about it.
export function sameParentDomain(hubAddress, appAddress) {
  const hub = hostOf(hubAddress)
  const app = hostOf(appAddress)
  if (!hub || !app) return null
  return registrableDomain(hub) === registrableDomain(app)
}

export function parentDomainOf(address) {
  return registrableDomain(hostOf(address))
}

// A host with no domain to share a cookie under: localhost, a single name or an IP address.
export function isBareHost(address) {
  const host = hostOf(address)
  return Boolean(host) && (IPV4.test(host) || !host.includes('.'))
}

// The cookie is kept per host name, and the port does not count.
export const BARE_HOST_ADVICE =
  'A cookie is kept per host name, so open the Hub and the application through the same one, for example localhost for both. The port does not matter.'

// The page people open. A standard sign-in path (/auth/sso) is cut off and the path in front of it is kept, like
// /daily-checkin/. A sign-in path under /api (like /api/v1/auth/sso) or any other path belongs to an API, so the page is the root
// of the host.
export function appHomeUrl(launchUrl) {
  if (!launchUrl) return ''
  try {
    const url = new URL(launchUrl)
    url.pathname = /\/auth\/sso\/?$/.test(url.pathname) && !/^\/api(\/|$)/.test(url.pathname) ? url.pathname.replace(/\/auth\/sso\/?$/, '/') || '/' : '/'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

// The same warning as words for a confirmation.
export function differentDomainText(name, hubAddress, appAddress) {
  if (isBareHost(hubAddress) || isBareHost(appAddress)) {
    return `${name} is at ${parentDomainOf(appAddress)} and the Hub is at ${parentDomainOf(hubAddress)}. The Hub's session cookie does not reach it. ${BARE_HOST_ADVICE} Switch only if you know why.`
  }
  return `${name} is under ${parentDomainOf(appAddress)} and the Hub is under ${parentDomainOf(hubAddress)}. The Hub's session cookie does not reach it, so people cannot sign in with the shared session and signing out of the Hub does not end its session. Switch only if you know why.`
}
