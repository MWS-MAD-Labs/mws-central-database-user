import { LIMITS } from '../../../lib/limits.js'

// What is wrong with a year typed in a form, or null when it is fine.
export function yearProblem(value, label = 'Year') {
  if (!value) return `${label} is required.`
  const year = Number(value)
  if (value.length !== 4 || year < LIMITS.ACADEMIC_YEAR_MIN || year > LIMITS.ACADEMIC_YEAR_MAX) {
    return `Use a year between ${LIMITS.ACADEMIC_YEAR_MIN} and ${LIMITS.ACADEMIC_YEAR_MAX}.`
  }
  return null
}

export const isValidYear = (value) => yearProblem(value) === null
