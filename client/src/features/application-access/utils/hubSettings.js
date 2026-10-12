import { LIMITS } from '../../../lib/limits.js'

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

export const MAX_BYPASS_EMAILS = 3

const NAME = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/

// What may stay in the name box: letters, digits, dot, underscore and dash, in lower case.
export function cleanName(text) {
  return text.toLowerCase().replace(/[^a-z0-9._-]/g, '')
}

// Reads the box. A pasted full address gives its name and, when the domain is another one, says so.
export function readNameInput(text) {
  const [local, ...rest] = text.split('@')
  const domain = rest.join('@').trim().toLowerCase()
  const foreign = rest.length > 0 && domain !== '' && domain !== LIMITS.EMAIL_DOMAIN
  return { name: cleanName(local), problem: foreign ? `Only ${LIMITS.EMAIL_DOMAIN} emails.` : null }
}

export function nameProblem(name) {
  if (!NAME.test(name) || name.includes('..')) {
    return 'Use letters, digits, dots, dashes or underscores. It cannot start or end with a dot or dash.'
  }
  return null
}

// "ann" into "ann@millennia21.id".
export function toEmail(name) {
  return `${name}@${LIMITS.EMAIL_DOMAIN}`
}

// Only the name part, for showing next to the fixed domain.
export function emailName(email) {
  return email.split('@')[0]
}

export function emailsProblem(emails) {
  if (emails.length > MAX_BYPASS_EMAILS) return `At most ${MAX_BYPASS_EMAILS} emails.`
  const foreign = emails.find((email) => !email.endsWith(`@${LIMITS.EMAIL_DOMAIN}`))
  if (foreign) return `Only ${LIMITS.EMAIL_DOMAIN} emails. "${foreign}" is not one.`
  const long = emails.find((email) => email.length > LIMITS.EMAIL_MAX)
  if (long) return `An email can have up to ${LIMITS.EMAIL_MAX} characters.`
  for (const email of emails) {
    const problem = nameProblem(emailName(email))
    if (problem) return problem
  }
  if (new Set(emails).size !== emails.length) return 'Each email only once.'
  return null
}

const quote = (value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// The three sign-in lines of the Hub's .env, written like the server writes them.
export function signInEnvLines(applicationId, settings) {
  return [
    `HUB_CENTRAL_ACCESS_MODE=${quote(settings.hub_access_mode)}`,
    `HUB_CENTRAL_ACCESS_APP_ID=${quote(applicationId)}`,
    `HUB_CENTRAL_ACCESS_BYPASS_EMAILS=${quote(settings.hub_bypass_emails.join(','))}`,
  ].join('\n')
}
