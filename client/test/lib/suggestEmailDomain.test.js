import { describe, expect, it } from 'bun:test'
import { suggestEmailDomain } from '../../src/lib/form.js'

describe('suggestEmailDomain', () => {
  it('fixes a misspelt popular domain, keeping the name', () => {
    expect(suggestEmailDomain('budi@gmial.com')).toBe('budi@gmail.com')
    expect(suggestEmailDomain('budi@gmail.co')).toBe('budi@gmail.com')
    expect(suggestEmailDomain('budi@yahooo.com')).toBe('budi@yahoo.com')
    expect(suggestEmailDomain('Budi@Outlok.com')).toBe('budi@outlook.com')
  })

  it('says nothing for a right domain, an unrelated one, or an unfinished address', () => {
    expect(suggestEmailDomain('budi@gmail.com')).toBeNull()
    expect(suggestEmailDomain('budi@sekolahku.sch.id')).toBeNull()
    expect(suggestEmailDomain('budi@gm')).toBeNull()
    expect(suggestEmailDomain('budi')).toBeNull()
    expect(suggestEmailDomain('')).toBeNull()
  })
})
