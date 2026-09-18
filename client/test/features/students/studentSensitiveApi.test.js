import { describe, expect, it, mock } from 'bun:test'
import { ApiError } from '../../../src/lib/api.js'
import {
  bloodTypes,
  consentStatuses,
  consentTypes,
  healthNoteCategories,
  parentTypes,
  pcDays,
  studentSensitiveApi,
  studentSupportRoles,
  vaccineTypes,
} from '../../../src/features/students/api/studentSensitiveApi.js'
import { jsonResponse } from '../../helpers/http.js'

describe('studentSensitiveApi', () => {
  it('exports the relation option catalogs', () => {
    expect(consentTypes).toContain('MEDIA_CONSENT')
    expect(consentStatuses).toContain('SIGNED')
    expect(healthNoteCategories).toEqual(['HEALTH_INFO', 'SPECIAL_NEEDS'])
    expect(bloodTypes).toContain('AB')
    expect(parentTypes).toEqual(['FATHER', 'MOTHER', 'GUARDIAN'])
    expect(vaccineTypes).toContain('MMR')
    expect(pcDays).toEqual(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'])
    expect(studentSupportRoles).toEqual(['SPECIAL_ED'])
  })

  it('maps representative relation endpoints and payloads', async () => {
    const fetchMock = mock(async (url) => jsonResponse({ data: { url } }))
    globalThis.fetch = fetchMock

    await studentSensitiveApi.listParents('student-1', { is_deleted: true })
    await studentSensitiveApi.createParent('student-1', { full_name: 'Parent' })
    await studentSensitiveApi.updateConsent('student-1', 'consent-1', { status: 'SIGNED' })
    await studentSensitiveApi.createHealthNote('student-1', { description: 'Note' })
    await studentSensitiveApi.updateVaccine('student-1', 'vaccine-1', { received: true })
    await studentSensitiveApi.createPcActivity('student-1', { activity_id: 'activity-1' })
    await studentSensitiveApi.createSupportAssignment('student-1', { employee_id: 'employee-1' })
    await studentSensitiveApi.endSupportAssignment('student-1', 'assignment-1')
    await studentSensitiveApi.reactivateSupportAssignment('student-1', 'assignment-1')

    expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method || 'GET'])).toEqual([
      ['/api/admin/students/student-1/parents?is_deleted=true', 'GET'],
      ['/api/admin/students/student-1/parents', 'POST'],
      ['/api/admin/students/student-1/consents/consent-1', 'PATCH'],
      ['/api/admin/students/student-1/health-notes', 'POST'],
      ['/api/admin/students/student-1/vaccine-records/vaccine-1', 'PATCH'],
      ['/api/admin/students/student-1/pc-activities', 'POST'],
      ['/api/admin/students/student-1/support-assignments', 'POST'],
      ['/api/admin/students/student-1/support-assignments/assignment-1/end', 'PATCH'],
      ['/api/admin/students/student-1/support-assignments/assignment-1/reactivate', 'PATCH'],
    ])
  })

  it('uploads consent attachments as multipart data', async () => {
    const fetchMock = mock(async () => jsonResponse({ data: { id: 'attachment-1' } }))
    globalThis.fetch = fetchMock
    const file = new File(['pdf'], 'consent.pdf', { type: 'application/pdf' })

    await studentSensitiveApi.uploadAttachment('student-1', 'consent-1', file)

    const form = fetchMock.mock.calls[0][1].body
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('file').name).toBe('consent.pdf')
  })

  it('returns null only for a missing health record', async () => {
    globalThis.fetch = mock(async () => jsonResponse({ message: 'Missing' }, 404))
    await expect(studentSensitiveApi.getHealthRecord('student-1')).resolves.toBeNull()

    globalThis.fetch = mock(async () => jsonResponse({ message: 'Unavailable' }, 503))
    await expect(studentSensitiveApi.getHealthRecord('student-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('skips the active-support lookup for an empty student list', async () => {
    const fetchMock = mock(async () => jsonResponse({ data: [] }))
    globalThis.fetch = fetchMock
    await expect(studentSensitiveApi.getActiveSupportStudentIds([])).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
