// How long and how large what is typed may be. The forms in the client use the same numbers
// (client/src/lib/limits.js), so a limit is met at the keyboard and not only after Save.
export const LIMITS = {
  // Unit, building, education, job position, job level and PC activity names.
  MASTER_NAME_MAX: 50,
  GRADE_NAME_MAX: 30,
  CLASS_NAME_MAX: 30,
  APPLICATION_DESCRIPTION_MAX: 50,
  CLASS_CAPACITY_MAX: 100,
  JOB_POSITION_HOLDERS_MAX: 200,
  GRADE_LEVEL_MIN: -5,
  GRADE_LEVEL_MAX: 20,
  GRADE_AGE_MIN: 3,
  GRADE_AGE_MAX: 30,
  // Academic years: the year the name starts with, and the years the dates may fall in.
  ACADEMIC_YEAR_MIN: 2000,
  ACADEMIC_YEAR_MAX: 2100,
} as const;
