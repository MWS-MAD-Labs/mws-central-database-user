import { describe, expect, it, mock, setSystemTime } from 'bun:test'
import {
  clearClientSession,
  createClientSession,
  isClientSessionExpired,
  readClientSession,
  refreshAdminClientSession,
} from '../../../src/lib/clientSession.js'
import { dismissHint, isHintDismissed } from '../../../src/lib/pageHints.js'

const baseTime = new Date('2026-09-17T08:00:00.000Z')

describe('client session metadata', () => {
  it('creates admin and employee sessions with the configured lifetimes', () => {
    setSystemTime(baseTime)

    const admin = createClientSession({ type: 'admin' })
    expect(admin).toEqual({
      type: 'admin',
      created_at: baseTime.toISOString(),
      expires_at: new Date(baseTime.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const employee = createClientSession({ type: 'employee' })
    expect(employee.expires_at).toBe(
      new Date(baseTime.getTime() + 15 * 60 * 1000).toISOString(),
    )
    expect(readClientSession()).toEqual(employee)
  })

  it('returns null for missing users and malformed storage', () => {
    expect(createClientSession(null)).toBeNull()
    sessionStorage.setItem('mws.clientSession', '{bad-json')
    expect(readClientSession()).toBeNull()
  })

  it('refreshes only admin sessions', () => {
    setSystemTime(baseTime)
    createClientSession({ type: 'admin' })
    setSystemTime(new Date(baseTime.getTime() + 60_000))

    const refreshed = refreshAdminClientSession()
    expect(refreshed.expires_at).toBe(
      new Date(baseTime.getTime() + 60_000 + 7 * 24 * 60 * 60 * 1000).toISOString(),
    )

    createClientSession({ type: 'employee' })
    expect(refreshAdminClientSession()).toBeNull()
  })

  it('checks the exact expiration boundary', () => {
    const expiresAt = '2026-09-17T08:15:00.000Z'
    const session = { type: 'employee', expires_at: expiresAt }

    setSystemTime(new Date('2026-09-17T08:14:59.999Z'))
    expect(isClientSessionExpired(session)).toBe(false)

    setSystemTime(new Date(expiresAt))
    expect(isClientSessionExpired(session)).toBe(true)
    expect(isClientSessionExpired({ type: 'employee' })).toBe(false)
  })

  it('dispatches session-change events on writes and clear', () => {
    const listener = mock(() => {})
    window.addEventListener('mws:client-session-change', listener)

    createClientSession({ type: 'admin' })
    refreshAdminClientSession()
    clearClientSession()

    expect(listener).toHaveBeenCalledTimes(3)
    window.removeEventListener('mws:client-session-change', listener)
  })

  it('clears dismissed page hints during logout cleanup', () => {
    createClientSession({ type: 'admin' })
    dismissHint('students-list')
    expect(isHintDismissed('students-list')).toBe(true)

    clearClientSession()

    expect(readClientSession()).toBeNull()
    expect(isHintDismissed('students-list')).toBe(false)
  })
})
