export const SYSTEM_ONLY_UNIT_IDS = new Set(['unit_unknown_legacy'])

export function isOperationalUnit(unit) {
  return Boolean(unit?.id) && !SYSTEM_ONLY_UNIT_IDS.has(unit.id)
}

export function distinctGradeUnits(grades) {
  const seen = new Map()
  for (const grade of grades) {
    if (
      grade.unit_id &&
      !SYSTEM_ONLY_UNIT_IDS.has(grade.unit_id) &&
      !seen.has(grade.unit_id)
    ) {
      seen.set(grade.unit_id, { id: grade.unit_id, name: grade.unit_name })
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}
