import { describe, expect, it } from 'bun:test'
import { connectionState } from '../../../src/features/application-access/utils/connectionState.js'

const recent = () => new Date(Date.now() - 3 * 60_000).toISOString()

describe('connectionState', () => {
  it('blinks green when connected and says when it last called', () => {
    expect(connectionState({ link: false, health: { status: 'healthy' }, connection: { created: true, last_used_at: recent() } })).toMatchObject({
      tone: 'green',
      pulse: true,
      label: 'Connected',
      note: 'Last Call 3 Minutes Ago',
    })
  })

  it('blinks amber while waiting for the first call or for an update', () => {
    expect(connectionState({ link: false, health: { status: 'pending' }, connection: { created: true, last_used_at: null } })).toMatchObject({ tone: 'amber', pulse: true, label: 'Waiting For First Call' })
    expect(connectionState({ link: false, health: { status: 'token_pending' }, connection: { created: true, last_used_at: recent() } })).toMatchObject({ tone: 'amber', pulse: true, label: 'Update Pending' })
    expect(connectionState({ link: false, health: { status: 'sign_in_pending' }, connection: { created: true, last_used_at: recent() } })).toMatchObject({ label: 'Update Pending', note: 'Waiting For The New Sign-In Way' })
  })

  it('stays still for a problem, a plain link or no connection', () => {
    expect(connectionState({ link: false, health: { status: 'check_token' }, connection: { created: true, last_used_at: recent() } })).toMatchObject({ tone: 'amber', pulse: false, label: 'Check Token' })
    expect(connectionState({ link: false, health: { status: 'unreachable' }, connection: { created: true, last_used_at: recent() } })).toMatchObject({ tone: 'red', pulse: false, label: 'Unreachable' })
    expect(connectionState({ link: false, health: { status: 'wrong_path' }, connection: { created: true, last_used_at: recent() } })).toMatchObject({ tone: 'amber', pulse: false, label: 'Wrong Path' })
    expect(connectionState({ link: true, health: null, connection: { created: false, last_used_at: null } })).toMatchObject({ tone: 'grey', label: 'Plain Link' })
    expect(connectionState({ link: false, health: null, connection: { created: false, last_used_at: null } })).toMatchObject({ tone: 'grey', pulse: false, label: 'Not Connected' })
  })
})
