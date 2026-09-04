import { clearDismissedHints } from './pageHints.js'

const SESSION_KEY = 'mws.clientSession'
const ADMIN_SESSION_MS = 7 * 24 * 60 * 60 * 1000
const EMPLOYEE_SESSION_MS = 15 * 60 * 1000

export function createClientSession(user) {
  if (!user) return null

  const now = Date.now()
  const expiresAt =
    now + (user.type === 'admin' ? ADMIN_SESSION_MS : EMPLOYEE_SESSION_MS)
  const session = {
    type: user.type,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
  }

  writeClientSession(session)
  return session
}

export function refreshAdminClientSession() {
  const session = readClientSession()
  if (session?.type !== 'admin') return null

  const nextSession = {
    ...session,
    expires_at: new Date(Date.now() + ADMIN_SESSION_MS).toISOString(),
  }
  writeClientSession(nextSession)
  return nextSession
}

export function readClientSession() {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearClientSession() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(SESSION_KEY)
  clearDismissedHints()
  window.dispatchEvent(new Event('mws:client-session-change'))
}

export function isClientSessionExpired(session = readClientSession()) {
  if (!session?.expires_at) return false
  return new Date(session.expires_at).getTime() <= Date.now()
}

function writeClientSession(session) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  window.dispatchEvent(new Event('mws:client-session-change'))
}
