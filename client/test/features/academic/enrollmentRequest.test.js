import { describe, expect, it } from 'bun:test'
import { bulkEnrollmentRequest } from '../../../src/features/academic/utils/enrollmentRequest.js'

describe('bulkEnrollmentRequest', () => {
  const payload = { class_id: 'class-1', academic_year_id: 'year-1' }

  it('tells the server an SE teacher is coming when one was chosen', () => {
    expect(bulkEnrollmentRequest(['s1', 's2'], payload, { employee_id: 'e1' })).toEqual({
      student_ids: ['s1', 's2'],
      class_id: 'class-1',
      academic_year_id: 'year-1',
      requires_special_education: true,
    })
  })

  it('sends a plain enrollment when no teacher was chosen', () => {
    expect(bulkEnrollmentRequest(['s1'], payload, null)).toEqual({ student_ids: ['s1'], ...payload })
  })
})
