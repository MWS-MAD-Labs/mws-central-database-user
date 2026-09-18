import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { ApiError } from '../../../src/lib/api.js'
import { authApi } from '../../../src/features/auth/api/authApi.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function routeFetch(routes) {
  return mock(async (url, options = {}) => {
    const route = routes.find((candidate) =>
      candidate.path === url && (!candidate.method || candidate.method === (options.method || 'GET')),
    )
    if (!route) throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`)
    return typeof route.response === 'function' ? route.response(url, options) : route.response
  })
}

describe('authApi', () => {
  beforeEach(() => sessionStorage.clear())

  it('returns the admin session without checking employee auth', async () => {
    const fetchMock = routeFetch([
      { path: '/api/auth/me', response: jsonResponse({ data: { id: 'admin-1', type: 'admin' } }) },
    ])
    globalThis.fetch = fetchMock

    await expect(authApi.currentUser()).resolves.toEqual({ id: 'admin-1', type: 'admin' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to employee auth after an admin 401', async () => {
    const fetchMock = routeFetch([
      { path: '/api/auth/me', response: jsonResponse({ errors: 'Unauthorized' }, 401) },
      { path: '/api/auth/refresh', method: 'POST', response: jsonResponse({ errors: 'Unauthorized' }, 401) },
      { path: '/api/auth/employee/me', response: jsonResponse({ data: { id: 'employee-1', type: 'employee' } }) },
    ])
    globalThis.fetch = fetchMock

    await expect(authApi.currentUser()).resolves.toEqual({ id: 'employee-1', type: 'employee' })
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/auth/me',
      '/api/auth/refresh',
      '/api/auth/employee/me',
    ])
  })

  it('returns null when both session endpoints return 401', async () => {
    const fetchMock = routeFetch([
      { path: '/api/auth/me', response: jsonResponse({ errors: 'Unauthorized' }, 401) },
      { path: '/api/auth/refresh', method: 'POST', response: jsonResponse({ errors: 'Unauthorized' }, 401) },
      { path: '/api/auth/employee/me', response: jsonResponse({ errors: 'Unauthorized' }, 401) },
    ])
    globalThis.fetch = fetchMock

    await expect(authApi.currentUser()).resolves.toBeNull()
  })

  it('does not hide non-authentication failures', async () => {
    globalThis.fetch = routeFetch([
      { path: '/api/auth/me', response: jsonResponse({ message: 'Database unavailable' }, 503) },
    ])

    try {
      await authApi.currentUser()
      throw new Error('Expected ApiError')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect(error.status).toBe(503)
    }
  })

  it('posts Google codes without auth refresh', async () => {
    const fetchMock = routeFetch([
      { path: '/api/auth/google', method: 'POST', response: jsonResponse({ data: { id: 'admin-1', type: 'admin' } }) },
    ])
    globalThis.fetch = fetchMock

    await expect(authApi.loginWithGoogle('google-code')).resolves.toEqual({ id: 'admin-1', type: 'admin' })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ code: 'google-code' }),
    })
  })

  it('uses the session-specific logout endpoint', async () => {
    const fetchMock = routeFetch([
      { path: '/api/auth/logout', method: 'POST', response: jsonResponse({ data: true }) },
      { path: '/api/auth/employee/logout', method: 'POST', response: jsonResponse({ data: true }) },
    ])
    globalThis.fetch = fetchMock

    await authApi.logout('admin')
    await authApi.logout('employee')

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/auth/logout',
      '/api/auth/employee/logout',
    ])
  })
})
