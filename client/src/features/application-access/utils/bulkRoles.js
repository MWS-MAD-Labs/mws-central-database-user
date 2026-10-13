import { groupPermissions } from './groupSummary.js'

// SUPPORT STAFF becomes SUPPORT_STAFF. A name that starts with a number gets ROLE_ in front, keys start with a letter.
export function keyFromLabel(label) {
  const key = label
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
  if (!key) return ''
  return /^[A-Z]/.test(key) ? key : `ROLE_${key}`
}

export const AUDIENCES = [
  { value: 'employees', label: 'Employees', allows_employees: true, allows_students: false },
  { value: 'students', label: 'Students', allows_employees: false, allows_students: true },
  { value: 'both', label: 'Both', allows_employees: true, allows_students: true },
]

let counter = 0
export const newColumn = () => ({ id: `new-${(counter += 1)}`, label: '', audience: 'employees', permissions: [] })

// Everything a permission needs, directly or through the ones it needs.
export function requiredBy(options) {
  const needs = new Map(options.map((option) => [option.key, option.requires || []]))
  const closure = (key, seen = new Set()) => {
    for (const next of needs.get(key) || []) {
      if (seen.has(next)) continue
      seen.add(next)
      closure(next, seen)
    }
    return seen
  }
  return closure
}

// Ticks a permission with what it needs, or unticks it unless another ticked one needs it.
export function togglePermission(value, key, closure) {
  if (value.includes(key)) {
    const held = value.some((item) => item !== key && closure(item).has(key))
    return held ? value : value.filter((item) => item !== key)
  }
  return [...new Set([...value, key, ...closure(key)])]
}

// The permissions grouped by area for the rows of the matrix.
export function matrixAreas(options) {
  const descriptions = new Map(options.map((option) => [option.key, option.description]))
  return groupPermissions(options.map((option) => option.key)).map((group) => ({
    area: group.area,
    rows: group.items.map((key) => ({ key, description: descriptions.get(key) || null })),
  }))
}

// What is wrong with each column, by column id: a name problem, a name taken by another column or an existing role,
// or the same permissions as another role. Columns that are fine are left out.
export function columnProblems(columns, existingRoles, labelProblem) {
  const problems = {}
  const taken = new Map(existingRoles.map((role) => [role.key, role.key]))
  const seen = new Map()
  const sameSet = (left, right) => [...left].sort().join('\n') === [...right].sort().join('\n')
  for (const column of columns) {
    const key = keyFromLabel(column.label)
    const name = labelProblem(column.label)
    if (name) problems[column.id] = { name }
    else if (!key) problems[column.id] = { name: 'Use letters or numbers in the name.' }
    else if (taken.has(key)) problems[column.id] = { name: `${key} already exists.` }
    else if (seen.has(key)) problems[column.id] = { name: 'Another new role has this name.' }
    seen.set(key, column.id)
  }
  for (const column of columns) {
    if (problems[column.id]) continue
    const twin =
      existingRoles.find((role) => role.is_active && sameSet(role.permissions, column.permissions)) ||
      columns.find((other) => other.id !== column.id && !problems[other.id] && sameSet(other.permissions, column.permissions))
    if (twin && column.permissions.length > 0) problems[column.id] = { twin: twin.key || keyFromLabel(twin.label) }
  }
  return problems
}
