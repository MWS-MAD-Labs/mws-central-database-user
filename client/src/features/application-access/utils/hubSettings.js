// The Hub's sign-in settings, as they are picked in the form and written into its .env.
export const HUB_MODES = [
  {
    id: 'warn',
    title: 'Warn',
    text: 'Everyone still gets in. Whoever would be turned away is only logged. Start here.',
    recommended: true,
  },
  {
    id: 'enforce',
    title: 'Enforce',
    text: 'People without access in Central are turned away. Use it once everyone who should get in has access.',
  },
  {
    id: 'off',
    title: 'Off',
    text: 'Access in Central is not checked at all.',
  },
]

export const MAX_BYPASS_EMAILS = 10
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// "a@x.id, B@x.id" into ["a@x.id", "b@x.id"].
export function parseEmails(text) {
  return text
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function emailsProblem(emails) {
  if (emails.length > MAX_BYPASS_EMAILS) return `At most ${MAX_BYPASS_EMAILS} emails.`
  const bad = emails.find((email) => !EMAIL.test(email))
  if (bad) return `"${bad}" is not a valid email.`
  if (new Set(emails).size !== emails.length) return 'Each email only once.'
  return null
}
