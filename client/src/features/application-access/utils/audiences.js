// Who a group is for: employees, interns, or students on their own. The server speaks in a list, the screens in a key.
export const AUDIENCE_CHOICES = [
  { value: 'EMPLOYEES', label: 'Employees' },
  { value: 'INTERNS', label: 'Interns' },
  { value: 'STUDENTS', label: 'Students' },
]

const ORDER = ['EMPLOYEES', 'INTERNS', 'STUDENTS']

const sorted = (audiences = []) => ORDER.filter((name) => audiences.includes(name))

// EMPLOYEES, INTERNS, EMPLOYEES_AND_INTERNS, STUDENTS. Older groups can also be EMPLOYEES_AND_STUDENTS.
export const audienceKey = (audiences) => sorted(audiences).join('_AND_')

export const hasEmployees = (audiences = []) => audiences.includes('EMPLOYEES')
export const hasInterns = (audiences = []) => audiences.includes('INTERNS')
export const hasStudents = (audiences = []) => audiences.includes('STUDENTS')
// Employees and interns both have a unit and a job position. Only employees have a level.
export const hasStaff = (audiences = []) => hasEmployees(audiences) || hasInterns(audiences)
export const studentsOnly = (audiences = []) => hasStudents(audiences) && !hasStaff(audiences)

const NAMES = { EMPLOYEES: 'Employees', INTERNS: 'Interns', STUDENTS: 'Students' }

export const audienceLabels = {
  EMPLOYEES: 'All Active Employees',
  INTERNS: 'All Active Interns',
  STUDENTS: 'All Active Students',
  EMPLOYEES_AND_INTERNS: 'All Active Employees and Interns',
  EMPLOYEES_AND_STUDENTS: 'All Active Employees and Students',
  INTERNS_AND_STUDENTS: 'All Active Interns and Students',
  EMPLOYEES_AND_INTERNS_AND_STUDENTS: 'All Active Employees, Interns and Students',
}

export const audienceLabelOf = (audiences) => audienceLabels[audienceKey(audiences)] ?? sorted(audiences).map((name) => NAMES[name]).join(' and ')

// Ticks or unticks one audience. Students stand alone, so ticking them clears the rest and ticking another clears them.
export function toggleAudience(audiences, name) {
  if (audiences.includes(name)) return audiences.filter((item) => item !== name)
  if (name === 'STUDENTS') return ['STUDENTS']
  return sorted([...audiences.filter((item) => item !== 'STUDENTS'), name])
}

const nouns = {
  EMPLOYEES: ['Employee', 'Employees'],
  INTERNS: ['Intern', 'Interns'],
  STUDENTS: ['Student', 'Students'],
}

// "3 Employees", "1 Student", "2 People" when more than one kind is in the group.
export function countOf(count, audiences) {
  const key = audienceKey(audiences)
  const [one, many] = nouns[key] ?? ['Person', 'People']
  return `${count} ${count === 1 ? one : many}`
}

// A line under the Audience choice, about how the choice reaches people.
export function audienceHint(audiences) {
  if (studentsOnly(audiences)) return 'Students are a group of their own. Tick Employees or Interns instead to leave them out.'
  if (hasEmployees(audiences) && hasInterns(audiences)) return 'Interns are matched by unit and job position. Job levels apply to employees only.'
  if (hasInterns(audiences)) return 'Interns are matched by unit and job position.'
  return 'Tick Interns too to include them in this group.'
}
