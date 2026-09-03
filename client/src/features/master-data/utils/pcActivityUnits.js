// Only units that actually have a grade (Kindergarten/Elementary/Junior
// High) can have students, so those are the only ones a PC activity's
// mentor can ever be relevant for - staff-only units (BRIDGE, Directorate,
// etc.) never show up. Derived from grades rather than listing units
// directly, since there's no "has students" flag on MasterUnit itself.
// Shared by PCActivityMentorsDialog (Manage Mentors) and
// MasterResourcePanel (the "Default Mentor (all units)" field on create).
export function distinctGradeUnits(grades) {
  const seen = new Map()
  for (const grade of grades) {
    if (grade.unit_id && !seen.has(grade.unit_id)) {
      seen.set(grade.unit_id, { id: grade.unit_id, name: grade.unit_name })
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}
