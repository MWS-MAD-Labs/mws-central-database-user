import { env } from '../config/env.js'

let refreshPromise = null

export class ApiError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export async function apiRequest(path, options = {}) {
  const response = await performRequest(path, options)

  if (
    response.status === 401 &&
    !options.skipAuthRefresh &&
    !path.includes('/api/auth/refresh')
  ) {
    const refreshed = await refreshSession()
    if (refreshed) {
      return apiRequest(path, { ...options, skipAuthRefresh: true })
    }
  }

  return parseResponse(response)
}

async function performRequest(path, options) {
  const { body, headers, ...fetchOptions } = options
  delete fetchOptions.skipAuthRefresh
  const shouldSerialize = shouldSerializeJson(body)

  return fetch(buildUrl(path), {
    ...fetchOptions,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(shouldSerialize ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: shouldSerialize ? JSON.stringify(body) : body,
  })
}

async function parseResponse(response) {
  if (response.status === 204) {
    return null
  }

  const payload = await readPayload(response)

  if (!response.ok) {
    throw new ApiError(getErrorMessage(payload) || response.statusText, {
      status: response.status,
      payload,
    })
  }

  return payload
}

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch(buildUrl('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    }).finally(() => {
      refreshPromise = null
    })
  }

  const response = await refreshPromise
  return response.ok
}

async function readPayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json().catch(() => null)
  }

  return response.text().catch(() => null)
}

function buildUrl(path) {
  if (/^https?:\/\//.test(path)) {
    return path
  }

  return `${env.apiBaseUrl}${path}`
}

function shouldSerializeJson(body) {
  if (!body || typeof body !== 'object') {
    return false
  }

  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return false
  }

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return false
  }

  return true
}

function getErrorMessage(payload) {
  if (!payload) {
    return ''
  }

  if (typeof payload === 'string') {
    return payload
  }

  return payload.errors || payload.error || payload.message || ''
}
