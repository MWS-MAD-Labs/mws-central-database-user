import { describe, expect, it } from 'bun:test'
import { addressState, connectionState } from '../../../src/features/application-access/utils/connectionState.js'

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
    expect(connectionState({ link: true, health: null, connection: { created: false, last_used_at: null } })).toMatchObject({ tone: 'grey', label: 'Plain Link' })
    expect(connectionState({ link: false, health: null, connection: { created: false, last_used_at: null } })).toMatchObject({ tone: 'grey', pulse: false, label: 'Not Connected' })
  })
})

describe('addressState', () => {
  it('says what the last check of the sign-in address found, apart from the token', () => {
    expect(addressState({ link: false, isHub: false, address: { status: 'ok' } })).toMatchObject({ tone: 'green', label: 'Answers' })
    expect(addressState({ link: false, isHub: false, address: { status: 'wrong_path' } })).toMatchObject({ tone: 'amber', label: 'Wrong Path' })
    expect(addressState({ link: false, isHub: false, address: { status: 'unreachable' } })).toMatchObject({ tone: 'red', label: 'Not Answering' })
    expect(addressState({ link: false, isHub: false, address: { status: 'unverifiable' } })).toMatchObject({ tone: 'grey', label: 'Cannot Tell' })
    expect(addressState({ link: false, isHub: false, address: null })).toMatchObject({ label: 'Not Checked Yet' })
    expect(addressState({ link: true, isHub: false, address: null })).toBeNull()
    expect(addressState({ link: false, isHub: true, address: null })).toBeNull()
  })

  it('keeps the token line as it was while the address is wrong', () => {
    const connection = { created: true, last_used_at: recent() }
    expect(connectionState({ link: false, health: { status: 'wrong_path' }, connection })).toMatchObject({ label: 'Connected' })
  })
})
