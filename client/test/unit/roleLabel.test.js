import { describe, expect, it } from 'bun:test'
import { cleanLabelInput, labelProblem } from '../../src/features/application-access/utils/roleLabel.js'

describe('role label', () => {
  it('drops symbols and doubled spaces while typing', () => {
    expect(cleanLabelInput('Staff-IT!')).toBe('StaffIT')
    expect(cleanLabelInput('  Support   Staff')).toBe('Support Staff')
    expect(cleanLabelInput('Guru 😀 Kelas')).toBe('Guru Kelas')
  })

  it('accepts plain words and refuses anything else', () => {
    expect(labelProblem('Guru Kelas 2')).toBeNull()
    expect(labelProblem('Wali Murid é')).toBeNull()
    expect(labelProblem('')).toBe('Label is required.')
    expect(labelProblem('Staff_IT')).toMatch(/only have letters/)
    expect(labelProblem('Staff  IT')).toMatch(/only have letters/)
  })
})
