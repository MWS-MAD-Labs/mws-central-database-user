import { describe, expect, it } from 'bun:test'
import { getUserDisplayName } from '../../src/lib/session.js'

describe('getUserDisplayName', () => {
  it('puts a capital on the first letter of each word', () => {
    expect(getUserDisplayName({ full_name: 'madlabs admin' })).toBe('Madlabs Admin')
    expect(getUserDisplayName({ identity: { full_name: "dewi o'neil-sari" } })).toBe("Dewi O'Neil-Sari")
  })

  it('keeps the capitals that are already there', () => {
    expect(getUserDisplayName({ full_name: 'Taylor McDonald' })).toBe('Taylor McDonald')
  })

  it('falls back to the start of the email, then to User', () => {
    expect(getUserDisplayName({ email: 'madlabs@millennia21.id' })).toBe('Madlabs')
    expect(getUserDisplayName(null)).toBe('User')
  })
})
