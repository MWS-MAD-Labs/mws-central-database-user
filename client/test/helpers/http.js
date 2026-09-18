import { mock } from 'bun:test'

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function createFetchRouter(routes) {
  return mock(async (input, options = {}) => {
    const url = String(input)
    const method = options.method || 'GET'
    const route = routes.find((candidate) => {
      const pathMatches = candidate.path instanceof RegExp
        ? candidate.path.test(url)
        : candidate.path === url
      return pathMatches && (!candidate.method || candidate.method === method)
    })
    if (!route) throw new Error(`Unexpected request: ${method} ${url}`)
    return typeof route.response === 'function'
      ? route.response({ url, method, options })
      : route.response
  })
}
