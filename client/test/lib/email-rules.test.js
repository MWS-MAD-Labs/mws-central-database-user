import { describe, expect, it } from 'bun:test'
import { emailProblem, sanitizeEmail, sanitizeEmailLocalPart } from '../../src/lib/form.js'

describe('typing an email', () => {
  it('keeps only lowercase letters, digits and single separators in the local part', () => {
    expect(sanitizeEmailLocalPart('Ari.Employee')).toBe('ari.employee')
    expect(sanitizeEmailLocalPart('a+b%c')).toBe('abc')
    expect(sanitizeEmailLocalPart('a..b__c--d')).toBe('a.b_c-d')
    expect(sanitizeEmailLocalPart('.-_a')).toBe('a')
    expect(sanitizeEmailLocalPart("o'neil")).toBe('oneil')
  })

  it('applies the same to a whole email and keeps a plain domain', () => {
    expect(sanitizeEmail('Budi+Tag@Gmail.com')).toBe('banditag@gmail.com'.replace('bandi', 'budi'))
    expect(sanitizeEmail(' me @ x.id ')).toBe('me@x.id')
  })
})

describe('emailProblem', () => {
  it('has nothing to say about an empty or a good email', () => {
    expect(emailProblem('')).toBeNull()
    expect(emailProblem('a.b-c_d9@mail.co.id')).toBeNull()
  })

  it('names the problem of a bad one', () => {
    for (const email of ['a+b@x.id', 'a..b@x.id', '.a@x.id', 'a.@x.id', 'a@x', 'a@', '@x.id', 'a b@x.id']) {
      expect(emailProblem(email)).not.toBeNull()
    }
  })
})
