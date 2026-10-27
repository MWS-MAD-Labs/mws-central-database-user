import { describe, expect, it } from 'bun:test'
import { assignSupportTeacher, supportFailureMessage } from '../../../src/features/academic/utils/assignSupportTeacher.js'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

describe('assignSupportTeacher', () => {
  it('counts the students the server refused and keeps the first reason', async () => {
    let calls = 0
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/students\/[^/]+\/support-assignments$/,
        method: 'POST',
        response: () => {
          calls += 1
          return calls <= 3
            ? jsonResponse({ data: { id: `a${calls}` } })
            : jsonResponse({ errors: 'Dewi already supports 3 students. The limit is 3.' }, 400)
        },
      },
    ])
    const result = await assignSupportTeacher({ employee_id: 'e1' }, ['s1', 's2', 's3', 's4', 's5'])
    expect(result).toEqual({ failed: 2, reason: 'Dewi already supports 3 students. The limit is 3.' })
    expect(supportFailureMessage(result.failed, result.reason)).toBe(
      '2 students were enrolled but have no SE teacher yet: Dewi already supports 3 students. The limit is 3.',
    )
  })

  it('reports nothing when every assignment went through', async () => {
    globalThis.fetch = createFetchRouter([
      { path: /support-assignments$/, method: 'POST', response: () => jsonResponse({ data: { id: 'a' } }) },
    ])
    expect(await assignSupportTeacher({ intern_id: 'i1' }, ['s1', 's2'])).toEqual({ failed: 0, reason: null })
    expect(supportFailureMessage(1, null)).toBe('1 student was enrolled but has no SE teacher yet.')
  })
})
