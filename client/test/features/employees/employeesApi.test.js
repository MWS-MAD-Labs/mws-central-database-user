import { describe, expect, it, mock } from 'bun:test'
import {
  disciplinaryActionTypeLabels,
  disciplinaryActionTypes,
  disciplinaryActionValidityOptions,
  educationLevels,
  employeeSortFields,
  employeesApi,
  employeeStatuses,
  employmentTypes,
  genderOptions,
  maritalStatuses,
  religionOptions,
} from '../../../src/features/employees/api/employeesApi.js'

function jsonResponse(data) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function calls(fetchMock) {
  return fetchMock.mock.calls.map(([url, options]) => [url, options.method || 'GET'])
}

describe('employeesApi', () => {
  it('exports employee and disciplinary option catalogs', () => {
    expect(employeeSortFields).toContain('employee_id')
    expect(employeeStatuses).toEqual(['ACTIVE', 'INACTIVE', 'RESIGNED', 'ON_LEAVE', 'ARCHIVED'])
    expect(genderOptions).toEqual(['MALE', 'FEMALE'])
    expect(religionOptions).toContain('OTHER')
    expect(employmentTypes).toContain('CONTRACT')
    expect(maritalStatuses).toContain('MARRIED')
    expect(educationLevels).toEqual(['SD', 'SMP', 'SMA_SMK', 'D1', 'D2', 'D3', 'D4', 'S1', 'S2', 'S3'])
    expect(disciplinaryActionTypes).toEqual(['SURAT_TEGURAN', 'SURAT_PERINGATAN'])
    expect(disciplinaryActionTypeLabels.SURAT_PERINGATAN).toBe('Reprimand Letter')
    expect(disciplinaryActionValidityOptions.at(-1)).toEqual({ value: 365, label: '12 months' })
  })

  it('maps representative CRUD and bulk endpoints and payloads', async () => {
    const fetchMock = mock(async () => jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    await employeesApi.list({ page: 2, status: 'ACTIVE', empty: '' })
    await employeesApi.get('employee-1')
    await employeesApi.countTotal()
    await employeesApi.create({ full_name: 'Ari' })
    await employeesApi.update('employee-1', { status: 'ON_LEAVE' })
    await employeesApi.remove('employee-1')
    await employeesApi.restore('employee-1')
    await employeesApi.bulkRemove(['employee-1', 'employee-2'])
    await employeesApi.bulkRestore(['employee-1'])
    await employeesApi.bulkUpdate(['employee-1'], { status: 'ACTIVE', unit_id: 'unit-1' })

    expect(calls(fetchMock)).toEqual([
      ['/api/admin/employees?page=2&status=ACTIVE', 'GET'],
      ['/api/admin/employees/employee-1', 'GET'],
      ['/api/admin/employees/count-total', 'GET'],
      ['/api/admin/employees', 'POST'],
      ['/api/admin/employees/employee-1', 'PATCH'],
      ['/api/admin/employees/delete/employee-1', 'PATCH'],
      ['/api/admin/employees/restore/employee-1', 'PATCH'],
      ['/api/admin/employees/bulk/delete', 'PATCH'],
      ['/api/admin/employees/bulk/restore', 'PATCH'],
      ['/api/admin/employees/bulk/update', 'PATCH'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ full_name: 'Ari' })
    expect(JSON.parse(fetchMock.mock.calls[9][1].body)).toEqual({
      ids: ['employee-1'],
      status: 'ACTIVE',
      unit_id: 'unit-1',
    })
  })

  it('maps individual and bulk contract extension payloads', async () => {
    const fetchMock = mock(async () => jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    await employeesApi.extendContract('employee-1', '2027-06-30')
    await employeesApi.bulkExtendContract(['employee-1', 'employee-2'], {
      durationMonths: 12,
      contractEndDate: '2027-06-30',
      baselineOverrides: [{ employee_id: 'employee-2', baseline_date: '2026-09-01' }],
    })
    await employeesApi.bulkExtendContract(['employee-3'], { durationMonths: 6, baselineOverrides: [] })

    expect(calls(fetchMock)).toEqual([
      ['/api/admin/employees/employee-1/extend-contract', 'PATCH'],
      ['/api/admin/employees/bulk/extend-contract', 'PATCH'],
      ['/api/admin/employees/bulk/extend-contract', 'PATCH'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ contract_end_date: '2027-06-30' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      ids: ['employee-1', 'employee-2'],
      duration_months: 12,
      contract_end_date: '2027-06-30',
      baseline_overrides: [{ employee_id: 'employee-2', baseline_date: '2026-09-01' }],
    })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      ids: ['employee-3'],
      duration_months: 6,
    })
  })

  it('builds employee photo multipart requests', async () => {
    const fetchMock = mock(async () => jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock
    const blob = new Blob(['photo'], { type: 'image/jpeg' })
    const file = new File(['photo'], 'employee.jpg', { type: 'image/jpeg' })
    const secondFile = new File(['other'], 'other.jpg', { type: 'image/jpeg' })
    const mappings = [{ file_name: 'employee.jpg', employee_id: 'employee-1' }]

    await employeesApi.uploadPhoto('employee-1', blob)
    await employeesApi.uploadPhoto('employee-1', file)
    await employeesApi.removePhoto('employee-1')
    await employeesApi.previewBulkPhotos(['employee.jpg'])
    await employeesApi.commitBulkPhotos(mappings, [file, secondFile])

    expect(calls(fetchMock)).toEqual([
      ['/api/admin/employees/employee-1/photo', 'POST'],
      ['/api/admin/employees/employee-1/photo', 'POST'],
      ['/api/admin/employees/employee-1/photo', 'DELETE'],
      ['/api/admin/employees/photos/bulk-preview', 'POST'],
      ['/api/admin/employees/photos/bulk-commit', 'POST'],
    ])
    expect(fetchMock.mock.calls[0][1].body.get('file').name).toBe('photo.jpg')
    expect(fetchMock.mock.calls[1][1].body.get('file').name).toBe('employee.jpg')
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ file_names: ['employee.jpg'] })
    const bulkForm = fetchMock.mock.calls[4][1].body
    expect(JSON.parse(bulkForm.get('mappings'))).toEqual(mappings)
    expect(bulkForm.getAll('files').map((item) => item.name)).toEqual(['employee.jpg', 'other.jpg'])
  })

  it('maps history, relation, suggestion, and sensitive-access APIs', async () => {
    const fetchMock = mock(async () => jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    await employeesApi.getMutationHistory('employee-1')
    await employeesApi.rollbackMutation('employee-1', 'history-1')
    await employeesApi.getEducationSuggestions()
    await employeesApi.getTeachingAssignments('employee-1')
    await employeesApi.getSupportAssignments('employee-1')
    await employeesApi.getPcActivityMentorships('employee-1')
    await employeesApi.recordSensitiveFieldsAccess('employee-1')

    expect(calls(fetchMock)).toEqual([
      ['/api/admin/employees/employee-1/mutation-history', 'GET'],
      ['/api/admin/employees/employee-1/mutation-history/history-1/rollback', 'PATCH'],
      ['/api/admin/employees/education-suggestions', 'GET'],
      ['/api/admin/employees/employee-1/teaching-assignments', 'GET'],
      ['/api/admin/employees/employee-1/support-assignments', 'GET'],
      ['/api/admin/employees/employee-1/pc-activity-mentorships', 'GET'],
      ['/api/admin/employees/employee-1/sensitive-fields/access', 'POST'],
    ])
  })

  it('maps disciplinary action lifecycle and attachment APIs', async () => {
    const fetchMock = mock(async () => jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock
    const attachment = new File(['letter'], 'letter.pdf', { type: 'application/pdf' })

    await employeesApi.getDisciplinaryActions('employee-1')
    await employeesApi.createDisciplinaryAction('employee-1', { type: 'SURAT_TEGURAN' })
    await employeesApi.updateDisciplinaryAction('employee-1', 'action-1', { reason: 'Updated' })
    await employeesApi.resolveDisciplinaryAction('employee-1', 'action-1', { resolution_notes: 'Resolved' })
    await employeesApi.revokeDisciplinaryAction('employee-1', 'action-1')
    await employeesApi.getDisciplinaryActionAttachments('employee-1', 'action-1', { page: 2, include_deleted: false, empty: '' })
    await employeesApi.uploadDisciplinaryActionAttachment('employee-1', 'action-1', attachment)
    await employeesApi.removeDisciplinaryActionAttachment('employee-1', 'action-1', 'attachment-1')
    await employeesApi.restoreDisciplinaryActionAttachment('employee-1', 'action-1', 'attachment-1')

    expect(calls(fetchMock)).toEqual([
      ['/api/admin/employees/employee-1/disciplinary-actions', 'GET'],
      ['/api/admin/employees/employee-1/disciplinary-actions', 'POST'],
      ['/api/admin/employees/employee-1/disciplinary-actions/action-1', 'PATCH'],
      ['/api/admin/employees/employee-1/disciplinary-actions/action-1/resolve', 'PATCH'],
      ['/api/admin/employees/employee-1/disciplinary-actions/action-1/revoke', 'PATCH'],
      ['/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments?page=2&include_deleted=false', 'GET'],
      ['/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments', 'POST'],
      ['/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments/delete/attachment-1', 'PATCH'],
      ['/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments/restore/attachment-1', 'PATCH'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ type: 'SURAT_TEGURAN' })
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ resolution_notes: 'Resolved' })
    expect(fetchMock.mock.calls[6][1].body.get('file').name).toBe('letter.pdf')
  })
})
