import { LIMITS } from '../../../lib/limits.js'

// The id of an application is made from its name: "MWS Hub" becomes "mws-hub". Same rule as the server.
export function slugifyApplicationId(name) {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  if (!slug) return ''
  return /^[a-z]/.test(slug) ? slug : `app-${slug}`.slice(0, 64).replace(/-+$/g, '')
}

// Extra spaces and line breaks become one space.
export const tidyText = (value) => value.replace(/\s+/g, ' ').trim()

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.&()'-]*$/u

export function nameProblem(value) {
  const name = tidyText(value)
  if (!name) return 'Name is required.'
  if (name.length < 2) return 'Name needs at least 2 characters.'
  if (name.length > 60) return 'Name is too long.'
  if (!NAME_PATTERN.test(name)) return "Use letters, numbers, spaces and & . ( ) ' _ - only."
  const id = slugifyApplicationId(name)
  if (!id) return 'Name needs at least one letter or number.'
  if (id === 'me') return 'This name makes a reserved id. Pick another name.'
  return null
}

export function descriptionProblem(value) {
  const text = tidyText(value)
  if (text.length > LIMITS.APPLICATION_DESCRIPTION_MAX) return `Description can have up to ${LIMITS.APPLICATION_DESCRIPTION_MAX} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[<>\u0000-\u001f]/.test(text)) return 'Leave out < and > from the description.'
  return null
}

export function iconProblem(value) {
  const icon = value.trim()
  if (!icon) return null
  if (icon.length > 40) return 'Icon is too long.'
  return /^[A-Za-z][A-Za-z0-9]*$/.test(icon) ? null : 'Icon is a name like AppWindow, letters and numbers only.'
}
