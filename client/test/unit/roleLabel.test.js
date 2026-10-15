import { describe, expect, it } from 'bun:test'
import { cleanLabelInput, labelProblem, titleCase } from '../../src/features/application-access/utils/roleLabel.js'

describe('role label', () => {
  it('drops symbols and doubled spaces while typing', () => {
    expect(cleanLabelInput('Staff-IT!')).toBe('StaffIT')
    expect(cleanLabelInput('  Support   Staff')).toBe('Support Staff')
    expect(cleanLabelInput('Guru 😀 Kelas')).toBe('Guru Kelas')
  })

  it('gives every word a capital and leaves the rest as typed', () => {
    expect(titleCase('support staff')).toBe('Support Staff')
    expect(titleCase('IT support')).toBe('IT Support')
    expect(cleanLabelInput('guru kelas 2')).toBe('Guru Kelas 2')
    expect(cleanLabelInput('cashier ')).toBe('Cashier ')
  })

  it('accepts plain words and refuses anything else', () => {
    expect(labelProblem('Guru Kelas 2')).toBeNull()
    expect(labelProblem('Wali Murid é')).toBeNull()
    expect(labelProblem('')).toBe('Label is required.')
    expect(labelProblem('Staff_IT')).toMatch(/only have letters/)
    expect(labelProblem('Staff  IT')).toMatch(/only have letters/)
  })
})
