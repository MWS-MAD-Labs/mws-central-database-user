import { describe, expect, it, mock } from 'bun:test'
import {
  genderOptions,
  religionOptions,
  studentEntryTypes,
  studentSortFields,
  studentStatuses,
  studentsApi,
  terminalStudentStatuses,
} from '../../../src/features/students/api/studentsApi.js'

function jsonResponse(data) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('studentsApi', () => {
  it('exports the student option catalogs', () => {
    expect(genderOptions).toEqual(['MALE', 'FEMALE'])
    expect(religionOptions).toContain('OTHER')
    expect(studentStatuses).toContain('ARCHIVED')
    expect(studentEntryTypes).toEqual(['PRE_K', 'PSB', 'TRANSFER'])
    expect(terminalStudentStatuses).toEqual(['GRADUATED', 'TRANSFERRED', 'WITHDRAWN'])
    expect(studentSortFields).toContain('join_year')
  })

  it('maps student workflow endpoints and payloads', async () => {
    const fetchMock = mock(async (url) => jsonResponse({ url }))
    globalThis.fetch = fetchMock

    await studentsApi.listBackfillCandidates({ page: 1, grade_id: 'grade-1', empty: '' })
    await studentsApi.reissueNis('student-1', 'TRANSFER', {
      joinGradeId: 'grade-7',
      joinAcademicYearId: 'year-2026',
    })
    await studentsApi.getMutationHistory('student-1')
    await studentsApi.rollbackMutation('student-1', 'history-1')
    await studentsApi.deactivate('student-1')
    await studentsApi.bulkDeactivate(['a', 'b'])
    await studentsApi.reactivate('student-1')
    await studentsApi.bulkReactivate(['a', 'b'])
    await studentsApi.removePhoto('student-1')
    await studentsApi.previewBulkPhotos(['a.jpg'])

    expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method || 'GET'])).toEqual([
      ['/api/admin/students/backfill-candidates?page=1&grade_id=grade-1', 'GET'],
      ['/api/admin/students/student-1/reissue-nis', 'PATCH'],
      ['/api/admin/students/student-1/mutation-history', 'GET'],
      ['/api/admin/students/student-1/mutation-history/history-1/rollback', 'PATCH'],
      ['/api/admin/students/student-1/deactivate', 'PATCH'],
      ['/api/admin/students/bulk/deactivate', 'PATCH'],
      ['/api/admin/students/student-1/reactivate', 'PATCH'],
      ['/api/admin/students/bulk/reactivate', 'PATCH'],
      ['/api/admin/students/student-1/photo', 'DELETE'],
      ['/api/admin/students/photos/bulk-preview', 'POST'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      entry_type: 'TRANSFER',
      join_grade_id: 'grade-7',
      join_academic_year_id: 'year-2026',
    })
  })

  it('uploads Blob photos with a filename and File photos unchanged', async () => {
    const fetchMock = mock(async () => jsonResponse({ id: 'photo-1' }))
    globalThis.fetch = fetchMock
    const blob = new Blob(['photo'], { type: 'image/jpeg' })
    const file = new File(['photo'], 'student.jpg', { type: 'image/jpeg' })

    await studentsApi.uploadPhoto('student-1', blob)
    await studentsApi.uploadPhoto('student-1', file)

    const firstForm = fetchMock.mock.calls[0][1].body
    const secondForm = fetchMock.mock.calls[1][1].body
    expect(firstForm.get('file')).toBeInstanceOf(File)
    expect(firstForm.get('file').name).toBe('photo.jpg')
    expect(secondForm.get('file').name).toBe('student.jpg')
  })

  it('builds multipart bulk photo commits', async () => {
    const fetchMock = mock(async () => jsonResponse({ success_count: 2 }))
    globalThis.fetch = fetchMock
    const files = [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]
    const mappings = [{ file_name: 'a.jpg', student_id: 'student-1' }]

    await studentsApi.commitBulkPhotos(mappings, files)

    const form = fetchMock.mock.calls[0][1].body
    expect(JSON.parse(form.get('mappings'))).toEqual(mappings)
    expect(form.getAll('files').map((file) => file.name)).toEqual(['a.jpg', 'b.jpg'])
  })
})
