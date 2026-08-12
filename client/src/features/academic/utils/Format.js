import { parseAcademicYearStartYear } from "./Pattern.js";

export function nextAcademicYearStartYear(years) {
  const startYears = years
    .map((year) => parseAcademicYearStartYear(year.name))
    .filter((year) => year !== null);

  if (startYears.length === 0) return new Date().getFullYear();

  return Math.max(...startYears) + 1;
}
