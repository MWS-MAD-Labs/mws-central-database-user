// A role label is plain words: letters, numbers and single spaces.
const PATTERN = /^[\p{L}\p{N}]+( [\p{L}\p{N}]+)*$/u

// Drops symbols and doubled spaces as it is typed. A space at the end stays so the next word can follow.
export function cleanLabelInput(value) {
  return value
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/ {2,}/g, ' ')
    .replace(/^ /, '')
}

export function labelProblem(label) {
  const text = label.trim()
  if (!text) return 'Label is required.'
  if (!PATTERN.test(text)) return 'A label can only have letters, numbers and single spaces.'
  return null
}
