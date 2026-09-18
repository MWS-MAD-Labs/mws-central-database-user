import { formatStatus } from "../../lib/format.js";

function sortSuggestedFirst(options, suggestedValue) {
  if (!suggestedValue) return options;
  return [...options]
    .map((option) =>
      option.value === suggestedValue
        ? { ...option, badge: "Suggested", tone: "gold" }
        : option,
    )
    .sort((a, b) => {
      if (a.value === suggestedValue) return -1;
      if (b.value === suggestedValue) return 1;
      return 0;
    });
}

function formatEntryType(entryType) {
  if (entryType === "PSB") return "PSB";
  if (entryType === "PRE_K") return "Pre-K";
  return formatStatus(entryType);
}

function getClassName(classes, classId) {
  if (!classId) return "-";
  return classes.find((klass) => klass.id === classId)?.name || classId;
}

function getYearName(years, yearId) {
  if (!yearId) return "-";
  return years.find((year) => year.id === yearId)?.name || yearId;
}

const NIS_UNIT_LABELS = {
  0: "Kindergarten",
  1: "Elementary",
  2: "Junior High",
}
const NIS_ENTRY_TYPE_LABELS = {
  0: "PRE_K",
  1: "PSB",
  2: "TRANSFER",
}

function academicYearDigits(academicYear) {
  return academicYear?.start_date
    ? String(new Date(academicYear.start_date).getFullYear()).slice(-2)
    : academicYear?.name?.match(/\d{4}/)?.[0]?.slice(-2)
}

function gradeUnitDigit(gradeLevel) {
  if (gradeLevel === undefined || gradeLevel === null) return null
  if (gradeLevel <= 0) return "0"
  if (gradeLevel <= 6) return "1"
  if (gradeLevel <= 9) return "2"
  return null
}

function decodeLegacyNisHints(legacyNis, { gradeLevel, academicYear, academicYears }) {
  if (!legacyNis || !/^\d{7}$/.test(legacyNis)) return null

  const yearDigits = legacyNis.slice(0, 2)
  const unitDigit = legacyNis[2]
  const entryTypeDigit = legacyNis[3]
  const sequenceDigits = legacyNis.slice(4)

  const expectedYear = academicYearDigits(academicYear)
  const expectedUnit = gradeUnitDigit(gradeLevel)

  const yearMatches = Boolean(expectedYear) && yearDigits === expectedYear
  const unitMatches = Boolean(expectedUnit) && unitDigit === expectedUnit

  let suggestedYear = null
  if (!yearMatches) {
    const candidates = (academicYears || []).filter(
      (year) => academicYearDigits(year) === yearDigits,
    )
    if (candidates.length === 1) suggestedYear = candidates[0]
  }

  return {
    yearDigits,
    unitDigit,
    entryTypeDigit,
    sequenceDigits,
    unitLabel: NIS_UNIT_LABELS[unitDigit] || null,
    entryType: NIS_ENTRY_TYPE_LABELS[entryTypeDigit] || null,
    yearMatches,
    unitMatches,
    suggestedYear,
  }
}

export {
    getClassName,
    getYearName,
    decodeLegacyNisHints,
    formatEntryType,
    sortSuggestedFirst,
}
