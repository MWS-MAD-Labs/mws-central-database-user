const runtimeEnv =
  typeof window !== 'undefined' && window.__MWS_ENV__ ? window.__MWS_ENV__ : {}

function readEnv(key) {
  return runtimeEnv[key] ?? import.meta.env[key] ?? ''
}

export const env = {
  apiBaseUrl: readEnv('VITE_API_BASE_URL'),
  googleClientId: readEnv('VITE_GOOGLE_CLIENT_ID'),
  googleRedirectUri: readEnv('VITE_GOOGLE_REDIRECT_URI'),
}
