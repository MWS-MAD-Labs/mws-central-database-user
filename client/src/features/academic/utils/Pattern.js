const ACADEMIC_YEAR_NAME_PATTERN = /^(\d{4})\/(\d{4})$/;

export function parseAcademicYearStartYear(name) {
  const match = name?.match(ACADEMIC_YEAR_NAME_PATTERN);
  return match ? Number(match[1]) : null;
}
