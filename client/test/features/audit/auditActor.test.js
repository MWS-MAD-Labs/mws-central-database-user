import { describe, expect, it } from 'bun:test'
import { auditActor } from '../../../src/features/audit/utils/auditActor.js'

describe('auditActor', () => {
  it('shows an admin by name with the role under it', () => {
    expect(auditActor({ admin: { email: 'a@millennia21.id', full_name: 'Ari Admin', role: 'SUPER_ADMIN' } })).toEqual({
      primary: 'Ari Admin',
      secondary: 'Super Admin',
      title: 'a@millennia21.id',
    })
  })

  it('falls back to the email when an admin has no name', () => {
    expect(auditActor({ admin: { email: 'a@millennia21.id', role: 'VIEWER' } }).primary).toBe('a@millennia21.id')
  })

  it('shortens the connection client of an application to its name, purpose and environment', () => {
    const actor = auditActor({ api_client: { name: 'MTSS (DEVELOPMENT/app-connection)', token_prefix: 'mws_ab12cd' } })
    expect(actor.primary).toBe('MTSS')
    expect(actor.secondary).toBe('App connection · Development · mws_ab12cd')
    expect(actor.title).toBe('MTSS (DEVELOPMENT/app-connection)')
  })

  it('reads a retired or removed connection client as its application, and marks a deleted one', () => {
    const actor = auditActor({
      api_client: {
        name: 'MTSS (DEVELOPMENT/app-connection) (retired 2026-10-21T04:42:21.217Z) (removed 2026-10-21T04:42:26.639Z)',
        token_prefix: 'mws_old1',
        deleted: true,
      },
    })
    expect(actor.primary).toBe('MTSS')
    expect(actor.secondary).toBe('App connection · Development · mws_old1 · Deleted')
  })

  it('keeps the name of a client that does not follow the server pattern', () => {
    const actor = auditActor({ api_client: { name: 'Old Reporting Tool', token_prefix: 'mws_x' } })
    expect(actor.primary).toBe('Old Reporting Tool')
    expect(actor.secondary).toBe('mws_x')
  })

  it('names the profile of a backend client and handles a purpose written in words', () => {
    expect(auditActor({ api_client: { name: 'Exima (STAGING/roster-sync)', token_prefix: 'mws_r' } }).secondary).toBe(
      'Roster sync · Staging · mws_r',
    )
  })

  it('says System when nobody is behind the entry', () => {
    expect(auditActor({})).toEqual({ primary: 'System', secondary: '-', title: 'System' })
  })
})
