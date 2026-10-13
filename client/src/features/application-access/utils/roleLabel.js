// A role label is plain words: letters, numbers and single spaces.
const PATTERN = /^[\p{L}\p{N}]+( [\p{L}\p{N}]+)*$/u

// "support staff" becomes "Support Staff". The rest of a word stays as typed, so "IT support" is "IT Support".
export function titleCase(value) {
  return value.replace(/(^|\s)(\p{L})/gu, (_match, space, letter) => space + letter.toUpperCase())
}

// Drops symbols and doubled spaces as it is typed, and gives every word a capital. A space at the end stays so the next word can follow.
export function cleanLabelInput(value) {
  return titleCase(
    value
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .replace(/ {2,}/g, ' ')
      .replace(/^ /, ''),
  )
}

export function labelProblem(label) {
  const text = label.trim()
  if (!text) return 'Label is required.'
  if (!PATTERN.test(text)) return 'A label can only have letters, numbers and single spaces.'
  return null
}
