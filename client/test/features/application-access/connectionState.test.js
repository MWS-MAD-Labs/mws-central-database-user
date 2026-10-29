import { describe, expect, it } from 'bun:test'
import { addressState, connectionState, overallState } from '../../../src/features/application-access/utils/connectionState.js'

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

describe('overallState', () => {
  const live = { created: true, last_used_at: recent() }
  const healthy = { status: 'healthy' }

  it('is grey for a plain link', () => {
    expect(overallState({ link: true, health: healthy, connection: live })).toMatchObject({ tone: 'grey', label: 'Plain Link' })
  })

  it('keeps the token wording while the token is not live yet', () => {
    expect(overallState({ link: false, health: healthy, connection: { created: false, last_used_at: null } })).toMatchObject({ label: 'Not Connected' })
    expect(overallState({ link: false, health: healthy, connection: { created: true, last_used_at: null } })).toMatchObject({ label: 'Waiting For First Call' })
    expect(overallState({ link: false, health: { status: 'check_token' }, connection: live })).toMatchObject({ label: 'Check Token' })
    expect(overallState({ link: false, health: { status: 'token_pending' }, connection: live })).toMatchObject({ label: 'Update Pending' })
  })

  it('is red when the token calls but the sign-in address does not answer', () => {
    const state = overallState({ link: false, health: { status: 'unreachable' }, connection: live })
    expect(state).toMatchObject({ tone: 'red', label: 'Needs Attention' })
    expect(state.note).toMatch(/does not answer/)
    expect(overallState({ link: false, health: healthy, connection: live, address: { status: 'unreachable' } })).toMatchObject({ tone: 'red' })
  })

  it('is amber when the sign-in page is not at the address', () => {
    expect(overallState({ link: false, health: { status: 'wrong_path' }, connection: live })).toMatchObject({ tone: 'amber', label: 'Needs Attention' })
  })

  it('is working when the token calls and the address answers', () => {
    const state = overallState({ link: false, health: healthy, connection: live, address: { status: 'ok' } })
    expect(state).toMatchObject({ tone: 'green', label: 'Working' })
    expect(state.note).toMatch(/Address Answers/)
  })

  it('adds nothing about the address when it was never checked', () => {
    expect(overallState({ link: false, health: healthy, connection: live }).note).not.toMatch(/Address/)
  })

  it('does not check an address for the Hub', () => {
    const state = overallState({ link: false, isHub: true, health: { status: 'unreachable' }, connection: live })
    expect(state).toMatchObject({ label: 'Working' })
    expect(state.note).not.toMatch(/Sign-In Address/)
  })

  it('is quiet when the token has not been used for a week', () => {
    const old = { created: true, last_used_at: new Date(Date.now() - 9 * 24 * 3600_000).toISOString() }
    expect(overallState({ link: false, health: healthy, connection: old, address: { status: 'ok' } })).toMatchObject({ tone: 'amber', label: 'Quiet' })
  })
})
