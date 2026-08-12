const ACADEMIC_YEAR_NAME_PATTERN = /^(\d{4})\/(\d{4})$/;

// Academic year names are now normalized server-side to "YYYY/YYYY+1" -
// this parses that back out for a specific record (returns null for a
// pre-existing name that doesn't follow the pattern, e.g. legacy data).
export function parseAcademicYearStartYear(name) {
  const match = name?.match(ACADEMIC_YEAR_NAME_PATTERN);
  return match ? Number(match[1]) : null;
}
