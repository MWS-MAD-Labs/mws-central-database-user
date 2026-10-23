import { describe, expect, it } from 'bun:test'
import { emailsMatch } from '../../../src/features/google/utils/emailDomains.js'

describe('emailsMatch', () => {
  it('takes only the name for a first email on a common domain', () => {
    expect(emailsMatch('budi@hotmail.com', 'budi')).toBe(true)
    expect(emailsMatch('Budi@Hotmail.com', 'budi')).toBe(true)
    expect(emailsMatch('budi@hotmail.com', 'budo')).toBe(false)
  })

  it('takes the whole address, and wants it whole for any other domain', () => {
    expect(emailsMatch('budi@hotmail.com', 'budi@hotmail.com')).toBe(true)
    expect(emailsMatch('budi@hotmail.com', 'budi@gmail.com')).toBe(false)
    expect(emailsMatch('budi@sekolah.sch.id', 'budi@sekolah.sch.id')).toBe(true)
    expect(emailsMatch('budi@sekolah.sch.id', 'budi')).toBe(false)
  })

  it('does not match when either is empty', () => {
    expect(emailsMatch('', '')).toBe(false)
    expect(emailsMatch('budi@gmail.com', '')).toBe(false)
  })
})
