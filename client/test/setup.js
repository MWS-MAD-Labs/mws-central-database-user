import { afterEach, expect, setSystemTime, vi } from 'bun:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const originalFetch = globalThis.fetch
const testRuntimeEnv = {
  VITE_API_BASE_URL: '',
  VITE_GOOGLE_CLIENT_ID: 'google-client-id',
  VITE_GOOGLE_REDIRECT_URI: 'http://localhost/auth/google/callback',
}

const browserGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLCanvasElement',
  'Document',
  'DocumentFragment',
  'Element',
  'Node',
  'SVGElement',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'CustomEvent',
  'MutationObserver',
  'getComputedStyle',
  'localStorage',
  'sessionStorage',
]

for (const key of browserGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: key === 'window' ? dom.window : dom.window[key],
  })
}

Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  writable: true,
  value: (callback) => setTimeout(() => callback(performance.now()), 0),
})

Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  configurable: true,
  writable: true,
  value: (handle) => clearTimeout(handle),
})

window.matchMedia ??= (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return false },
})

globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.IntersectionObserver ??= class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {}
HTMLElement.prototype.setPointerCapture ??= function setPointerCapture() {}
HTMLElement.prototype.releasePointerCapture ??= function releasePointerCapture() {}
HTMLElement.prototype.hasPointerCapture ??= function hasPointerCapture() { return false }

URL.createObjectURL ??= () => 'blob:test-object-url'
URL.revokeObjectURL ??= () => {}
window.__MWS_ENV__ = { ...testRuntimeEnv }

const matchers = await import('@testing-library/jest-dom/matchers')
const { cleanup } = await import('@testing-library/react')
await import('dayjs/locale/id')

expect.extend(matchers)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (vi.isFakeTimers()) {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
  setSystemTime()
  document.body.innerHTML = ''
  globalThis.fetch = originalFetch
  window.__MWS_ENV__ = { ...testRuntimeEnv }
  delete window.google
  localStorage.clear()
  sessionStorage.clear()
})
