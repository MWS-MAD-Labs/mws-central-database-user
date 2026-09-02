import { formatStatus } from "../../lib/format.js";

// Reorders a SearchableSelect option list so a deterministically-decoded
// suggestion (Legacy NIS's own digits, not a guess) sorts first and gets a
// visible badge - nudges toward the likely-correct pick without removing
// the others, since the decode is only as good as the legacy NIS itself
// actually being consistent (see Chellua's year-digit case, where it took
// fixing the enrollment first to trust it at all).
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

// formatStatus() title-cases everything (PSB -> "Psb", PRE_K -> "Pre K"),
// wrong for the PSB acronym and awkward for PRE_K's underscore - special
// case both, fall through to formatStatus for the rest (TRANSFER ->
// "Transfer").
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

// Mirrors deriveUnitCode/deriveEntryTypeCode/deriveEntryYear/computeNisPrefix
// in server/src/utils/nis-generator.ts - a client-side read of the same
// deterministic 7-digit encoding (YY + unit + entry type + sequence). Used
// to explain a Legacy NIS in the Reissue NIS dialog and, where the digits
// actually disagree with what's currently selected, point at what might
// really be wrong instead of staying silent - a year mismatch (like the
// Chellua case: NIS says "26", Join Year selected is "25") is exactly the
// case worth surfacing, not hiding just because it doesn't match yet.
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

  // Only offered as a concrete suggestion when exactly one academic year
  // in the whole list has this start year - two years ending in the same
  // last two digits (a century apart, in practice never) would make the
  // digits alone ambiguous, so this stays silent rather than guessing.
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