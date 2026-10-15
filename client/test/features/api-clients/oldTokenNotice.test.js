import { describe, expect, it } from 'bun:test'
import { oldTokenNotice } from '../../../src/features/api-clients/utils/oldTokenNotice.js'

const now = Date.parse('2026-10-08T12:00:00.000Z')
const graceful = {
  credentials: [
    { token_prefix: 'mws_new', status: 'ACTIVE', expires_at: null },
    { token_prefix: 'mws_old', status: 'RETIRING', expires_at: '2026-10-09T12:00:00.000Z' },
  ],
}
const emergency = {
  credentials: [
    { token_prefix: 'mws_new', status: 'ACTIVE', expires_at: null, revoked_at: null },
    { token_prefix: 'mws_old', status: 'REVOKED', expires_at: '2026-10-08T12:00:00.000Z', revoked_at: '2026-10-08T12:00:00.000Z' },
    { token_prefix: 'mws_ancient', status: 'REVOKED', expires_at: '2026-01-01T00:00:00.000Z', revoked_at: '2026-01-01T00:00:00.000Z' },
  ],
}

describe('oldTokenNotice', () => {
  it('tells until when the old token is valid after a graceful rotation', () => {
    const notice = oldTokenNotice(graceful, 'graceful', now)
    expect(notice.tone).toBe('warning')
    expect(notice.text).toContain('mws_old')
    expect(notice.text).toContain('in about 24 hours')
    expect(notice.text).toMatch(/09 Oct 2026/)
  })

  it('says the old token stopped after an emergency rotation, naming the latest one', () => {
    const notice = oldTokenNotice(emergency, 'emergency', now)
    expect(notice.tone).toBe('danger')
    expect(notice.text).toContain('mws_old')
    expect(notice.text).not.toContain('mws_ancient')
  })

  it('says nothing for a new client, or when the response does not tell', () => {
    expect(oldTokenNotice(graceful, undefined, now)).toBeNull()
    expect(oldTokenNotice({ credentials: [{ token_prefix: 'mws_new', status: 'ACTIVE' }] }, 'graceful', now)).toBeNull()
    expect(oldTokenNotice({ credentials: [] }, 'emergency', now)).toBeNull()
    expect(oldTokenNotice({}, 'graceful', now)).toBeNull()
  })

  it('counts minutes when the grace is short', () => {
    const client = { credentials: [{ token_prefix: 'mws_old', status: 'RETIRING', expires_at: '2026-10-08T12:30:00.000Z' }] }
    expect(oldTokenNotice(client, 'graceful', now).text).toContain('in 30 minutes')
  })
})
