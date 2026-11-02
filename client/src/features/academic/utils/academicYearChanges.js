const YEAR_FIELDS = ['startYear', 'start_date', 'end_date', 'status', 'activateClasses']
const SEMESTER_FIELDS = ['start_date', 'end_date', 'half_end_date']

// Whether Save of an edited year has anything to save.
// A semester without an id is a default shown in the form, not yet stored, so saving it is a change.
export function hasAcademicYearChanges({ initial, values, semesters, savedSemesters }) {
  if (YEAR_FIELDS.some((field) => values[field] !== initial[field])) return true
  const saved = new Map(savedSemesters.map((semester) => [semester.id, semester]))
  return semesters.some((semester) => {
    const stored = saved.get(semester.id)
    return !stored || SEMESTER_FIELDS.some((field) => (semester[field] ?? '') !== (stored[field] ?? ''))
  })
}
