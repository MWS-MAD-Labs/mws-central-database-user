import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { apiFileRequest, ApiError, apiRequest } from '../../../src/lib/api.js'
import { createClientSession, readClientSession } from '../../../src/lib/clientSession.js'

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  })
}

describe('apiRequest', () => {
  beforeEach(() => {
    window.__MWS_ENV__ = { VITE_API_BASE_URL: '' }
  })

  it('sends JSON with credentials and parses the response', async () => {
    const fetchMock = mock(async () => jsonResponse({ data: { id: 'student-1' } }))
    globalThis.fetch = fetchMock

    const result = await apiRequest('/api/admin/students', {
      method: 'POST',
      headers: { 'x-request-id': 'request-1' },
      body: { full_name: 'Ari Student' },
    })

    expect(result).toEqual({ data: { id: 'student-1' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/students')
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ full_name: 'Ari Student' }),
    })
    expect(options.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-request-id': 'request-1',
    })
  })

  it('preserves FormData and URLSearchParams bodies', async () => {
    const fetchMock = mock(async () => jsonResponse({ data: true }))
    globalThis.fetch = fetchMock
    const formData = new FormData()
    formData.set('file', new Blob(['csv']), 'students.csv')
    const search = new URLSearchParams({ page: '2' })

    await apiRequest('/api/import', { method: 'POST', body: formData })
    await apiRequest('/api/search', { method: 'POST', body: search })

    expect(fetchMock.mock.calls[0][1].body).toBe(formData)
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Content-Type')
    expect(fetchMock.mock.calls[1][1].body).toBe(search)
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('Content-Type')
  })

  it('preserves absolute URLs and parses text and empty responses', async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response('plain response', { status: 200, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    globalThis.fetch = fetchMock

    await expect(apiRequest('https://files.example.test/status')).resolves.toBe('plain response')
    await expect(apiRequest('/api/no-content')).resolves.toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe('https://files.example.test/status')
  })

  it('normalizes JSON and text error responses', async () => {
    const responses = [
      jsonResponse({ errors: 'Validation failed' }, { status: 400 }),
      jsonResponse({ error: 'Permission denied' }, { status: 403 }),
      jsonResponse({ message: 'Missing record' }, { status: 404 }),
      new Response('Service unavailable', { status: 503, statusText: 'Unavailable', headers: { 'content-type': 'text/plain' } }),
    ]
    globalThis.fetch = mock(async () => responses.shift())

    for (const [message, status] of [
      ['Validation failed', 400],
      ['Permission denied', 403],
      ['Missing record', 404],
      ['Service unavailable', 503],
    ]) {
      try {
        await apiRequest('/api/failure', { skipAuthRefresh: true })
        throw new Error('Expected ApiError')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect(error.message).toBe(message)
        expect(error.status).toBe(status)
      }
    }
  })

  it('refreshes once and retries the original request after a 401', async () => {
    createClientSession({ type: 'admin' })
    const previousExpiry = readClientSession().expires_at
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse({ errors: 'Expired' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ data: { refreshed: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'student-1' } }))
    globalThis.fetch = fetchMock

    const result = await apiRequest('/api/admin/students')

    expect(result).toEqual({ data: { id: 'student-1' } })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh')
    expect(readClientSession().expires_at >= previousExpiry).toBe(true)
  })

  it('deduplicates concurrent refresh requests', async () => {
    let releaseRefresh
    const refreshGate = new Promise((resolve) => { releaseRefresh = resolve })
    const callsByPath = new Map()
    globalThis.fetch = mock(async (url) => {
      callsByPath.set(url, (callsByPath.get(url) || 0) + 1)
      if (url === '/api/auth/refresh') {
        await refreshGate
        return jsonResponse({ data: true })
      }
      if (callsByPath.get(url) === 1) return jsonResponse({ errors: 'Expired' }, { status: 401 })
      return jsonResponse({ data: url })
    })

    const first = apiRequest('/api/admin/students')
    const second = apiRequest('/api/admin/employees')
    await Promise.resolve()
    releaseRefresh()

    await expect(Promise.all([first, second])).resolves.toEqual([
      { data: '/api/admin/students' },
      { data: '/api/admin/employees' },
    ])
    expect(callsByPath.get('/api/auth/refresh')).toBe(1)
  })

  it('does not recursively refresh the refresh endpoint or skipped requests', async () => {
    const fetchMock = mock(async () => jsonResponse({ errors: 'Unauthorized' }, { status: 401 }))
    globalThis.fetch = fetchMock

    await expect(apiRequest('/api/auth/refresh')).rejects.toBeInstanceOf(ApiError)
    await expect(apiRequest('/api/auth/me', { skipAuthRefresh: true })).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('apiFileRequest', () => {
  it('returns a blob and parses quoted and UTF-8 filenames', async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response('csv', {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="students.csv"' },
      }))
      .mockResolvedValueOnce(new Response('xlsx', {
        status: 200,
        headers: { 'content-disposition': "attachment; filename*=UTF-8''student%20data.xlsx" },
      }))
    globalThis.fetch = fetchMock

    const csv = await apiFileRequest('/api/export/csv')
    const xlsx = await apiFileRequest('/api/export/xlsx')

    expect(await csv.blob.text()).toBe('csv')
    expect(csv.fileName).toBe('students.csv')
    expect(xlsx.fileName).toBe('student data.xlsx')
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('*/*')
  })

  it('normalizes failed file responses', async () => {
    globalThis.fetch = mock(async () => jsonResponse({ message: 'Export denied' }, { status: 403 }))

    try {
      await apiFileRequest('/api/export', { skipAuthRefresh: true })
      throw new Error('Expected ApiError')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect(error.message).toBe('Export denied')
      expect(error.status).toBe(403)
    }
  })
})
